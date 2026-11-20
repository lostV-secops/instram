import { Queue, Worker } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { ExportStatus } from '@prisma/client';
import { createStorageClient } from '../storage/s3';

// =====================================================================
// File BullMQ — export.generate
// Architecture §2.7 : worker export.generate
//
// Type MANIFEST  → CSV (csv-stringify) + PDF (pdfkit)
// Type FINANCIAL_REPORT → XLSX (exceljs)
//
// Formats gérés (VH-13) :
//   - MANIFEST      : CSV UTF-8 + PDF
//   - FINANCIAL_REPORT : XLSX
//
// Hypothèse : pour MANIFEST, le PDF est l'URL principale (resultUrl).
// Le CSV est uploadé en parallèle avec un suffixe '-manifest.csv'.
// =====================================================================

const QUEUE_NAME = 'export.generate';

export interface ExportJobData {
  exportJobId: string;
  type: 'MANIFEST' | 'FINANCIAL_REPORT';
  cooperativeId: string;
  filters: {
    tripInstanceId?: string;
    dateFrom?: string;
    dateTo?: string;
  };
}

let _exportQueue: Queue | undefined;

function getExportQueue(): Queue {
  if (_exportQueue) return _exportQueue;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IoRedis = require('ioredis') as typeof import('ioredis').default;
  const connection = new IoRedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10_000,
  });

  _exportQueue = new Queue(QUEUE_NAME, { connection });
  return _exportQueue;
}

export async function enqueueExport(job: ExportJobData): Promise<void> {
  await getExportQueue().add('generate', job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  });
}

export function _setExportQueueForTest(q: Queue): void {
  _exportQueue = q;
}

// =====================================================================
// Helpers de génération
// =====================================================================

async function generateManifestCsv(
  prisma: PrismaClient,
  cooperativeId: string,
  tripInstanceId: string,
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { stringify } = require('csv-stringify/sync') as typeof import('csv-stringify/sync');

  const bookings = await prisma.booking.findMany({
    where: {
      cooperativeId,
      tripInstanceId,
      status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED_AT_COUNTER'] },
    },
    include: {
      passengers: true,
      seats: true,
      payments: { include: { platformFee: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  type Row = {
    'Référence': string;
    'Passager': string;
    'Siège(s)': string;
    'Statut embarquement': string;
    'Méthode paiement': string;
    'Montant (MGA)': number;
  };

  const rows: Row[] = bookings.flatMap((b) => {
    const paymentProvider =
      b.payments.length > 0 ? b.payments[0]!.provider : (b.channel === 'WALK_IN' ? 'CASH' : 'N/A');
    const seats = b.seats.map((s) => s.seatCode).join(', ');
    return b.passengers.map((p) => ({
      'Référence': b.reference,
      'Passager': `${p.firstName} ${p.lastName}`,
      'Siège(s)': seats,
      'Statut embarquement': b.boardingStatus,
      'Méthode paiement': String(paymentProvider),
      'Montant (MGA)': b.totalAmountMga,
    }));
  });

  const csv = stringify(rows, { header: true });
  return Buffer.from(csv, 'utf-8');
}

async function generateManifestPdf(
  prisma: PrismaClient,
  cooperativeId: string,
  tripInstanceId: string,
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require('pdfkit') as typeof import('pdfkit');

  const trip = await prisma.tripInstance.findUnique({
    where: { id: tripInstanceId },
    include: { route: { include: { origin: true, destination: true } } },
  });

  const bookings = await prisma.booking.findMany({
    where: {
      cooperativeId,
      tripInstanceId,
      status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED_AT_COUNTER'] },
    },
    include: { passengers: true, seats: true, payments: true },
    orderBy: { createdAt: 'asc' },
  });

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const buffers: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // En-tête
    doc.fontSize(18).text('INSTRAM — MANIFESTE DE VOYAGE', { align: 'center' });
    doc.moveDown(0.5);

    if (trip) {
      const origin = trip.route.origin.nameFr;
      const dest = trip.route.destination.nameFr;
      doc.fontSize(12).text(`Trajet : ${origin} > ${dest}`);
      doc.text(`Départ : ${trip.departureAt.toISOString()}`);
      doc.text(`Généré le : ${new Date().toISOString()}`);
    }

    doc.moveDown();
    doc.fontSize(10);

    // En-têtes de tableau
    const colX = [40, 120, 230, 310, 390, 460];
    const headers = ['Référence', 'Passager', 'Siège(s)', 'Embarquement', 'Paiement', 'MGA'];
    headers.forEach((h, i) => doc.text(h, colX[i]!, doc.y, { width: 70, continued: i < headers.length - 1 }));
    doc.moveDown(0.3);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.3);

    // Lignes passagers
    bookings.forEach((b) => {
      const seats = b.seats.map((s) => s.seatCode).join(', ');
      const provider = b.payments.length > 0 ? b.payments[0]!.provider : 'CASH';
      b.passengers.forEach((p) => {
        const rowY = doc.y;
        const cols = [
          b.reference,
          `${p.firstName} ${p.lastName}`,
          seats,
          b.boardingStatus,
          String(provider),
          String(b.totalAmountMga),
        ];
        cols.forEach((val, i) => {
          doc.text(val, colX[i]!, rowY, { width: 70, continued: i < cols.length - 1 });
        });
        doc.moveDown(0.5);
      });
    });

    doc.end();
  });
}

async function generateFinancialReportXlsx(
  prisma: PrismaClient,
  cooperativeId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require('exceljs') as typeof import('exceljs');

  const trips = await prisma.tripInstance.findMany({
    where: {
      cooperativeId,
      ...(dateFrom || dateTo
        ? {
            departureAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59Z`) } : {}),
            },
          }
        : {}),
      status: { in: ['COMPLETED', 'DEPARTED'] },
    },
    include: {
      route: { include: { origin: true, destination: true } },
      bookings: {
        where: { status: { in: ['CONFIRMED', 'COMPLETED'] } },
        include: { commissions: true },
      },
    },
    orderBy: { departureAt: 'asc' },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'InsTRAM';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Rapport financier');

  sheet.columns = [
    { header: 'Date', key: 'date', width: 20 },
    { header: 'Trajet', key: 'trajet', width: 30 },
    { header: 'Sièges vendus', key: 'siegesVendus', width: 14 },
    { header: 'Recette brute (MGA)', key: 'recetteBrute', width: 20 },
    { header: 'Commission InsTRAM (MGA)', key: 'commission', width: 24 },
    { header: 'Net coopérative (MGA)', key: 'netCoop', width: 22 },
  ];

  // Style en-têtes
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF205E98' }, // Bleu principal InsTRAM
    };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });

  trips.forEach((trip) => {
    const trajet = `${trip.route.origin.nameFr} → ${trip.route.destination.nameFr}`;
    const siegesVendus = trip.bookings.length;
    const recetteBrute = trip.bookings.reduce((sum, b) => sum + b.seatSubtotalMga, 0);
    const commission = trip.bookings.reduce(
      (sum, b) => sum + b.commissions.reduce((s, c) => s + c.amountMga, 0),
      0,
    );
    const netCoop = recetteBrute - commission;

    sheet.addRow({
      date: trip.departureAt.toISOString().slice(0, 10),
      trajet,
      siegesVendus,
      recetteBrute,
      commission,
      netCoop,
    });
  });

  // Ligne totaux
  const lastRow = sheet.lastRow?.number ?? 1;
  if (lastRow > 1) {
    sheet.addRow({
      date: 'TOTAL',
      trajet: '',
      siegesVendus: { formula: `SUM(C2:C${lastRow})` },
      recetteBrute: { formula: `SUM(D2:D${lastRow})` },
      commission: { formula: `SUM(E2:E${lastRow})` },
      netCoop: { formula: `SUM(F2:F${lastRow})` },
    });
    const totalRow = sheet.lastRow;
    if (totalRow) {
      totalRow.eachCell((cell) => {
        cell.font = { bold: true };
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// =====================================================================
// Worker BullMQ — export.generate
// =====================================================================

export function startExportWorker(prisma: PrismaClient): Worker {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IoRedis = require('ioredis') as typeof import('ioredis').default;
  const connection = new IoRedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10_000,
  });

  const storage = createStorageClient();

  const worker = new Worker<ExportJobData>(
    QUEUE_NAME,
    async (job) => {
      const { exportJobId, type, cooperativeId, filters } = job.data;

      // Marquer RUNNING
      await prisma.exportJob.update({
        where: { id: exportJobId },
        data: { status: ExportStatus.RUNNING },
      });

      try {
        const timestamp = Date.now();
        let resultUrl: string;

        if (type === 'MANIFEST') {
          if (!filters.tripInstanceId) {
            throw new Error('tripInstanceId requis pour le type MANIFEST');
          }

          // Générer CSV
          const csvBuffer = await generateManifestCsv(prisma, cooperativeId, filters.tripInstanceId);
          const csvKey = `manifests/${cooperativeId}/${filters.tripInstanceId}-${timestamp}-manifest.csv`;
          await storage.upload(csvKey, csvBuffer, 'text/csv; charset=utf-8');

          // Générer PDF (URL principale)
          const pdfBuffer = await generateManifestPdf(prisma, cooperativeId, filters.tripInstanceId);
          const pdfKey = `manifests/${cooperativeId}/${filters.tripInstanceId}-${timestamp}-manifest.pdf`;
          const { url } = await storage.upload(pdfKey, pdfBuffer, 'application/pdf');
          resultUrl = pdfKey; // On stocke la clé, pas l'URL publique (la signée est générée à la demande)

          // Mise à jour du log (URL du CSV pour référence interne)
          process.stdout.write(`[export.worker] MANIFEST CSV: ${csvKey}, PDF: ${pdfKey}\n`);
          void url; // L'URL brute n'est pas utilisée directement — la signée est générée via getSignedUrl

        } else if (type === 'FINANCIAL_REPORT') {
          const xlsxBuffer = await generateFinancialReportXlsx(
            prisma,
            cooperativeId,
            filters.dateFrom,
            filters.dateTo,
          );
          const xlsxKey = `reports/${cooperativeId}/${timestamp}-financial-report.xlsx`;
          await storage.upload(
            xlsxKey,
            xlsxBuffer,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          );
          resultUrl = xlsxKey;

        } else {
          throw new Error(`Type d'export non supporté : ${type as string}`);
        }

        await prisma.exportJob.update({
          where: { id: exportJobId },
          data: {
            status: ExportStatus.READY,
            resultUrl,
            completedAt: new Date(),
          },
        });

        process.stdout.write(`[export.worker] Job ${exportJobId} terminé (${type}).\n`);

      } catch (err) {
        await prisma.exportJob.update({
          where: { id: exportJobId },
          data: {
            status: ExportStatus.FAILED,
            errorMessage: (err as Error).message,
          },
        });
        throw err; // BullMQ gère le retry
      }
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    process.stderr.write(
      `[export.worker] Job ${job?.id ?? '?'} échoué (tentative ${job?.attemptsMade ?? '?'}): ${err.message}\n`,
    );
  });

  worker.on('completed', (job) => {
    process.stdout.write(`[export.worker] Job ${job.id} complété.\n`);
  });

  return worker;
}
