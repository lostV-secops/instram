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
 *
 * Tous les tests sont unitaires : aucune connexion DB ou Redis réelle.
 */

// =====================================================================
// Mocks — doivent être déclarés avant les imports
// =====================================================================

jest.mock('../../../infra/queue/sms.queue', () => ({
  enqueueSms: jest.fn().mockResolvedValue(undefined),
}));

// Mock du module ioredis pour le _enqueueSmsDelayed interne
jest.mock('ioredis', () => {
  const quit = jest.fn().mockResolvedValue('OK');
  const set = jest.fn().mockResolvedValue('OK');
  const get = jest.fn().mockResolvedValue(null);
  const MockRedis = jest.fn().mockImplementation(() => ({
    quit,
    set,
    get,
  }));
  return MockRedis;
});

// Mock du module bullmq pour le _enqueueSmsDelayed interne
jest.mock('bullmq', () => {
  const addMock = jest.fn().mockResolvedValue({ id: 'delayed-job-1' });
  const closeMock = jest.fn().mockResolvedValue(undefined);
  const Queue = jest.fn().mockImplementation(() => ({
    add: addMock,
    close: closeMock,
  }));
  const Worker = jest.fn().mockImplementation((_name: string, _fn: unknown) => ({
    on: jest.fn(),
  }));
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

// =====================================================================
// Fixtures
// =====================================================================

const USER_ID = '00000000-0000-0000-0000-000000000001';
const BOOKING_ID = '00000000-0000-0000-0000-000000000050';
const NOTIF_ID = '00000000-0000-0000-0000-000000000099';
const TEMPLATE_ID = '00000000-0000-0000-0000-000000000088';

// =====================================================================
// Doubles de test
// =====================================================================

function makeMockDb(overrides: Record<string, unknown> = {}) {
  const update = jest.fn().mockResolvedValue({});
  const create = jest.fn().mockResolvedValue({ id: NOTIF_ID });
  const upsert = jest.fn().mockResolvedValue({ id: TEMPLATE_ID, code: 'BOOKING_CONFIRMED' });
  const findMany = jest.fn().mockResolvedValue([]);
  const get = jest.fn().mockResolvedValue(null);

  return {
    notification: { create, update, findMany },
    notificationTemplate: { upsert },
    ...overrides,
  } as unknown as import('@prisma/client').PrismaClient;
}

function makeMockRedis(prefsJson?: string) {
  const get = jest.fn().mockResolvedValue(prefsJson ?? null);
  const set = jest.fn().mockResolvedValue('OK');
  return { get, set } as unknown as import('ioredis').Redis;
}

function makeMockSmsProvider(shouldFail = false) {
  return {
    send: shouldFail
      ? jest.fn().mockRejectedValue(new Error('SMS provider error'))
      : jest.fn().mockResolvedValue({ messageId: 'msg-abc-123' }),
  };
}

// =====================================================================
// Helper : UTC timestamp à une heure locale malgache donnée (UTC+3)
// =====================================================================

/**
 * Crée un Date UTC correspondant à l'heure locale malgache fournie.
 * Exemple : madTime(21, 30) → 18h30 UTC
 */
function madTime(hour: number, minute = 0, second = 0): Date {
  // Madagascar = UTC+3 → pour obtenir l'heure locale, UTC_hour = local_hour - 3
  const utcHour = hour - 3;
  const d = new Date('2026-09-02T00:00:00.000Z');
  d.setUTCHours(utcHour, minute, second, 0);
  return d;
}

// =====================================================================
// Tests de la logique silence (isInSilenceWindow)
// =====================================================================

describe('isInSilenceWindow', () => {
  const START = 21;
  const END = 6;

  test('21h30 heure malgache → dans la plage de silence', () => {
    const now = madTime(21, 30);
    expect(isInSilenceWindow(now, START, END)).toBe(true);
  });

  test('06h00 heure malgache → hors silence (exact bord de fin)', () => {
    const now = madTime(6, 0);
    expect(isInSilenceWindow(now, START, END)).toBe(false);
  });

  test('05h59 heure malgache → dans la plage de silence', () => {
    const now = madTime(5, 59);
    expect(isInSilenceWindow(now, START, END)).toBe(true);
  });

  test('12h00 heure malgache → hors silence', () => {
    const now = madTime(12, 0);
    expect(isInSilenceWindow(now, START, END)).toBe(false);
  });

  test('00h00 heure malgache → dans la plage de silence', () => {
    const now = madTime(0, 0);
    expect(isInSilenceWindow(now, START, END)).toBe(true);
  });

  test('21h00 exact heure malgache → dans la plage de silence (bord de début)', () => {
    const now = madTime(21, 0);
    expect(isInSilenceWindow(now, START, END)).toBe(true);
  });

  test('20h59 heure malgache → hors silence (juste avant le début)', () => {
    const now = madTime(20, 59);
    expect(isInSilenceWindow(now, START, END)).toBe(false);
  });
});

// =====================================================================
// Tests du rendu de templates
// =====================================================================

describe('renderTemplate', () => {
  beforeEach(() => clearTemplateCache());

  test('template FR BOOKING_CONFIRMED interpolé correctement', () => {
    const result = renderTemplate('BOOKING_CONFIRMED', 'FR', {
      reference: 'IT-A7X9B',
      departureAt: '2026-09-03 08:00',
      origin: 'Antananarivo',
    });
    expect(result).toContain('IT-A7X9B');
    expect(result).toContain('Antananarivo');
    expect(result).toContain('2026-09-03 08:00');
  });

  test('template MG BOOKING_CONFIRMED interpolé correctement', () => {
    const result = renderTemplate('BOOKING_CONFIRMED', 'MG', {
      reference: 'IT-A7X9B',
      departureAt: '2026-09-03 08:00',
      origin: 'Antananarivo',
    });
    expect(result).toContain('IT-A7X9B');
    expect(result).toContain('Antananarivo');
    // Vérification que le texte MG contient des mots malgaches
    expect(result).toMatch(/Voarakitra|fangatahana/);
  });

  test('clé template inconnue → erreur explicite (pas de fallback silencieux)', () => {
    expect(() =>
      renderTemplate('UNKNOWN_KEY', 'FR', {}),
    ).toThrow(/manquant.*fr\.json/i);
  });

  test('clé template inconnue en MG → erreur explicite mentionnant MG', () => {
    expect(() =>
      renderTemplate('UNKNOWN_KEY', 'MG', {}),
    ).toThrow(/manquant.*mg\.json/i);
  });

  test('template WALK_IN_CONFIRMED FR interpolé avec plusieurs variables', () => {
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

  test('template WALK_IN_CONFIRMED MG interpolé avec plusieurs variables', () => {
    const result = renderTemplate('WALK_IN_CONFIRMED', 'MG', {
      reference: 'IT-BB001',
      departureAt: '2026-09-04 07:30',
      origin: 'Tana',
      destination: 'Fianarantsoa',
    });
    expect(result).toContain('IT-BB001');
  });
});

// =====================================================================
// Tests NotificationsService.enqueue
// =====================================================================

describe('NotificationsService.enqueue', () => {
  beforeEach(() => {
    clearTemplateCache();
    jest.clearAllMocks();
  });

  test('enqueue crée un enregistrement Notification en DB et un job BullMQ', async () => {
    const db = makeMockDb();
    const redis = makeMockRedis();
    const smsProvider = makeMockSmsProvider();
    const svc = new NotificationsService(db, redis, smsProvider);

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

    // Vérification DB : upsert template + create notification
    expect((db.notificationTemplate as { upsert: jest.Mock }).upsert).toHaveBeenCalledTimes(1);
    expect((db.notification as { create: jest.Mock }).create).toHaveBeenCalledTimes(1);

    const createCall = ((db.notification as { create: jest.Mock }).create).mock.calls[0][0];
    expect(createCall.data.toAddress).toBe('+261340000001');
    expect(createCall.data.lang).toBe('FR');

    // Vérification BullMQ : enqueueSms appelé
    expect(enqueueSms).toHaveBeenCalledTimes(1);
    const smsCall = (enqueueSms as jest.Mock).mock.calls[0][0] as SmsJobData;
    expect(smsCall.phone).toBe('+261340000001');
    expect(smsCall.templateCode).toBe('BOOKING_CONFIRMED');
    expect(smsCall.notificationId).toBe(NOTIF_ID);
    expect(smsCall.isTransactional).toBe(true);
  });

  test('enqueue avec lang MG → lang MG dans la Notification DB', async () => {
    const db = makeMockDb();
    const redis = makeMockRedis();
    const svc = new NotificationsService(db, redis, makeMockSmsProvider());

    await svc.enqueue({
      userId: USER_ID,
      templateKey: 'TRIP_REMINDER',
      variables: { reference: 'IT-MG01', origin: 'Tana', destination: 'Fianar', departureAt: '2026-09-05' },
      lang: 'MG',
      phone: '+261340000002',
    });

    const createCall = ((db.notification as { create: jest.Mock }).create).mock.calls[0][0];
    expect(createCall.data.lang).toBe('MG');
    const smsCall = (enqueueSms as jest.Mock).mock.calls[0][0] as SmsJobData;
    expect(smsCall.lang).toBe('MG');
  });

  test('enqueue lève une erreur si un template est manquant', async () => {
    const db = makeMockDb();
    const redis = makeMockRedis();
    const svc = new NotificationsService(db, redis, makeMockSmsProvider());

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
// Tests NotificationsService.dispatch
// =====================================================================

describe('NotificationsService.dispatch', () => {
  // Sauvegarde des variables d'env
  const originalSilenceStart = process.env.SILENCE_START_HOUR;
  const originalSilenceEnd = process.env.SILENCE_END_HOUR;

  beforeEach(() => {
    clearTemplateCache();
    jest.clearAllMocks();
    process.env.SILENCE_START_HOUR = '21';
    process.env.SILENCE_END_HOUR = '6';
  });

  afterEach(() => {
    process.env.SILENCE_START_HOUR = originalSilenceStart;
    process.env.SILENCE_END_HOUR = originalSilenceEnd;
  });

  // Base job data pour les tests
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
  // Test 2 : interpolation correcte FR et MG
  // ------------------------------------------------------------------
  test('dispatch FR → interpolation correcte du template', async () => {
    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider();
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    // Envoi pendant le jour (hors silence) pour tester l'interpolation seule
    jest.spyOn(Date, 'now').mockReturnValue(madTime(10, 0).getTime());
    const realDate = Date;
    jest.spyOn(global, 'Date').mockImplementation((arg?: unknown) => {
      if (arg === undefined) return new realDate(madTime(10, 0).getTime());
      // @ts-expect-error - mock partiel
      return new realDate(arg);
    });

    await svc.dispatch(baseJob);

    expect(smsProvider.send).toHaveBeenCalledTimes(1);
    const sendCall = (smsProvider.send as jest.Mock).mock.calls[0][0];
    expect(sendCall.text).toContain('IT-D001');
    expect(sendCall.text).toContain('Tana');
    expect(sendCall.lang).toBe('FR');

    jest.restoreAllMocks();
  });

  test('dispatch MG → interpolation correcte du template', async () => {
    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider();
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    const jobMg: SmsJobData = {
      ...baseJob,
      lang: 'MG',
      templateCode: 'BOOKING_CONFIRMED',
      params: { reference: 'IT-MG02', departureAt: '2026-09-03', origin: 'Tana' },
    };

    // Hors silence (10h local)
    const fixedNow = madTime(10, 0);
    jest
      .spyOn(global, 'Date')
      .mockImplementation(function (this: unknown, arg?: unknown) {
        if (arg === undefined) return fixedNow;
        // @ts-expect-error - mock partiel
        return new (jest.requireActual('date') ?? Date)(arg);
      } as unknown as DateConstructor);

    await svc.dispatch(jobMg);

    expect(smsProvider.send).toHaveBeenCalledTimes(1);
    const sendCall = (smsProvider.send as jest.Mock).mock.calls[0][0];
    expect(sendCall.text).toContain('IT-MG02');
    // Vérifie présence d'un mot malgache
    expect(sendCall.text).toMatch(/Voarakitra|fangatahana/);

    jest.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // Test 3 : message TRANSACTIONNEL pendant silence → envoi immédiat
  // ------------------------------------------------------------------
  test('dispatch transactionnel pendant silence nocturne → envoi immédiat (bypass silence)', async () => {
    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider();
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    // 22h00 heure malgache (dans la plage 21h-06h)
    const duringNight = madTime(22, 0);
    const RealDate = Date;
    const MockDate = jest.fn(() => duringNight) as unknown as typeof Date;
    MockDate.now = jest.fn(() => duringNight.getTime());
    (MockDate as unknown as { parse: typeof Date.parse }).parse = RealDate.parse;
    (MockDate as unknown as { UTC: typeof Date.UTC }).UTC = RealDate.UTC;
    global.Date = MockDate;

    const txJob: SmsJobData = {
      ...baseJob,
      isTransactional: true,
    };

    await svc.dispatch(txJob);

    // Doit appeler le provider SMS immédiatement
    expect(smsProvider.send).toHaveBeenCalledTimes(1);
    // Ne doit PAS mettre à jour en SCHEDULED
    const updateCalls = ((db.notification as { update: jest.Mock }).update).mock.calls;
    const scheduledCalls = updateCalls.filter((c) =>
      c[0]?.data?.status === 'SCHEDULED',
    );
    expect(scheduledCalls.length).toBe(0);

    global.Date = RealDate;
  });

  // ------------------------------------------------------------------
  // Test 4 : message NON-transactionnel pendant silence → scheduledFor = lendemain 06h00
  // ------------------------------------------------------------------
  test('dispatch non-transactionnel pendant silence → scheduledFor = lendemain 06h00 UTC+3', async () => {
    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider();
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    // 21h30 heure malgache (dans la plage silence)
    const duringNight = madTime(21, 30);
    const RealDate = Date;
    const MockDate = jest.fn(() => duringNight) as unknown as typeof Date;
    MockDate.now = jest.fn(() => duringNight.getTime());
    (MockDate as unknown as { parse: typeof Date.parse }).parse = RealDate.parse;
    (MockDate as unknown as { UTC: typeof Date.UTC }).UTC = RealDate.UTC;
    global.Date = MockDate;

    const nonTxJob: SmsJobData = {
      ...baseJob,
      templateCode: 'TRIP_REMINDER',
      params: { reference: 'IT-R001', origin: 'Tana', destination: 'Fianar', departureAt: '2026-09-03' },
      isTransactional: false,
    };

    await svc.dispatch(nonTxJob);

    // Ne doit PAS appeler le provider SMS
    expect(smsProvider.send).not.toHaveBeenCalled();

    // Doit mettre à jour la Notification en SCHEDULED
    const updateCall = ((db.notification as { update: jest.Mock }).update).mock.calls.find(
      (c) => c[0]?.data?.status === 'SCHEDULED',
    );
    expect(updateCall).toBeDefined();

    // Vérifier scheduledFor = lendemain 06h00 UTC+3 = lendemain 03h00 UTC
    const scheduledFor: Date = updateCall![0].data.scheduledFor;
    const expectedNext = nextSendableTime(duringNight, 6);
    // Tolérance de 1 seconde pour les éventuels déphasages de test
    expect(Math.abs(scheduledFor.getTime() - expectedNext.getTime())).toBeLessThan(1000);

    // Vérifier que scheduledFor est bien à 06h00 heure malgache (03h00 UTC)
    const scheduledLocalHour =
      (scheduledFor.getTime() + 3 * 60 * 60 * 1000) / (60 * 60 * 1000) % 24;
    expect(Math.floor(scheduledLocalHour)).toBe(6);

    global.Date = RealDate;
  });

  // ------------------------------------------------------------------
  // Test 5 : hors plage silence → envoi immédiat quel que soit le type
  // ------------------------------------------------------------------
  test('dispatch hors plage silence → envoi immédiat pour message non-transactionnel', async () => {
    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider();
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    // 10h00 heure malgache (hors silence)
    const daytime = madTime(10, 0);
    const RealDate = Date;
    const MockDate = jest.fn(() => daytime) as unknown as typeof Date;
    MockDate.now = jest.fn(() => daytime.getTime());
    (MockDate as unknown as { parse: typeof Date.parse }).parse = RealDate.parse;
    (MockDate as unknown as { UTC: typeof Date.UTC }).UTC = RealDate.UTC;
    global.Date = MockDate;

    const nonTxJob: SmsJobData = {
      ...baseJob,
      templateCode: 'TRIP_REMINDER',
      params: { reference: 'IT-R002', origin: 'Tana', destination: 'Fianar', departureAt: '2026-09-03' },
      isTransactional: false,
    };

    await svc.dispatch(nonTxJob);

    // Doit appeler le provider SMS immédiatement
    expect(smsProvider.send).toHaveBeenCalledTimes(1);
    // Ne doit PAS mettre à jour en SCHEDULED
    const updateCalls = ((db.notification as { update: jest.Mock }).update).mock.calls;
    const scheduledCalls = updateCalls.filter(
      (c) => c[0]?.data?.status === 'SCHEDULED',
    );
    expect(scheduledCalls.length).toBe(0);

    global.Date = RealDate;
  });

  // ------------------------------------------------------------------
  // Test 6 : Retry sur échec SmsProvider
  // ------------------------------------------------------------------
  test('dispatch lève une erreur sur échec SmsProvider pour que BullMQ déclenche le retry', async () => {
    const db = makeMockDb();
    const smsProvider = makeMockSmsProvider(true); // shouldFail = true
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    // Hors silence pour isoler l'échec du provider
    const daytime = madTime(10, 0);
    const RealDate = Date;
    const MockDate = jest.fn(() => daytime) as unknown as typeof Date;
    MockDate.now = jest.fn(() => daytime.getTime());
    (MockDate as unknown as { parse: typeof Date.parse }).parse = RealDate.parse;
    (MockDate as unknown as { UTC: typeof Date.UTC }).UTC = RealDate.UTC;
    global.Date = MockDate;

    await expect(svc.dispatch(baseJob)).rejects.toThrow('SMS provider error');

    // Notification doit être marquée FAILED
    const updateCall = ((db.notification as { update: jest.Mock }).update).mock.calls.find(
      (c) => c[0]?.data?.status === 'FAILED',
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0].data.errorMessage).toContain('SMS provider error');

    global.Date = RealDate;
  });

  test('dispatch sur échec : errorMessage contenu dans la Notification', async () => {
    const db = makeMockDb();
    const smsProvider = {
      send: jest.fn().mockRejectedValue(new Error('Network timeout')),
    };
    const svc = new NotificationsService(db, makeMockRedis(), smsProvider);

    const daytime = madTime(10, 0);
    const RealDate = Date;
    const MockDate = jest.fn(() => daytime) as unknown as typeof Date;
    MockDate.now = jest.fn(() => daytime.getTime());
    (MockDate as unknown as { parse: typeof Date.parse }).parse = RealDate.parse;
    (MockDate as unknown as { UTC: typeof Date.UTC }).UTC = RealDate.UTC;
    global.Date = MockDate;

    try {
      await svc.dispatch(baseJob);
    } catch {
      // expected
    }

    const failedUpdate = ((db.notification as { update: jest.Mock }).update).mock.calls.find(
      (c) => c[0]?.data?.status === 'FAILED',
    );
    expect(failedUpdate![0].data.errorMessage).toBe('Network timeout');

    global.Date = RealDate;
  });
});

// =====================================================================
// Tests getPreferences / updatePreferences
// =====================================================================

describe('NotificationsService — préférences SMS', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getPreferences retourne les valeurs par défaut si pas de clé Redis', async () => {
    const svc = new NotificationsService(
      makeMockDb(),
      makeMockRedis(null as unknown as undefined),
      makeMockSmsProvider(),
    );
    const prefs = await svc.getPreferences(USER_ID);
    expect(prefs.smsEnabled).toBe(true);
    expect(prefs.optedOutTemplates).toEqual([]);
  });

  test('getPreferences lit la valeur Redis et la désérialise', async () => {
    const stored = JSON.stringify({
      smsEnabled: false,
      optedOutTemplates: ['TRIP_REMINDER'],
    });
    const svc = new NotificationsService(
      makeMockDb(),
      makeMockRedis(stored),
      makeMockSmsProvider(),
    );
    const prefs = await svc.getPreferences(USER_ID);
    expect(prefs.smsEnabled).toBe(false);
    expect(prefs.optedOutTemplates).toContain('TRIP_REMINDER');
  });

  test('updatePreferences écrit en Redis et fusionne avec les valeurs existantes', async () => {
    const redis = makeMockRedis();
    const svc = new NotificationsService(makeMockDb(), redis, makeMockSmsProvider());

    await svc.updatePreferences(USER_ID, {
      optedOutTemplates: ['TRIP_REMINDER'],
    });

    expect((redis as { set: jest.Mock }).set).toHaveBeenCalledTimes(1);
    const setCall = ((redis as { set: jest.Mock }).set).mock.calls[0];
    const written = JSON.parse(setCall[1]) as { optedOutTemplates: string[] };
    expect(written.optedOutTemplates).toContain('TRIP_REMINDER');
  });
});

// =====================================================================
// Tests nextSendableTime
// =====================================================================

describe('nextSendableTime', () => {
  test('21h30 UTC+3 → lendemain 06h00 UTC+3 = lendemain 03h00 UTC', () => {
    const now = madTime(21, 30); // 18h30 UTC
    const result = nextSendableTime(now, 6);

    // Lendemain 06h00 UTC+3 = lendemain 03h00 UTC
    const resultLocalHour =
      Math.floor((result.getTime() + 3 * 60 * 60 * 1000) / (60 * 60 * 1000)) % 24;
    expect(resultLocalHour).toBe(6);

    // La date est bien le lendemain
    const tomorrowMidnightLocal =
      Math.floor((now.getTime() + 3 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000)
      + 24 * 60 * 60 * 1000;
    expect(result.getTime()).toBeGreaterThan(now.getTime());
    expect(result.getTime()).toBeLessThan(tomorrowMidnightLocal + 7 * 60 * 60 * 1000);
  });

  test('00h30 UTC+3 → lendemain 06h00 UTC+3 (même nuit, j+1)', () => {
    const now = madTime(0, 30);
    const result = nextSendableTime(now, 6);
    const resultLocalHour =
      Math.floor((result.getTime() + 3 * 60 * 60 * 1000) / (60 * 60 * 1000)) % 24;
    expect(resultLocalHour).toBe(6);
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });
});
