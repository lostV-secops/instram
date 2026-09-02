/**
 * Tests unitaires — ExportsService
 *
 * Cas couverts :
 *   1. createExportJob — crée un ExportJob QUEUED et enfile le job BullMQ
 *   2. createExportJob — MANIFEST requiert tripInstanceId (Zod + service)
 *   3. getExportJob — retourne le job si l'utilisateur est le créateur
 *   4. getExportJob — retourne le job si l'utilisateur est COOP_ADMIN de la même coop
 *   5. getExportJob — lève ForbiddenError si accès non autorisé
 *   6. getExportJob — génère une URL signée (downloadUrl) si status = READY
 *   7. getExportJob — pas d'URL signée si status = QUEUED
 *   8. getExportJob — lève NotFoundError si job introuvable
 *   9. listCoopExports — retourne tous les exports de la coopérative
 *  10. listAllExports — filtre par cooperativeId (admin)
 */

import { ExportsService, NotFoundError, ForbiddenError } from '../exports.service';
import { CreateExportSchema } from '../exports.schema';

// =====================================================================
// Mock de la file BullMQ et du StorageClient
// =====================================================================

jest.mock('../../../infra/queue/exports.queue', () => ({
  enqueueExport: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../infra/storage/s3', () => ({
  createStorageClient: jest.fn(() => ({
    upload: jest.fn().mockResolvedValue({ url: 'http://localhost:4000/exports/test.pdf' }),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed.example.com/test.pdf?X-Signature=abc'),
  })),
}));

import { enqueueExport } from '../../../infra/queue/exports.queue';

// =====================================================================
// Fixtures
// =====================================================================

const USER_ID   = '00000000-0000-0000-0000-000000000001';
const ADMIN_ID  = '00000000-0000-0000-0000-000000000002';
const COOP_ID   = '00000000-0000-0000-0000-000000000020';
const TRIP_ID   = '00000000-0000-0000-0000-000000000010';
const JOB_ID    = '00000000-0000-0000-0000-000000000070';

const makeJob = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: JOB_ID,
  requestedById: USER_ID,
  cooperativeId: COOP_ID,
  type: 'MANIFEST',
  filters: { tripInstanceId: TRIP_ID, dateFrom: null, dateTo: null },
  format: 'PDF',
  status: 'QUEUED',
  resultUrl: null,
  resultBytes: null,
  expiresAt: null,
  errorMessage: null,
  createdAt: new Date(),
  completedAt: null,
  ...overrides,
});

// =====================================================================
// Mock PrismaClient
// =====================================================================

function buildMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    exportJob: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    membership: {
      findFirst: jest.fn(),
    },
    adminProfile: {
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

// =====================================================================
// Tests
// =====================================================================

describe('ExportsService', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // 1. createExportJob — succès MANIFEST
  // ------------------------------------------------------------------
  it('crée un ExportJob QUEUED et enfile le job BullMQ (MANIFEST)', async () => {
    const mockPrisma = buildMockPrisma();
    const job = makeJob();
    (mockPrisma.exportJob.create as jest.Mock).mockResolvedValue(job);

    const service = new ExportsService(mockPrisma as never);
    const result = await service.createExportJob(USER_ID, COOP_ID, {
      type: 'MANIFEST',
      tripInstanceId: TRIP_ID,
    });

    expect(result.status).toBe('QUEUED');
    expect(result.id).toBe(JOB_ID);
    expect(mockPrisma.exportJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'MANIFEST',
          format: 'PDF',
          status: 'QUEUED',
          cooperativeId: COOP_ID,
        }),
      }),
    );
    expect(enqueueExport).toHaveBeenCalledWith(
      expect.objectContaining({
        exportJobId: JOB_ID,
        type: 'MANIFEST',
        cooperativeId: COOP_ID,
      }),
    );
  });

  // ------------------------------------------------------------------
  // 2. createExportJob — FINANCIAL_REPORT (XLSX)
  // ------------------------------------------------------------------
  it('crée un ExportJob QUEUED pour FINANCIAL_REPORT avec format XLSX', async () => {
    const mockPrisma = buildMockPrisma();
    const job = makeJob({ type: 'FINANCIAL_REPORT', format: 'XLSX', filters: { dateFrom: '2024-01-01', dateTo: '2024-01-31', tripInstanceId: null } });
    (mockPrisma.exportJob.create as jest.Mock).mockResolvedValue(job);

    const service = new ExportsService(mockPrisma as never);
    const result = await service.createExportJob(USER_ID, COOP_ID, {
      type: 'FINANCIAL_REPORT',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    });

    expect(result.type).toBe('FINANCIAL_REPORT');
    expect(mockPrisma.exportJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ format: 'XLSX' }),
      }),
    );
  });

  // ------------------------------------------------------------------
  // 3. Validation Zod — MANIFEST sans tripInstanceId
  // ------------------------------------------------------------------
  it('Zod rejette MANIFEST sans tripInstanceId', () => {
    const result = CreateExportSchema.safeParse({ type: 'MANIFEST' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]?.path).toContain('tripInstanceId');
    }
  });

  // ------------------------------------------------------------------
  // 4. getExportJob — créateur peut accéder
  // ------------------------------------------------------------------
  it('retourne le job si l\'utilisateur est le créateur', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.exportJob.findUnique as jest.Mock).mockResolvedValue(makeJob());

    const service = new ExportsService(mockPrisma as never);
    const result = await service.getExportJob(JOB_ID, USER_ID, COOP_ID);

    expect(result.id).toBe(JOB_ID);
    // Pas d'URL signée (status = QUEUED)
    expect(result.downloadUrl).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // 5. getExportJob — COOP_ADMIN peut accéder
  // ------------------------------------------------------------------
  it('retourne le job si l\'utilisateur est COOP_ADMIN de la même coopérative', async () => {
    const mockPrisma = buildMockPrisma();
    // Job appartient à USER_ID, mais ADMIN_ID est COOP_ADMIN
    (mockPrisma.exportJob.findUnique as jest.Mock).mockResolvedValue(makeJob({ requestedById: USER_ID }));
    (mockPrisma.membership.findFirst as jest.Mock).mockResolvedValue({
      id: 'mem-1', userId: ADMIN_ID, cooperativeId: COOP_ID, role: 'COOP_ADMIN', active: true,
    });

    const service = new ExportsService(mockPrisma as never);
    const result = await service.getExportJob(JOB_ID, ADMIN_ID, COOP_ID);

    expect(result.id).toBe(JOB_ID);
  });

  // ------------------------------------------------------------------
  // 6. getExportJob — accès refusé
  // ------------------------------------------------------------------
  it('lève ForbiddenError si ni créateur ni COOP_ADMIN', async () => {
    const mockPrisma = buildMockPrisma();
    // Job appartient à USER_ID
    (mockPrisma.exportJob.findUnique as jest.Mock).mockResolvedValue(makeJob({ requestedById: USER_ID }));
    // ADMIN_ID n'a pas de Membership COOP_ADMIN
    (mockPrisma.membership.findFirst as jest.Mock).mockResolvedValue(null);

    const service = new ExportsService(mockPrisma as never);

    await expect(
      service.getExportJob(JOB_ID, ADMIN_ID, COOP_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ------------------------------------------------------------------
  // 7. getExportJob — URL signée si status = READY
  // ------------------------------------------------------------------
  it('génère une downloadUrl signée si status = READY', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.exportJob.findUnique as jest.Mock).mockResolvedValue(
      makeJob({ status: 'READY', resultUrl: 'manifests/coop/trip-123.pdf' }),
    );

    const service = new ExportsService(mockPrisma as never);
    const result = await service.getExportJob(JOB_ID, USER_ID, COOP_ID);

    expect(result.downloadUrl).toBe('https://signed.example.com/test.pdf?X-Signature=abc');
  });

  // ------------------------------------------------------------------
  // 8. getExportJob — pas d'URL signée si status = QUEUED
  // ------------------------------------------------------------------
  it('ne génère pas de downloadUrl si status = QUEUED', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.exportJob.findUnique as jest.Mock).mockResolvedValue(makeJob({ status: 'QUEUED' }));

    const service = new ExportsService(mockPrisma as never);
    const result = await service.getExportJob(JOB_ID, USER_ID, COOP_ID);

    expect(result.downloadUrl).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // 9. getExportJob — NotFoundError
  // ------------------------------------------------------------------
  it('lève NotFoundError si le job n\'existe pas', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.exportJob.findUnique as jest.Mock).mockResolvedValue(null);

    const service = new ExportsService(mockPrisma as never);

    await expect(
      service.getExportJob(JOB_ID, USER_ID, COOP_ID),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // ------------------------------------------------------------------
  // 10. listCoopExports — retourne les exports de la coopérative
  // ------------------------------------------------------------------
  it('liste les exports de la coopérative', async () => {
    const mockPrisma = buildMockPrisma();
    const jobs = [makeJob(), makeJob({ id: 'another-job-id', type: 'FINANCIAL_REPORT' })];
    (mockPrisma.exportJob.findMany as jest.Mock).mockResolvedValue(jobs);

    const service = new ExportsService(mockPrisma as never);
    const result = await service.listCoopExports(COOP_ID);

    expect(result).toHaveLength(2);
    expect(mockPrisma.exportJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cooperativeId: COOP_ID } }),
    );
  });

  // ------------------------------------------------------------------
  // 11. listAllExports — filtre par cooperativeId (admin)
  // ------------------------------------------------------------------
  it('filtre les exports par cooperativeId pour admin', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.exportJob.findMany as jest.Mock).mockResolvedValue([makeJob()]);

    const service = new ExportsService(mockPrisma as never);
    const result = await service.listAllExports({ cooperativeId: COOP_ID, limit: 20 });

    expect(result).toHaveLength(1);
    expect(mockPrisma.exportJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cooperativeId: COOP_ID }),
      }),
    );
  });
});
