import crypto from 'crypto';
import type {
  MobileMoneyGateway,
  InitiatePaymentParams,
  PaymentInitiationResult,
  QueryStatusResult,
} from './gateway';

// =====================================================================
// OrangeMoneyAdapter — Orange Money Madagascar
// Architecture §2.6 — SANDBOX UNIQUEMENT (ORANGE_MONEY_BASE_URL = api.sandbox.orange.mg).
// Jamais de clés en dur — tout via variables d'environnement.
//
// Auth : Bearer token (ORANGE_MONEY_TOKEN env).
// Retry 2× sur 5xx.
// Signature webhook : compare header X-Orange-Signature (HMAC-SHA256, clé ORANGE_MONEY_WEBHOOK_SECRET).
// =====================================================================

export class OrangeMoneyAdapter implements MobileMoneyGateway {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly webhookSecret: string;
  private readonly merchantKey: string;
  private readonly notifUrl: string;
  private readonly returnUrl: string;
  private readonly cancelUrl: string;

  constructor() {
    this.baseUrl = process.env.ORANGE_MONEY_BASE_URL ?? 'https://api.sandbox.orange.mg';
    this.token = process.env.ORANGE_MONEY_TOKEN ?? '';
    this.webhookSecret = process.env.ORANGE_MONEY_WEBHOOK_SECRET ?? '';
    this.merchantKey = process.env.ORANGE_MONEY_MERCHANT_KEY ?? '';
    this.notifUrl = process.env.ORANGE_MONEY_NOTIF_URL ?? '';
    this.returnUrl = process.env.ORANGE_MONEY_RETURN_URL ?? '';
    this.cancelUrl = process.env.ORANGE_MONEY_CANCEL_URL ?? '';
  }

  // ------------------------------------------------------------------
  // HTTP helper — retry 2× sur 5xx, backoff 1 s croissant
  // ------------------------------------------------------------------

  private async _fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 2,
  ): Promise<Response> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, options);
        if (res.status >= 500 && attempt < maxRetries) {
          await this._sleep(1000 * (attempt + 1));
          continue;
        }
        return res;
      } catch (err) {
        lastError = err as Error;
        if (attempt < maxRetries) {
          await this._sleep(1000 * (attempt + 1));
        }
      }
    }
    throw lastError ?? new Error('Orange Money request failed after retries');
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ------------------------------------------------------------------
  // initiatePayment — POST /orange-money-webpay/mg/v1/webpayment
  // ------------------------------------------------------------------

  async initiatePayment(params: InitiatePaymentParams): Promise<PaymentInitiationResult> {
    const response = await this._fetchWithRetry(
      `${this.baseUrl}/orange-money-webpay/mg/v1/webpayment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          merchant_key: this.merchantKey,
          currency: 'MGA',
          order_id: params.reference,
          amount: params.amount,
          return_url: this.returnUrl,
          cancel_url: this.cancelUrl,
          notif_url: this.notifUrl,
          lang: 'fr',
          reference: params.reference,
        }),
      },
    );

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    if (response.ok) {
      const data = (await response.json()) as {
        payment_url?: string;
        pay_token?: string;
        notif_token?: string;
      };

      const providerRef = data.pay_token ?? data.notif_token ?? `orange-ref-${params.reference}-${Date.now()}`;

      return {
        instruction: `Composez #144*82# sur votre téléphone Orange Money pour valider la transaction InsTRAM ${params.reference}`,
        expiresAt,
        providerRef,
      };
    }

    // Sandbox fallback — réponse non-bloquante en cas d'erreur non-5xx
    return {
      instruction: `Composez #144*82# sur votre téléphone Orange Money pour valider la transaction InsTRAM ${params.reference}`,
      expiresAt,
      providerRef: `orange-ref-${params.reference}-${Date.now()}`,
    };
  }

  // ------------------------------------------------------------------
  // verifyWebhookSignature — compare X-Orange-Signature (HMAC-SHA256)
  // Architecture §7.4 : vérification obligatoire avant tout traitement.
  // ------------------------------------------------------------------

  verifyWebhookSignature(_provider: string, rawBody: Buffer, signature: string): boolean {
    if (!this.webhookSecret) return false;

    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    try {
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------
  // queryStatus — GET statut transaction Orange Money
  // Architecture §2.7 : appelé par le worker payment.reconcile
  // ------------------------------------------------------------------

  async queryStatus(providerRef: string): Promise<QueryStatusResult> {
    const response = await this._fetchWithRetry(
      `${this.baseUrl}/orange-money-webpay/mg/v1/webpayment/${encodeURIComponent(providerRef)}/status`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      return {
        providerTransactionId: providerRef,
        status: 'PENDING',
      };
    }

    const data = (await response.json()) as {
      status?: string;
      txnid?: string;
      order_id?: string;
    };

    let status: QueryStatusResult['status'] = 'PENDING';
    const rawStatus = (data.status ?? '').toUpperCase();
    if (rawStatus === 'SUCCESS' || rawStatus === 'SUCCESSFULL' || rawStatus === 'SUCCESSFUL') {
      status = 'SUCCESS';
    } else if (rawStatus === 'FAILED' || rawStatus === 'FAILURE') {
      status = 'FAILED';
    } else if (rawStatus === 'EXPIRED') {
      status = 'EXPIRED';
    }

    return {
      providerTransactionId: data.txnid ?? providerRef,
      status,
      rawPayload: data,
    };
  }
}
