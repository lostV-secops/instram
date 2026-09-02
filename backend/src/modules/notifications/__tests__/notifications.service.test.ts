/**
 * Tests unitaires — NotificationsService
 *
 * Couverture obligatoire (spécification de tâche) :
 *  1. enqueue  crée bien un job BullMQ
 *  2. dispatch avec template FR et MG → interpolation correcte
 *  3. dispatch message transactionnel pendant silence nocturne → envoi immédiat
 *  4. dispatch message non transactionnel pendant silence → scheduledFor = lendemain 06h00
 *  5. dispatch hors plage silence → envoi immédiat quel que soit le type
 *  6. Retry sur échec SmsProvider → 3 tentatives (levée d'erreur par dispatch)
 *  7. isInSilenceWindow : 21h30 UTC+3 → true, 06h00 UTC+3 → false, 05h59 UTC+3 → true
 */

// =====================================================================
// Mocks — doivent être déclarés avant les imports
// =====================================================================

jest.mock('../../../infra/queue/sms.queue', () => ({
  enqueueSms: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('ioredis', () => {
  const MockRedis = jest.fn().mockImplementation(() => ({
    quit: jest.fn().mockResolvedValue('OK'),
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
  }));
  return MockRedis;
});

jest.mock('bullmq', () => {
  const Queue = jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'delayed-job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  }));
  const Worker = jest.fn().mockImplementation(() => ({ on: jest.fn() }));
  return { Queue, Worker };
});

import {
  NotificationsService,
  clearTemplateCache,
  renderTemplate,
  type EnqueueParams,
} from '../notifications.service';
import {
  isInSilenceWindow,
  nextSendableTime,
} from '../../../infra/sms/silence';
import { enqueueSms } from '../../../infra/queue/sms.queue';
import type { SmsJobData } from '../../../infra/queue/sms.queue';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

// =====================================================================
// Fixtures
// =====================================================================

const USER_ID = '00000000-0000-0000-0000-000000000001';
const BOOKING_ID = '00000000-0000-0000-0000-000000000050';
const NOTIF_ID = '00000000-0000-0000-0000-000000000099';
const TEMPLATE_ID = '00000000-0000-0000-0000-000000000088';

// =====================================================================
// Helpers de doubles de test
// =====================================================================

/** Crée un mock partiel de PrismaClient avec les accesseurs de Notification et NotificationTemplate */
function makeMockDb(): PrismaClient {
  return {
    notification: {
      create: jest.fn().mockResolvedValue({ id: NOTIF_ID }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    notificationTemplate: {
      upsert: jest.fn().mockResolvedValue({ id: TEMPLATE_ID, code: 'BOOKING_CONFIRMED' }),
    },
  } as unknown as PrismaClient;
}

function makeMockRedis(prefsJson?: string | null): Redis {
  return {
    get: jest.fn().mockResolvedValue(prefsJson ?? null),
    set: jest.fn().mockResolvedValue('OK'),
  } as unknown as Redis;
}

function makeMockSmsProvider(shouldFail = false) {
  return {
    send: shouldFail
      ? jest.fn().mockRejectedValue(new Error('SMS provider error'))
      : jest.fn().mockResolvedValue({ messageId: 'msg-abc-123' }),
  };
}

/** Crée un Date UTC correspondant à l'heure locale malgache fournie (UTC+3). */
function madTime(hour: number, minute = 0, second = 0): Date {
  const d = new Date('2026-09-02T00:00:00.000Z');
  d.setUTCHours(hour - 3, minute, second, 0);
  return d;
}

// =====================================================================
// 7. Tests de la logique silence (isInSilenceWindow)
// =====================================================================

describe('isInSilenceWindow', () => {
  const START = 21;
  const END = 6;

  test('21h30 heure malgache → dans la plage de silence', () => {
    expect(isInSilenceWindow(madTime(21, 30), START, END)).toBe(true);
  });

  test('06h00 heure malgache → hors silence (bord de fin, non inclus)', () => {
    expect(isInSilenceWindow(madTime(6, 0), START, END)).toBe(false);
  });

  test('05h59 heure malgache → dans la plage de silence', () => {
    expect(isInSilenceWindow(madTime(5, 59), START, END)).toBe(true);
  });

  test('12h00 heure malgache → hors silence', () => {
    expect(isInSilenceWindow(madTime(12, 0), START, END)).toBe(false);
  });

  test('00h00 heure malgache → dans la plage de silence', () => {
    expect(isInSilenceWindow(madTime(0, 0), START, END)).toBe(true);
  });

  test('21h00 exact → dans la plage de silence (bord de début)', () => {
    expect(isInSilenceWindow(madTime(21, 0), START, END)).toBe(true);
  });

  test('20h59 → hors silence (juste avant le début)', () => {
    expect(isInSilenceWindow(madTime(20, 59), START, END)).toBe(false);
  });
});

// =====================================================================
// Tests du rendu de templates (2 — interpolation)
// =====================================================================

describe('renderTemplate', () => {
  beforeEach(() => clearTemplateCache());

  test('template FR BOOKING_CONFIRMED — interpolation correcte', () => {
    const result = renderTemplate('BOOKING_CONFIRMED', 'FR', {
      reference: 'IT-A7X9B',
      departureAt: '2026-09-03 08:00',
      origin: 'Antananarivo',
    });
    expect(result).toContain('IT-A7X9B');
    expect(result).toContain('Antananarivo');
    expect(result).toContain('2026-09-03 08:00');
  });

  test('template MG BOOKING_CONFIRMED — interpolation correcte + mots malgaches', () => {
    const result = renderTemplate('BOOKING_CONFIRMED', 'MG', {
      reference: 'IT-A7X9B',
      departureAt: '2026-09-03 08:00',
      origin: 'Antananarivo',
    });
    expect(result).toContain('IT-A7X9B');
    expect(result).toContain('Antananarivo');
    expect(result).toMatch(/Voarakitra|fangatahana/);
  });

  test('clé inconnue en FR → erreur explicite (pas de fallback silencieux)', () => {
    expect(() => renderTemplate('UNKNOWN_KEY', 'FR', {})).toThrow(/manquant.*fr\.json/i);
  });

  test('clé inconnue en MG → erreur explicite mentionnant mg.json', () => {
    expect(() => renderTemplate('UNKNOWN_KEY', 'MG', {})).toThrow(/manquant.*mg\.json/i);
  });

  test('template WALK_IN_CONFIRMED FR — plusieurs variables interpolées', () => {
    const result = renderTemplate('WALK_IN_CONFIRMED', 'FR', {
      reference: 'IT-BB001',
      departureAt: '2026-09-04 07:30',
      origin: 'Tana',
      destination: 'Fianarantsoa',
    });
    expect(result).toContain('IT-BB001');
    expect(result).toContain('Tana');
    expect(result).toContain('Fianarantsoa');
  });

  test('template WALK_IN_CONFIRMED MG — plusieurs variables interpolées', () => {
    const result = renderTemplate('WALK_IN_CONFIRMED', 'MG', {
      reference: 'IT-BB001',
      departureAt: '2026-09-04 07:30',
      origin: 'Tana',
      destination: 'Fianarantsoa',
    });
    expect(result).toContain('IT-BB001');
    expect(result).toContain('Tana');
  });
});

// =====================================================================
// 1. Tests NotificationsService.enqueue
// =====================================================================

describe('NotificationsService.enqueue', () => {
  beforeEach(() => {
    clearTemplateCache();
    jest.clearAllMocks();
  });

  test('1. enqueue crée un enregistrement Notification en DB et un job BullMQ', async () => {
    const db = makeMockDb();
    const svc = new NotificationsService(db, makeMockRedis(), makeMockSmsProvider());

    const params: EnqueueParams = {
      userId: USER_ID,
      bookingId: BOOKING_ID,
      templateKey: 'BOOKING_CONFIRMED',
      variables: { reference: 'IT-TEST1', departureAt: '2026-09-03', origin: 'Tana' },
      lang: 'FR',
      phone: '+261340000001',
      transactional: true,
    };

    await svc.enqueue(params);

    const dbTemplates = db.notificationTemplate as unknown as { upsert: jest.Mock };
    const dbNotif = db.notification as unknown as { create: jest.Mock };

    expect(dbTemplates.upsert).toHaveBeenCalledTimes(1);
    expect(dbNotif.create).toHaveBeenCalledTimes(1);

    const createArg = dbNotif.create.mock.calls[0][0];
    expect(createArg.data.toAddress).toBe('+261340000001');
    expect(createArg.data.lang).toBe('FR');

    expect(enqueueSms).toHaveBeenCalledTimes(1);
    const smsArg = (enqueueSms as jest.Mock).mock.calls[0][0] as SmsJobData;
    expect(smsArg.phone).toBe('+261340000001');
    expect(smsArg.templateCode).toBe('BOOKING_CONFIRMED');
    expect(smsArg.notificationId).toBe(NOTIF_ID);
    expect(smsArg.isTransactional).toBe(true);
  });

  test('enqueue avec lang MG → lang MG dans la Notification DB et dans le job BullMQ', async () => {
    const db = makeMockDb();
    const svc = new NotificationsService(db, makeMockRedis(), makeMockSmsProvider());

    await svc.enqueue({
      userId: USER_ID,
      templateKey: 'TRIP_REMINDER',
      variables: { reference: 'IT-MG01', origin: 'Tana', destination: 'Fianar', departureAt: '2026-09-05' },
      lang: 'MG',
      phone: '+261340000002',
    });

    const dbNotif = db.notification as unknown as { create: jest.Mock };
    expect(dbNotif.create.mock.calls[0][0].data.lang).toBe('MG');

    const smsArg = (enqueueSms as jest.Mock).mock.calls[0][0] as SmsJobData;
    expect(smsArg.lang).toBe('MG');
  });

  test('enqueue lève une erreur si le template est manquant', async () => {
    const db = makeMockDb();
    const svc = new NotificationsService(db, makeMockRedis(), makeMockSmsProvider());

    await expect(
      svc.enqueue({
        userId: USER_ID,
        templateKey: 'TEMPLATE_INEXISTANT',
        variables: {},
        lang: 'FR',
        phone: '+261340000003',
      }),
    ).rejects.toThrow(/manquant/);
  });
});

// =====================================================================
// 2–6. Tests NotificationsService.dispatch
// =====================================================================

describe('NotificationsService.dispatch', () => {
  beforeEach(() => {
    clearTemplateCache();
    jest.clearAllMocks();
    process.env.SILENCE_START_HOUR = '21';
    process.env.SILENCE_END_HOUR = '6';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const baseJob: SmsJobData = {
    phone: '+261340000010',
    templateCode: 'BOOKING_CONFIRMED',
    params: { reference: 'IT-D001', departureAt: '2026-09-03 08:00', origin: 'Tana' },
    lang: 'FR',
    userId: USER_ID,
    notificationId: NOTIF_ID,
    isTransactional: true,
  };

  // ------------------------------------------------------------------
  // Test 2a : interpolation FR
  // ------------------------------------------------------------------
  test('2a. dispatch FR → interpolation correcte, SmsProvider reçoit le texte rendu', async () => {
    jest.useFakeTimers({ now: madTime(10, 0) }); // 10h00 local, hors silence

    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider();
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    await svc.dispatch(baseJob);

    expect(smsProvider.send).toHaveBeenCalledTimes(1);
    const sendArg = (smsProvider.send as jest.Mock).mock.calls[0][0];
    expect(sendArg.text).toContain('IT-D001');
    expect(sendArg.text).toContain('Tana');
    expect(sendArg.lang).toBe('FR');
  });

  // ------------------------------------------------------------------
  // Test 2b : interpolation MG
  // ------------------------------------------------------------------
  test('2b. dispatch MG → interpolation correcte, texte contient des mots malgaches', async () => {
    jest.useFakeTimers({ now: madTime(10, 0) }); // hors silence

    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider();
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    const jobMg: SmsJobData = {
      ...baseJob,
      lang: 'MG',
      params: { reference: 'IT-MG02', departureAt: '2026-09-03', origin: 'Tana' },
    };

    await svc.dispatch(jobMg);

    expect(smsProvider.send).toHaveBeenCalledTimes(1);
    const sendArg = (smsProvider.send as jest.Mock).mock.calls[0][0];
    expect(sendArg.text).toContain('IT-MG02');
    expect(sendArg.text).toMatch(/Voarakitra|fangatahana/);
  });

  // ------------------------------------------------------------------
  // Test 3 : TRANSACTIONNEL pendant silence → envoi immédiat
  // ------------------------------------------------------------------
  test('3. dispatch transactionnel pendant silence nocturne → envoi immédiat', async () => {
    jest.useFakeTimers({ now: madTime(22, 0) }); // 22h00 local = silence

    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider();
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    await svc.dispatch({ ...baseJob, isTransactional: true });

    expect(smsProvider.send).toHaveBeenCalledTimes(1);

    const dbNotif = db.notification as unknown as { update: jest.Mock };
    const scheduledCalls = dbNotif.update.mock.calls.filter(
      (c: unknown[]) => (c[0] as { data: { status: string } }).data?.status === 'SCHEDULED',
    );
    expect(scheduledCalls.length).toBe(0);
  });

  // ------------------------------------------------------------------
  // Test 4 : NON-transactionnel pendant silence → scheduledFor = lendemain 06h00
  // ------------------------------------------------------------------
  test('4. dispatch non-transactionnel pendant silence → scheduledFor = lendemain 06h00 UTC+3', async () => {
    const now = madTime(21, 30);
    jest.useFakeTimers({ now });

    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider();
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    const nonTxJob: SmsJobData = {
      ...baseJob,
      templateCode: 'TRIP_REMINDER',
      params: { reference: 'IT-R001', origin: 'Tana', destination: 'Fianar', departureAt: '2026-09-03' },
      isTransactional: false,
    };

    await svc.dispatch(nonTxJob);

    // Pas d'appel SMS immédiat
    expect(smsProvider.send).not.toHaveBeenCalled();

    // Notification mise en SCHEDULED
    const dbNotif = db.notification as unknown as { update: jest.Mock };
    const scheduledCall = dbNotif.update.mock.calls.find(
      (c: unknown[]) => (c[0] as { data: { status: string } }).data?.status === 'SCHEDULED',
    );
    expect(scheduledCall).toBeDefined();

    // scheduledFor = lendemain 06h00 UTC+3
    const scheduledFor: Date = (scheduledCall![0] as { data: { scheduledFor: Date } }).data.scheduledFor;
    const expected = nextSendableTime(now, 6);
    expect(Math.abs(scheduledFor.getTime() - expected.getTime())).toBeLessThan(1000);

    // Vérifier l'heure locale (06h00 UTC+3)
    const localHour = Math.floor(((scheduledFor.getTime() + 3 * 60 * 60 * 1000) / (60 * 60 * 1000)) % 24);
    expect(localHour).toBe(6);
  });

  // ------------------------------------------------------------------
  // Test 5 : hors plage silence → envoi immédiat quel que soit le type
  // ------------------------------------------------------------------
  test('5. dispatch hors plage silence → envoi immédiat pour message non-transactionnel', async () => {
    jest.useFakeTimers({ now: madTime(10, 0) }); // 10h00 local, hors silence

    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider();
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    const nonTxJob: SmsJobData = {
      ...baseJob,
      templateCode: 'TRIP_REMINDER',
      params: { reference: 'IT-R002', origin: 'Tana', destination: 'Fianar', departureAt: '2026-09-03' },
      isTransactional: false,
    };

    await svc.dispatch(nonTxJob);

    expect(smsProvider.send).toHaveBeenCalledTimes(1);

    const dbNotif = db.notification as unknown as { update: jest.Mock };
    const scheduledCalls = dbNotif.update.mock.calls.filter(
      (c: unknown[]) => (c[0] as { data: { status: string } }).data?.status === 'SCHEDULED',
    );
    expect(scheduledCalls.length).toBe(0);
  });

  // ------------------------------------------------------------------
  // Test 6 : Retry sur échec SmsProvider
  // ------------------------------------------------------------------
  test('6. dispatch lève une erreur sur échec SmsProvider → BullMQ peut déclencher le retry', async () => {
    jest.useFakeTimers({ now: madTime(10, 0) }); // hors silence

    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider(true); // shouldFail = true
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    await expect(svc.dispatch(baseJob)).rejects.toThrow('SMS provider error');

    const dbNotif = db.notification as unknown as { update: jest.Mock };
    const failedCall = dbNotif.update.mock.calls.find(
      (c: unknown[]) => (c[0] as { data: { status: string } }).data?.status === 'FAILED',
    );
    expect(failedCall).toBeDefined();
    expect((failedCall![0] as { data: { errorMessage: string } }).data.errorMessage).toContain(
      'SMS provider error',
    );
  });

  test('6b. dispatch — errorMessage correct dans la Notification sur échec réseau', async () => {
    jest.useFakeTimers({ now: madTime(10, 0) });

    const db = makeMockDb();
    const smsProvider = { send: jest.fn().mockRejectedValue(new Error('Network timeout')) };
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    try {
      await svc.dispatch(baseJob);
    } catch {
      // erreur attendue
    }

    const dbNotif = db.notification as unknown as { update: jest.Mock };
    const failedCall = dbNotif.update.mock.calls.find(
      (c: unknown[]) => (c[0] as { data: { status: string } }).data?.status === 'FAILED',
    );
    expect((failedCall![0] as { data: { errorMessage: string } }).data.errorMessage).toBe('Network timeout');
  });

  test('dispatch succès → Notification mise à jour en SENT avec sentAt et providerRef', async () => {
    jest.useFakeTimers({ now: madTime(10, 0) });

    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider(); // messageId: 'msg-abc-123'
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    await svc.dispatch(baseJob);

    const dbNotif = db.notification as unknown as { update: jest.Mock };
    const sentCall = dbNotif.update.mock.calls.find(
      (c: unknown[]) => (c[0] as { data: { status: string } }).data?.status === 'SENT',
    );
    expect(sentCall).toBeDefined();
    expect((sentCall![0] as { data: { providerRef: string } }).data.providerRef).toBe('msg-abc-123');
  });
});

// =====================================================================
// Tests getPreferences / updatePreferences
// =====================================================================

describe('NotificationsService — préférences SMS', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getPreferences retourne les valeurs par défaut si pas de clé Redis', async () => {
    const svc = new NotificationsService(makeMockDb(), makeMockRedis(null), makeMockSmsProvider());
    const prefs = await svc.getPreferences(USER_ID);
    expect(prefs.smsEnabled).toBe(true);
    expect(prefs.optedOutTemplates).toEqual([]);
  });

  test('getPreferences désérialise correctement la valeur Redis', async () => {
    const stored = JSON.stringify({ smsEnabled: false, optedOutTemplates: ['TRIP_REMINDER'] });
    const svc = new NotificationsService(makeMockDb(), makeMockRedis(stored), makeMockSmsProvider());
    const prefs = await svc.getPreferences(USER_ID);
    expect(prefs.smsEnabled).toBe(false);
    expect(prefs.optedOutTemplates).toContain('TRIP_REMINDER');
  });

  test('updatePreferences écrit en Redis et fusionne avec les valeurs existantes', async () => {
    const redis = makeMockRedis();
    const svc = new NotificationsService(makeMockDb(), redis, makeMockSmsProvider());

    await svc.updatePreferences(USER_ID, { optedOutTemplates: ['TRIP_REMINDER'] });

    const redisAny = redis as unknown as { set: jest.Mock };
    expect(redisAny.set).toHaveBeenCalledTimes(1);
    const [, written] = redisAny.set.mock.calls[0];
    const parsed = JSON.parse(written as string) as { optedOutTemplates: string[] };
    expect(parsed.optedOutTemplates).toContain('TRIP_REMINDER');
  });
});

// =====================================================================
// Tests nextSendableTime
// =====================================================================

describe('nextSendableTime', () => {
  test('21h30 UTC+3 → lendemain 06h00 UTC+3 (03h00 UTC)', () => {
    const now = madTime(21, 30);
    const result = nextSendableTime(now, 6);
    const localHour = Math.floor(((result.getTime() + 3 * 60 * 60 * 1000) / (60 * 60 * 1000)) % 24);
    expect(localHour).toBe(6);
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });

  test('00h30 UTC+3 → lendemain 06h00 UTC+3', () => {
    const now = madTime(0, 30);
    const result = nextSendableTime(now, 6);
    const localHour = Math.floor(((result.getTime() + 3 * 60 * 60 * 1000) / (60 * 60 * 1000)) % 24);
    expect(localHour).toBe(6);
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });

  test('10h00 UTC+3 → lendemain 06h00 UTC+3 (bien dans le futur)', () => {
    const now = madTime(10, 0);
    const result = nextSendableTime(now, 6);
    const localHour = Math.floor(((result.getTime() + 3 * 60 * 60 * 1000) / (60 * 60 * 1000)) % 24);
    expect(localHour).toBe(6);
    // Lendemain 06h00 est environ 20h plus tard
    expect(result.getTime() - now.getTime()).toBeGreaterThan(15 * 60 * 60 * 1000);
  });
});
