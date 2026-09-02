import type { PrismaClient, ExportJob } from '@prisma/client';
import { ExportStatus, ExportType, AuditAction } from '@prisma/client';
import { enqueueExport } from '../../infra/queue/exports.queue';
import { createStorageClient } from '../../infra/storage/s3';
import type { CreateExportInput, AdminExportListQueryInput } from './exports.schema';

// =====================================================================
// ExportsService
// Contrat : docs/contrat-api.yaml §Exports
//
// Règles :
//   - Seuls le créateur ou un COOP_ADMIN de la même coopérative peuvent
//     consulter un ExportJob.
//   - L'URL signée est générée à la demande (non stockée) — valable 24 h.
//   - ExportJob.status suit les valeurs Prisma : QUEUED | RUNNING | READY | FAILED | EXPIRED
//     (la tâche mentionnait PENDING / COMPLETED ; le schéma Prisma fait foi)
//   - Le format est déduit du type : MANIFEST → PDF, FINANCIAL_REPORT → XLSX
// =====================================================================

const SIGNED_URL_EXPIRES_IN = 24 * 3600; // 24 heures en secondes

// =====================================================================
// Erreurs métier
// =====================================================================

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
    (this as NodeJS.ErrnoException).code = 'NOT_FOUND';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
    (this as NodeJS.ErrnoException).code = 'FORBIDDEN';
  }
}

// =====================================================================
// DTO de sortie
// =====================================================================

export interface ExportJobDto extends Omit<ExportJob, 'resultUrl'> {
  resultUrl: string | null;
  downloadUrl?: string; // URL signée générée à la demande si status = READY
}

// =====================================================================
// ExportsService
// =====================================================================

export class ExportsService {
  private readonly storage = createStorageClient();

  constructor(private readonly prisma: PrismaClient) {}

  // ------------------------------------------------------------------
  // createExportJob — POST /coop/exports
  // Auth : COOP_ADMIN | COOP_ASSISTANT de la coopérative
  // ------------------------------------------------------------------
  async createExportJob(
    userId: string,
    cooperativeId: string,
    input: CreateExportInput,
  ): Promise<ExportJobDto> {
    const format = input.type === 'FINANCIAL_REPORT' ? 'XLSX' : 'PDF';

    const job = await this.prisma.exportJob.create({
      data: {
        requestedById: userId,
        cooperativeId,
        type: input.type as ExportType,
        filters: {
          tripInstanceId: input.tripInstanceId ?? null,
          dateFrom: input.dateFrom ?? null,
          dateTo: input.dateTo ?? null,
        },
        format,
        status: ExportStatus.QUEUED,
      },
    });

    // Audit
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: AuditAction.EXPORT_REQUESTED,
        entityType: 'ExportJob',
        entityId: job.id,
        after: { type: input.type, format, cooperativeId },
      },
    });

    // Enfile le job dans BullMQ
    await enqueueExport({
      exportJobId: job.id,
      type: input.type,
      cooperativeId,
      filters: {
        tripInstanceId: input.tripInstanceId,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
      },
    });

    return this.toDto(job);
  }

  // ------------------------------------------------------------------
  // getExportJob — GET /coop/exports/:jobId
  // Auth : créateur OU COOP_ADMIN de la même coopérative
  // URL signée générée à la demande si status = READY
  // ------------------------------------------------------------------
  async getExportJob(jobId: string, userId: string, cooperativeId: string): Promise<ExportJobDto> {
    const job = await this.prisma.exportJob.findUnique({ where: { id: jobId } });

    if (!job) throw new NotFoundError('Export introuvable');

    // Vérification d'accès : créateur ou COOP_ADMIN de la même coopérative
    const isCreator = job.requestedById === userId;

    if (!isCreator) {
      const membership = await this.prisma.membership.findFirst({
        where: {
          userId,
          cooperativeId: job.cooperativeId ?? cooperativeId,
          role: 'COOP_ADMIN',
          active: true,
        },
      });
      if (!membership) {
        throw new ForbiddenError('Accès non autorisé à cet export');
      }
    }

    const dto = this.toDto(job);

    // Générer l'URL signée à la demande si le fichier est disponible
    if (job.status === ExportStatus.READY && job.resultUrl) {
      dto.downloadUrl = await this.storage.getSignedUrl(job.resultUrl, SIGNED_URL_EXPIRES_IN);
    }

    return dto;
  }

  // ------------------------------------------------------------------
  // listCoopExports — GET /coop/exports
  // Auth : COOP_ADMIN | COOP_ASSISTANT
  // Liste tous les exports de la coopérative
  // ------------------------------------------------------------------
  async listCoopExports(cooperativeId: string): Promise<ExportJobDto[]> {
    const jobs = await this.prisma.exportJob.findMany({
      where: { cooperativeId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return jobs.map((j) => this.toDto(j));
  }

  // ------------------------------------------------------------------
  // listAllExports — GET /admin/exports
  // Admin InsTRAM — liste avec filtres
  // Extension documentée (absent du contrat-api.yaml officiel)
  // ------------------------------------------------------------------
  async listAllExports(query: AdminExportListQueryInput): Promise<ExportJobDto[]> {
    const { cooperativeId, type, status, cursor, limit } = query;

    const jobs = await this.prisma.exportJob.findMany({
      where: {
        ...(cooperativeId ? { cooperativeId } : {}),
        ...(type ? { type: type as ExportType } : {}),
        ...(status ? { status: status as ExportStatus } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return jobs.map((j) => this.toDto(j));
  }

  // ------------------------------------------------------------------
  // Mapper ExportJob → ExportJobDto
  // ------------------------------------------------------------------
  private toDto(job: ExportJob): ExportJobDto {
    return {
      ...job,
      downloadUrl: undefined,
    };
  }
}
