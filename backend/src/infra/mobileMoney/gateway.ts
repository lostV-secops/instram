import crypto from 'crypto';

// =====================================================================
// MobileMoneyGateway — Interface + Stub + Factory
// Architecture §2.6 : adaptateurs MVola et Orange Money.
// JAMAIS de vraies clés en production ici : utiliser les variables d'env sandbox.
// =====================================================================

export interface InitiatePaymentParams {
  provider: 'MVOLA' | 'ORANGE_MONEY';
  amount: number;
  currency: 'MGA';
  phone: string;
  reference: string;
}

export interface PaymentInitiationResult {
  instruction: string;
  expiresAt: Date;
  /** Référence interne opérateur pour suivi et réconciliation (stockée dans providerRawPayload). */
  providerRef?: string;
}

export interface QueryStatusResult {
  providerTransactionId: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'EXPIRED';
  rawPayload?: unknown;
}

export interface MobileMoneyGateway {
  initiatePayment(params: InitiatePaymentParams): Promise<PaymentInitiationResult>;
  /**
   * Vérifie la signature HMAC-SHA256 du webhook entrant.
   * rawBody : buffer brut du corps HTTP (avant parsing JSON).
   * signature : valeur de l'en-tête X-Signature (ou X-Orange-Signature).
   */
  verifyWebhookSignature(provider: string, rawBody: Buffer, signature: string): boolean;
  /**
   * Interroge le statut d'une transaction auprès de l'opérateur.
   * Utilisé par le worker payment.reconcile (architecture §2.7) pour les PENDING > 5 min.
   */
  queryStatus(providerRef: string): Promise<QueryStatusResult>;
}

// =====================================================================
// StubGateway — sera remplacé par les vrais adaptateurs MVola/Orange Money
// Utilise systématiquement les variables d'environnement sandbox (non-prod).
// =====================================================================

export class StubGateway implements MobileMoneyGateway {
  async initiatePayment(params: InitiatePaymentParams): Promise<PaymentInitiationResult> {
    return {
      instruction: `Composez *999# pour valider InsTRAM ${params.reference}`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // +5 min stub
      providerRef: `stub-ref-${params.reference}-${Date.now()}`,
    };
  }

  verifyWebhookSignature(provider: string, rawBody: Buffer, signature: string): boolean {
    const secretEnvKey =
      provider === 'mvola'
        ? 'MVOLA_WEBHOOK_SECRET'
        : 'ORANGE_MONEY_WEBHOOK_SECRET';

    const secret = process.env[secretEnvKey];
    if (!secret) {
      // Pas de secret configuré → on ne peut pas valider (rejet)
      return false;
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Comparaison en temps constant (protège contre les timing attacks)
    try {
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }

  async queryStatus(providerRef: string): Promise<QueryStatusResult> {
    return {
      providerTransactionId: providerRef,
      status: 'PENDING',
    };
  }
}

// =====================================================================
// Factory — crée l'adaptateur approprié selon le provider demandé.
// Les imports d'adaptateurs sont dynamiques (require) pour éviter les
// dépendances circulaires et faciliter le mock dans les tests.
// =====================================================================

export function createMobileMoneyGateway(
  provider: 'MVOLA' | 'ORANGE_MONEY' | 'STUB',
  redis?: import('ioredis').Redis,
): MobileMoneyGateway {
  if (provider === 'STUB') return new StubGateway();

  if (provider === 'MVOLA') {
    if (!redis) throw new Error('MvolaAdapter requiert une instance Redis pour le cache de token OAuth2');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MvolaAdapter } = require('./mvola.adapter') as { MvolaAdapter: new (redis: import('ioredis').Redis) => MobileMoneyGateway };
    return new MvolaAdapter(redis);
  }

  if (provider === 'ORANGE_MONEY') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OrangeMoneyAdapter } = require('./orange-money.adapter') as { OrangeMoneyAdapter: new () => MobileMoneyGateway };
    return new OrangeMoneyAdapter();
  }

  return new StubGateway();
}

/**
 * Retourne une Map provider → gateway selon l'environnement.
 * En test/dev : STUB pour tous les providers.
 * En prod : vrais adaptateurs MVola + Orange Money.
 */
export function buildGatewayMap(redis: import('ioredis').Redis): Map<string, MobileMoneyGateway> {
  const useSandbox = process.env.NODE_ENV !== 'production' || process.env.GOALPAY_SANDBOX === 'true';

  if (useSandbox) {
    return new Map<string, MobileMoneyGateway>([
      ['MVOLA', new StubGateway()],
      ['ORANGE_MONEY', new StubGateway()],
    ]);
  }

  return new Map<string, MobileMoneyGateway>([
    ['MVOLA', createMobileMoneyGateway('MVOLA', redis)],
    ['ORANGE_MONEY', createMobileMoneyGateway('ORANGE_MONEY', redis)],
  ]);
}

// Singleton exporté — reste le StubGateway pour compatibilité ascendante
export const mobileMoneyGateway: MobileMoneyGateway = new StubGateway();
