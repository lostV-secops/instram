/**
 * Interface EmailProvider + adaptateurs Stub (dev), SMTP, API Brevo et Resend (prod).
 * Architecture symétrique au SmsProvider.
 *
 * Variables d'environnement :
 *   EMAIL_PROVIDER=stub|smtp|brevo|resend  (défaut : stub)
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM  (provider smtp)
 *   BREVO_API_KEY, SMTP_FROM                               (provider brevo)
 *   RESEND_API_KEY, SMTP_FROM                              (provider resend)
 *
 * Les providers brevo et resend utilisent l'API REST — aucune restriction IP.
 */

import nodemailer, { Transporter } from 'nodemailer';

export interface EmailSendParams {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  send(params: EmailSendParams): Promise<void>;
}

// =====================================================================
// Stub — développement et tests (aucun envoi réel)
// =====================================================================

export class StubEmailProvider implements EmailProvider {
  async send(params: EmailSendParams): Promise<void> {
    process.stdout.write(
      `[EMAIL:stub] to=${params.to}\n  subject=${params.subject}\n  text=${params.text}\n`,
    );
  }
}

// =====================================================================
// SMTP via nodemailer
// =====================================================================

export class SmtpEmailProvider implements EmailProvider {
  private transporter: Transporter;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM ?? 'InsTRAM <noreply@instram.mg>';

    if (!host) throw new Error('[SmtpEmailProvider] SMTP_HOST manquant');

    this.from = from;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  async send(params: EmailSendParams): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
  }
}

// =====================================================================
// API REST Brevo (recommandé en production — pas de restriction IP)
// =====================================================================

export class BrevoApiEmailProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly from: { name: string; email: string };

  constructor() {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) throw new Error('[BrevoApiEmailProvider] BREVO_API_KEY manquant');

    this.apiKey = apiKey;

    const fromEnv = process.env.SMTP_FROM ?? 'InsTRAM <noreply@instram.mg>';
    // Décompose "Nom <email>" ou "email"
    const match = fromEnv.match(/^(.+?)\s*<(.+?)>$/);
    this.from = match
      ? { name: match[1].trim(), email: match[2].trim() }
      : { name: 'InsTRAM', email: fromEnv.trim() };
  }

  async send(params: EmailSendParams): Promise<void> {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({
        sender: this.from,
        to: [{ email: params.to }],
        subject: params.subject,
        textContent: params.text,
        htmlContent: params.html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[BrevoApiEmailProvider] Erreur ${res.status}: ${body}`);
    }
  }
}

// =====================================================================
// API REST Resend
// =====================================================================

export class ResendEmailProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly from: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('[ResendEmailProvider] RESEND_API_KEY manquant');

    this.apiKey = apiKey;
    this.from = process.env.SMTP_FROM ?? 'InsTRAM <onboarding@resend.dev>';
  }

  async send(params: EmailSendParams): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: this.from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        html: params.html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[ResendEmailProvider] Erreur ${res.status}: ${body}`);
    }
  }
}

// =====================================================================
// Factory
// =====================================================================

export function createEmailProvider(): EmailProvider {
  const provider = (process.env.EMAIL_PROVIDER ?? 'stub').toLowerCase();
  switch (provider) {
    case 'brevo':
      return new BrevoApiEmailProvider();
    case 'resend':
      return new ResendEmailProvider();
    case 'smtp':
      return new SmtpEmailProvider();
    case 'stub':
      return new StubEmailProvider();
    default:
      process.stderr.write(`[EmailProvider] Valeur EMAIL_PROVIDER inconnue : "${provider}". Utilisation du stub.\n`);
      return new StubEmailProvider();
  }
}
