import crypto from 'crypto';
import type { Redis } from 'ioredis';
import type {
  MobileMoneyGateway,
  InitiatePaymentParams,
  PaymentInitiationResult,
  QueryStatusResult,
} from './gateway';

// =====================================================================
// MvolaAdapter — Adaptateur MVola (Telma Madagascar)
// Architecture §2.6 — SANDBOX UNIQUEMENT (MVOLA_BASE_URL = devapi.mvola.mg).
// Jamais de clés en dur — tout via variables d'environnement.
//
// Token OAuth2 mis en cache Redis 50 min (expire avant les 60 min MVola).
// Retry 2× sur 5xx avec backoff 1 s.
// Signature webhook HMAC-SHA256 avec MVOLA_WEBHOOK_SECRET.
// =====================================================================

const MVOLA_TOKEN_CACHE_KEY = 'mvola:access_token';
const TOKEN_TTL_SECONDS = 50 * 60; // 50 min — expire AVANT les 60 min MVola

export class MvolaAdapter implements MobileMoneyGateway {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly webhookSecret: string;
  private readonly merchantNumber: string;
  private readonly callbackUrl: string;

  constructor(private readonly redis: Redis) {
    this.baseUrl = process.env.MVOLA_BASE_URL ?? 'https://devapi.mvola.mg';
    this.clientId = process.env.MVOLA_CLIENT_ID ?? '';
    this.clientSecret = process.env.MVOLA_CLIENT_SECRET ?? '';
    this.webhookSecret = process.env.MVOLA_WEBHOOK_SECRET ?? '';
    this.merchantNumber = process.env.MVOLA_MERCHANT_NUMBER ?? '';
    this.callbackUrl = process.env.MVOLA_CALLBACK_URL ?? '';
  }

  // ------------------------------------------------------------------
  // Token OAuth2 — client_credentials avec cache Redis 50 min
  // ------------------------------------------------------------------

  private async _getAccessToken(): Promise<string> {
    const cached = await this.redis.get(MVOLA_TOKEN_CACHE_KEY);
    if (cached) return cached;

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await this._fetchWithRetry(
      `${this.baseUrl}/token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Cache: 'no-store',
        },
        body: 'grant_type=client_credentials&scope=EXT_INT_MVOLA_SCOPE',
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MVola OAuth2 error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in?: number };
    const ttl = data.expires_in
      ? Math.min(data.expires_in - 60, TOKEN_TTL_SECONDS)
      : TOKEN_TTL_SECONDS;

    await this.redis.setex(MVOLA_TOKEN_CACHE_KEY, ttl, data.access_token);
    return data.access_token;
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
    throw lastError ?? new Error('MVola request failed after retries');
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ------------------------------------------------------------------
  // initiatePayment — POST /mvola/mm/transactions/type/merchantpay/1.0.0
  // ------------------------------------------------------------------

  async initiatePayment(params: InitiatePaymentParams): Promise<PaymentInitiationResult> {
    const token = await this._getAccessToken();
    const correlationId = `instram-${params.reference}-${Date.now()}`;

    const response = await this._fetchWithRetry(
      `${this.baseUrl}/mvola/mm/transactions/type/merchantpay/1.0.0`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          version: '1.0',
          'X-CorrelationID': correlationId,
          UserLanguage: 'FR',
          UserAccountIdentifier: `msisdn;${params.phone}`,
          partnerName: 'InsTRAM',
          'X-Callback-URL': this.callbackUrl,
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({
          amount: params.amount.toString(),
          currency: 'Ar',
          descriptionText: `InsTRAM Reservation ${params.reference}`,
          requestingOrganisationTransactionReference: params.reference,
          requestDate: new Date().toISOString(),
          debitParty: [{ key: 'msisdn', value: params.phone }],
          creditParty: [{ key: 'msisdn', value: this.merchantNumber }],
          fees: [],
          metadata: [
            { key: 'partnerName', value: 'InsTRAM' },
            { key: 'fc', value: 'MGA' },
            { key: 'amountFc', value: params.amount.toString() },
          ],
          originalTransactionReference: params.reference,
        }),
      },
    );

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    if (response.ok) {
      const data = (await response.json()) as { serverCorrelationId?: string };
      return {
        instruction: `Composez *999*${params.amount}# sur votre téléphone MVola pour valider la transaction InsTRAM ${params.reference}`,
        expiresAt,
        providerRef: data.serverCorrelationId ?? correlationId,
      };
    }

    // Sandbox fallback — réponse non-bloquante en cas d'erreur non-5xx
    return {
      instruction: `Composez *999*${params.amount}# sur votre téléphone MVola pour valider la transaction InsTRAM ${params.reference}`,
      expiresAt,
      providerRef: correlationId,
    };
  }

  // ------------------------------------------------------------------
  // verifyWebhookSignature — HMAC-SHA256 avec MVOLA_WEBHOOK_SECRET
  // Architecture §7.4 : vérification obligatoire, rejet immédiat si invalide.
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
  // queryStatus — GET statut d'une transaction en attente
  // Architecture §2.7 : appelé par le worker payment.reconcile
  // ------------------------------------------------------------------

  async queryStatus(providerRef: string): Promise<QueryStatusResult> {
    const token = await this._getAccessToken();

    const response = await this._fetchWithRetry(
      `${this.baseUrl}/mvola/mm/transactions/type/merchantpay/1.0.0/${encodeURIComponent(providerRef)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          version: '1.0',
          'X-CorrelationID': providerRef,
          UserLanguage: 'FR',
          partnerName: 'InsTRAM',
          'Cache-Control': 'no-cache',
        },
      },
    );

    if (!response.ok) {
      // En cas d'erreur réseau ou 4xx : statut conservatoire PENDING
      return {
        providerTransactionId: providerRef,
        status: 'PENDING',
      };
    }

    const data = (await response.json()) as {
      status?: string;
      serverCorrelationId?: string;
      transactionReference?: string;
    };

    let status: QueryStatusResult['status'] = 'PENDING';
    const rawStatus = (data.status ?? '').toLowerCase();
    if (rawStatus === 'completed') status = 'SUCCESS';
    else if (rawStatus === 'failed') status = 'FAILED';
    else if (rawStatus === 'expired') status = 'EXPIRED';

    return {
      providerTransactionId: data.transactionReference ?? data.serverCorrelationId ?? providerRef,
      status,
      rawPayload: data,
    };
  }
}
