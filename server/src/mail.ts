import nodemailer from 'nodemailer';
import type { AuthPurpose } from './db.js';

export interface Mailer {
  sendCode(to: string, purpose: AuthPurpose, code: string): Promise<void>;
}

const DEFAULT_FROM = 'ServiceReady <onboarding@resend.dev>';

function purposeDescription(purpose: AuthPurpose): string {
  if (purpose === 'verify') return 'confirm your email address';
  if (purpose === 'login') return 'log in to your account';
  return 'reset your password';
}

function safeErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  return /^[A-Za-z0-9_]+$/.test(name) ? name : 'Error';
}

function logProviderFailure(status: unknown, error: unknown): void {
  const code = typeof status === 'number' && Number.isFinite(status) ? String(status) : 'unknown';
  console.error(`[email] provider failure status=${code} error=${safeErrorName(error)}`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character] ?? character);
}

function content(purpose: AuthPurpose, code: string): { subject: string; text: string; html: string } {
  const action = purposeDescription(purpose);
  const subject = `Your ServiceReady code: ${code}`;
  const text = [
    `Use this code to ${action}: ${code}`,
    'This code expires in 10 minutes.',
    "If you didn't ask for this, ignore this email."
  ].join('\n\n');
  const html = `<div style="background:#f7f7f5;padding:32px;font-family:Arial,sans-serif;color:#171717"><div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e5e3;border-radius:12px;padding:28px"><p style="margin:0 0 18px;font-size:14px;color:#666">ServiceReady</p><p style="margin:0 0 14px;font-size:16px">Use this code to ${escapeHtml(action)}:</p><p style="margin:0 0 20px;font-size:30px;font-weight:700;letter-spacing:8px">${escapeHtml(code)}</p><p style="margin:0 0 12px;font-size:14px">This code expires in 10 minutes.</p><p style="margin:0;font-size:14px;color:#666">If you didn't ask for this, ignore this email.</p></div></div>`;
  return { subject, text, html };
}

export function createMailer(): Mailer {
  const from = process.env.MAIL_FROM ?? DEFAULT_FROM;
  if (process.env.SMTP_USER) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS ?? ''
      }
    });
    return {
      async sendCode(to, purpose, code) {
        try {
          await transport.sendMail({ from, to, ...content(purpose, code) });
        } catch (error) {
          const responseCode = (error as { responseCode?: unknown }).responseCode;
          logProviderFailure(responseCode, error);
          throw error;
        }
      }
    };
  }

  if (process.env.RESEND_API_KEY) {
    return {
      async sendCode(to, purpose, code) {
        let response: Response;
        try {
          response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ from, to: [to], ...content(purpose, code) })
          });
        } catch (error) {
          logProviderFailure(undefined, error);
          throw error;
        }
        if (!response.ok) {
          const error = new Error('Email provider rejected the message.');
          logProviderFailure(response.status, Object.assign(error, { name: 'ResendError' }));
          throw error;
        }
      }
    };
  }

  if (process.env.NODE_ENV !== 'production') {
    return {
      async sendCode(to, purpose, code) {
        console.log(`[dev mail] to=${to} purpose=${purpose} code=${code}`);
      }
    };
  }

  return {
    async sendCode() {
      throw Object.assign(new Error("Email sending isn't set up yet."), { status: 503 });
    }
  };
}
