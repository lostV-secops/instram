/**
 * Interface SmsProvider + adaptateurs Orange, Telma, et Stub (dev/test).
 * Architecture §2.6 (VH-06) — adaptateurs swappables via SMS_PROVIDER env.
 *
 * Règle absolue : aucune clé SMS en dur dans ce fichier.
 * Toutes les credentials sont lues depuis les variables d'environnement.
 */

// =====================================================================
// Types
// =====================================================================

export type Lang = 'FR' | 'MG';

export interface SmsSendParams {
  to: string;
  text: string;
  lang: Lang;
}

export interface SmsSendResult {
  messageId: string;
}

// =====================================================================
// Interface
// =====================================================================

export interface SmsProvider {
  send(params: SmsSendParams): Promise<SmsSendResult>;
}

// =====================================================================
// Stub — développement et tests (aucun envoi réel)
// =====================================================================

export class StubSmsProvider implements SmsProvider {
  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const messageId = `stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    process.stdout.write(
      `[SMS:stub] to=${params.to} lang=${params.lang} messageId=${messageId}\n  text=${params.text}\n`,
    );
    return { messageId };
  }
}

// =====================================================================
// Orange Madagascar — à câbler, non encore actif en V1
// Lit ORANGE_SMS_URL et ORANGE_SMS_KEY depuis l'env (jamais en dur).
// =====================================================================

export class OrangeSmsProvider implements SmsProvider {
  private readonly url: string;
  private readonly apiKey: string;

  constructor() {
    const url = process.env.ORANGE_SMS_URL;
    const key = process.env.ORANGE_SMS_KEY;

    if (!url || !key) {
      throw new Error(
        '[OrangeSmsProvider] Variables manquantes : ORANGE_SMS_URL et ORANGE_SMS_KEY sont obligatoires.',
      );
    }
    if (key === 'PLACEHOLDER_ORANGE_SMS') {
      throw new Error(
        '[OrangeSmsProvider] ORANGE_SMS_KEY est un placeholder — remplacez-le par une vraie clé sandbox avant utilisation.',
      );
    }

    this.url = url;
    this.apiKey = key;
  }

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    // Note : implémentation HTTP à compléter avec le SDK Orange Madagascar
    // (endpoint standard SMSmessaging v1 — https://developer.orange.com/apis/sms-mg)
    const response = await fetch(`${this.url}/outbound/requests`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        outboundSMSMessageRequest: {
          address: [`tel:${params.to}`],
          outboundSMSTextMessage: { message: params.text },
          senderAddress: 'InsTRAM',
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `[OrangeSmsProvider] Échec envoi HTTP ${response.status}: ${body}`,
      );
    }

    const data = (await response.json()) as {
      outboundSMSMessageRequest?: { resourceURL?: string };
    };
    const resourceUrl =
      data.outboundSMSMessageRequest?.resourceURL ?? `orange-${Date.now()}`;
    // L'ID de message est extrait depuis l'URL de ressource Orange
    const messageId = resourceUrl.split('/').pop() ?? resourceUrl;

    return { messageId };
  }
}

// =====================================================================
// Telma Madagascar — à câbler, non encore actif en V1
// Lit TELMA_SMS_URL et TELMA_SMS_KEY depuis l'env (jamais en dur).
// =====================================================================

export class TelmaSmsProvider implements SmsProvider {
  private readonly url: string;
  private readonly apiKey: string;

  constructor() {
    const url = process.env.TELMA_SMS_URL;
    const key = process.env.TELMA_SMS_KEY;

    if (!url || !key) {
      throw new Error(
        '[TelmaSmsProvider] Variables manquantes : TELMA_SMS_URL et TELMA_SMS_KEY sont obligatoires.',
      );
    }
    if (key === 'PLACEHOLDER_TELMA_SMS') {
      throw new Error(
        '[TelmaSmsProvider] TELMA_SMS_KEY est un placeholder — remplacez-le par une vraie clé sandbox avant utilisation.',
      );
    }

    this.url = url;
    this.apiKey = key;
  }

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    // Note : implémentation HTTP à compléter avec l'API Telma SMS
    const response = await fetch(`${this.url}/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: params.to,
        from: 'InsTRAM',
        text: params.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `[TelmaSmsProvider] Échec envoi HTTP ${response.status}: ${body}`,
      );
    }

    const data = (await response.json()) as { messageId?: string; id?: string };
    const messageId =
      data.messageId ?? data.id ?? `telma-${Date.now()}`;

    return { messageId };
  }
}

// =====================================================================
// Factory — sélection selon SMS_PROVIDER env
// Valeurs acceptées : 'stub' (défaut) | 'orange' | 'telma'
// =====================================================================

export function createSmsProvider(): SmsProvider {
  const provider = (process.env.SMS_PROVIDER ?? 'stub').toLowerCase();

  switch (provider) {
    case 'orange':
      return new OrangeSmsProvider();
    case 'telma':
      return new TelmaSmsProvider();
    case 'stub':
      return new StubSmsProvider();
    default:
      process.stderr.write(
        `[SmsProvider] Valeur SMS_PROVIDER inconnue : "${provider}". Utilisation du stub.\n`,
      );
      return new StubSmsProvider();
  }
}
