/**
 * Interface EmailProvider + adaptateurs Stub (dev) et SMTP (prod).
 * Architecture symétrique au SmsProvider.
 *
 * Variables d'environnement :
 *   EMAIL_PROVIDER=stub|smtp  (défaut : stub)
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
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
// Factory
// =====================================================================

export function createEmailProvider(): EmailProvider {
  const provider = (process.env.EMAIL_PROVIDER ?? 'stub').toLowerCase();
  switch (provider) {
    case 'smtp':
      return new SmtpEmailProvider();
    case 'stub':
      return new StubEmailProvider();
    default:
      process.stderr.write(`[EmailProvider] Valeur EMAIL_PROVIDER inconnue : "${provider}". Utilisation du stub.\n`);
      return new StubEmailProvider();
  }
}
