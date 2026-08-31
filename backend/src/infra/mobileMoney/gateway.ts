import crypto from 'crypto';

// =====================================================================
// MobileMoneyGateway — Interface + Stub
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
}

export interface MobileMoneyGateway {
  initiatePayment(params: InitiatePaymentParams): Promise<PaymentInitiationResult>;
  /**
   * Vérifie la signature HMAC-SHA256 du webhook entrant.
   * rawBody : buffer brut du corps HTTP (avant parsing JSON).
   * signature : valeur de l'en-tête X-Signature.
   */
  verifyWebhookSignature(provider: string, rawBody: Buffer, signature: string): boolean;
}

// =====================================================================
// StubGateway — sera remplacé par les vrais adaptateurs MVola/Orange Money
// Utilise systématiquement les variables d'environnement sandbox (non-prod).
// =====================================================================

export class StubGateway implements MobileMoneyGateway {
  async initiatePayment(_params: InitiatePaymentParams): Promise<PaymentInitiationResult> {
    return {
      instruction: 'Composez *999#',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // +5 min stub
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
}

// Singleton exporté — sera substitué par un vrai adaptateur à terme
export const mobileMoneyGateway: MobileMoneyGateway = new StubGateway();
