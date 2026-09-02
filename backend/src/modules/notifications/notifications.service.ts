/**
 * NotificationsService
 * Contrat : docs/contrat-api.yaml §Notifications
 * Architecture : §2.6 SmsProvider, §2.7 worker sms.dispatch, §6.8, §7.3
 *
 * Hypothèses documentées (points ambigus du contrat) :
 * 1. NotificationPreferences n'a pas de modèle DB dans schema.prisma — stocké
 *    en Redis JSON (clé : notif:prefs:{userId}). Hypothèse validable avec l'Architecte.
 * 2. GET /notifications retourne { items, nextCursor } (enveloppe de pagination)
 *    malgré la définition schema "type: array" dans le contrat — les paramètres
 *    cursor/limit du contrat n'ont de sens qu'avec une enveloppe paginée.
 * 3. PUT (pas PATCH) est utilisé pour /notifications/preferences, conformément
 *    au contrat-api.yaml (la spec de tâche mentionnait PATCH, le contrat dit PUT).
 * 4. Si un template MG est manquant pour une clé donnée, une erreur explicite
 *    est levée (pas de fallback silencieux sur FR).
 * 5. NotificationTemplate en base : upsert (createOrUpdate) par code lors du
 *    premier enqueue, pour satisfaire la FK Notification.templateId.
 */

import path from 'path';
import fs from 'fs';
import type { PrismaClient } from '@prisma/client';
import {
  NotificationChannel,
  NotificationCategory,
  NotificationStatus,
  Lang,
} from '@prisma/client';
import type { Redis } from 'ioredis';
import type { SmsProvider } from '../../infra/sms/provider';
import {
  isInSilenceWindow,
  isTransactional,
  nextSendableTime,
} from '../../infra/sms/silence';
import { enqueueSms, type SmsJobData } from '../../infra/queue/sms.queue';

// =====================================================================
// Types
// =====================================================================

export interface NotificationPreferences {
  smsEnabled: boolean;
  /** Clés de templates pour lesquelles l'utilisateur s'est désinscrit */
  optedOutTemplates: string[];
}

export interface EnqueueParams {
  userId?: string;
  bookingId?: string;
  templateKey: string;
  variables: Record<string, string>;
  lang: 'FR' | 'MG';
  phone: string;
  /** Override de la détection auto (isTransactional) */
  transactional?: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

// =====================================================================
// Clé Redis pour les préférences SMS
// =====================================================================

const prefsKey = (userId: string): string => `notif:prefs:${userId}`;

const DEFAULT_PREFS: NotificationPreferences = {
  smsEnabled: true,
  optedOutTemplates: [],
};

// =====================================================================
// Lecture des templates JSON (cache en mémoire)
// =====================================================================

const templateCache = new Map<string, Record<string, string>>();

function loadTemplates(lang: 'FR' | 'MG'): Record<string, string> {
  const key = lang;
  if (templateCache.has(key)) return templateCache.get(key)!;

  const file = lang === 'FR' ? 'fr.json' : 'mg.json';
  const filePath = path.join(__dirname, 'templates', file);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[NotificationsService] Fichier template manquant : ${filePath}`,
    );
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const templates = JSON.parse(raw) as Record<string, string>;
  templateCache.set(key, templates);
  return templates;
}

/**
 * Invalide le cache des templates (utile pour les tests).
 */
export function clearTemplateCache(): void {
  templateCache.clear();
}

/**
 * Rend un template en interpolant les variables {{key}}.
 * Lève une erreur si le template est manquant dans le fichier de langue.
 * Règle absolue : pas de fallback silencieux sur FR si MG manque.
 */
export function renderTemplate(
  templateKey: string,
  lang: 'FR' | 'MG',
  variables: Record<string, string>,
): string {
  const templates = loadTemplates(lang);

  if (!(templateKey in templates)) {
    throw new Error(
      `[NotificationsService] Template "${templateKey}" manquant dans ${lang.toLowerCase()}.json — ` +
        `tous les templates doivent exister en FR ET MG (pas de fallback silencieux).`,
    );
  }

  let text = templates[templateKey];
  for (const [k, v] of Object.entries(variables)) {
    text = text.replaceAll(`{{${k}}}`, v);
  }
  return text;
}

// =====================================================================
// Catégorie selon transactionnel/non-transactionnel
// =====================================================================

function categoryFor(templateKey: string): NotificationCategory {
  return isTransactional(templateKey)
    ? NotificationCategory.TRANSACTIONAL
    : NotificationCategory.REMINDER;
}

// =====================================================================
// Service
// =====================================================================

export class NotificationsService {
  private readonly silenceStart: number;
  private readonly silenceEnd: number;

  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
    private readonly smsProvider: SmsProvider,
  ) {
    this.silenceStart = parseInt(
      process.env.SILENCE_START_HOUR ?? '21',
      10,
    );
    this.silenceEnd = parseInt(process.env.SILENCE_END_HOUR ?? '6', 10);
  }

  // ------------------------------------------------------------------
  // enqueue
  // Point d'entrée principal pour tous les autres modules.
  // Crée un enregistrement Notification en DB puis enfile un job BullMQ.
  // ------------------------------------------------------------------

  async enqueue(params: EnqueueParams): Promise<void> {
    const {
      userId,
      bookingId,
      templateKey,
      variables,
      lang,
      phone,
      transactional,
    } = params;

    // Validation : s'assurer que les deux templates existent avant de persister
    renderTemplate(templateKey, 'FR', {});  // lève une erreur si manquant
    renderTemplate(templateKey, 'MG', {});  // lève une erreur si manquant

    // Upsert du NotificationTemplate en base (FK obligatoire)
    const prismaLang: Lang = lang === 'FR' ? Lang.FR : Lang.MG;
    const frTemplates = loadTemplates('FR');
    const mgTemplates = loadTemplates('MG');

    const dbTemplate = await this.db.notificationTemplate.upsert({
      where: { code: templateKey },
      update: {},
      create: {
        code: templateKey,
        category: categoryFor(templateKey),
        bodyFr: frTemplates[templateKey],
        bodyMg: mgTemplates[templateKey],
        isActive: true,
      },
    });

    const txFlag = transactional ?? isTransactional(templateKey);

    // Créer l'enregistrement Notification (statut PENDING)
    const notification = await this.db.notification.create({
      data: {
        ...(userId ? { userId } : {}),
        ...(bookingId ? { bookingId } : {}),
        templateId: dbTemplate.id,
        channel: NotificationChannel.SMS,
        category: txFlag
          ? NotificationCategory.TRANSACTIONAL
          : NotificationCategory.REMINDER,
        lang: prismaLang,
        toAddress: phone,
        payload: variables,
        status: NotificationStatus.PENDING,
      },
    });

    // Enfile dans BullMQ
    await enqueueSms({
      phone,
      templateCode: templateKey,
      params: variables,
      lang,
      ...(bookingId ? { bookingId } : {}),
      ...(userId ? { userId } : {}),
      notificationId: notification.id,
      isTransactional: txFlag,
    });
  }

  // ------------------------------------------------------------------
  // dispatch
  // Appelé par le worker BullMQ. Gère :
  //   1. Rendu du template dans la bonne langue
  //   2. Vérification silence nocturne (VH-02)
  //   3. Envoi via SmsProvider
  //   4. Mise à jour Notification.status en DB
  // ------------------------------------------------------------------

  async dispatch(jobData: SmsJobData): Promise<void> {
    const {
      phone,
      templateCode,
      params,
      lang,
      notificationId,
      isTransactional: txFlag,
    } = jobData;

    // 1. Rendu du template
    const text = renderTemplate(templateCode, lang, params);

    const now = new Date();

    // 2. Vérification silence nocturne
    if (!txFlag && isInSilenceWindow(now, this.silenceStart, this.silenceEnd)) {
      const scheduledFor = nextSendableTime(now, this.silenceEnd);

      // Mettre à jour la Notification en SCHEDULED avec scheduledFor
      if (notificationId) {
        await this.db.notification.update({
          where: { id: notificationId },
          data: {
            status: NotificationStatus.SCHEDULED,
            scheduledFor,
          },
        });
      }

      // Re-enfile avec un délai calculé (millisecondes jusqu'à scheduledFor)
      const delayMs = Math.max(0, scheduledFor.getTime() - now.getTime());
      await this._enqueueSmsDelayed({ ...jobData, text }, delayMs);

      // Lever une erreur pour que BullMQ ne marque pas ce job comme "réussi"
      // et ne le retire pas de la file avant l'envoi effectif.
      // Note : le job re-enfiled est indépendant, celui-ci peut être marqué
      // "completed" sans soucis car la Notification est déjà SCHEDULED.
      return; // Le job courant est terminé normalement — le nouveau job gérera l'envoi
    }

    // 3. Envoi via SmsProvider
    try {
      const result = await this.smsProvider.send({ to: phone, text, lang });

      // 4. Mettre à jour Notification en SENT
      if (notificationId) {
        await this.db.notification.update({
          where: { id: notificationId },
          data: {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
            providerRef: result.messageId,
          },
        });
      }
    } catch (err) {
      // 4b. Mettre à jour Notification en FAILED
      if (notificationId) {
        await this.db.notification
          .update({
            where: { id: notificationId },
            data: {
              status: NotificationStatus.FAILED,
              failedAt: new Date(),
              errorMessage:
                err instanceof Error ? err.message : String(err),
            },
          })
          .catch(() => {
            // Ignorer les erreurs de mise à jour DB lors d'un retry
          });
      }
      // Propager pour que BullMQ déclenche le retry (backoff 30s/2min/10min)
      throw err;
    }
  }

  // ------------------------------------------------------------------
  // listForUser
  // GET /v1/notifications — liste paginée (cursor-based)
  // Hypothèse : retourne { items, nextCursor } malgré le contrat "type: array"
  // car cursor+limit dans les query params n'ont de sens qu'avec une enveloppe.
  // ------------------------------------------------------------------

  async listForUser(
    userId: string,
    cursor?: string,
    limit = 20,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const take = Math.min(limit, 50);

    const items = await this.db.notification.findMany({
      where: {
        userId,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      select: {
        id: true,
        channel: true,
        category: true,
        lang: true,
        status: true,
        scheduledFor: true,
        sentAt: true,
        failedAt: true,
        createdAt: true,
        template: { select: { code: true } },
        payload: true,
      },
    });

    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      items: page.map((n) => ({
        id: n.id,
        channel: n.channel,
        category: n.category,
        lang: n.lang,
        status: n.status,
        templateCode: (n.template as { code: string }).code,
        payload: n.payload,
        scheduledFor: n.scheduledFor?.toISOString() ?? null,
        sentAt: n.sentAt?.toISOString() ?? null,
        failedAt: n.failedAt?.toISOString() ?? null,
        createdAt: (n.createdAt as Date).toISOString(),
      })),
      nextCursor,
    };
  }

  // ------------------------------------------------------------------
  // getPreferences / updatePreferences
  // Stocké en Redis (pas de modèle DB pour les préférences SMS).
  // ------------------------------------------------------------------

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const raw = await this.redis.get(prefsKey(userId));
    if (!raw) return { ...DEFAULT_PREFS };
    try {
      return JSON.parse(raw) as NotificationPreferences;
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  async updatePreferences(
    userId: string,
    prefs: Partial<NotificationPreferences>,
  ): Promise<void> {
    const current = await this.getPreferences(userId);
    const updated: NotificationPreferences = {
      smsEnabled: prefs.smsEnabled ?? current.smsEnabled,
      optedOutTemplates:
        prefs.optedOutTemplates ?? current.optedOutTemplates,
    };
    await this.redis.set(
      prefsKey(userId),
      JSON.stringify(updated),
      'EX',
      60 * 60 * 24 * 365, // 1 an TTL
    );
  }

  // ------------------------------------------------------------------
  // Helpers privés
  // ------------------------------------------------------------------

  /**
   * Re-enfile un job SMS avec un délai donné (pour le report silence nocturne).
   * On crée un nouveau job car BullMQ ne permet pas de modifier le délai d'un job
   * déjà en cours de traitement.
   */
  private async _enqueueSmsDelayed(
    jobData: SmsJobData & { text?: string },
    delayMs: number,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Queue } = require('bullmq') as typeof import('bullmq');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require('ioredis') as typeof import('ioredis').default;

    const connection = new Redis(
      process.env.REDIS_URL ?? 'redis://localhost:6379',
      { maxRetriesPerRequest: null, enableReadyCheck: false },
    );

    const queue = new Queue('sms.dispatch', { connection });

    // Le job différé est marqué transactionnel=true pour éviter la vérification
    // de silence au moment de l'envoi effectif (il sera déjà hors plage).
    const { text: _text, ...baseData } = jobData;
    await queue.add('dispatch', { ...baseData, isTransactional: true } satisfies SmsJobData, {
      delay: delayMs,
      attempts: 4,
      backoff: { type: 'custom' },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    });

    await queue.close();
    await (connection as unknown as { quit(): Promise<unknown> }).quit();
  }
}
