// Email sending — single entrypoint. Every template lives in ./templates and
// is invoked via send(to, template, payload). Resend in prod; console-print
// fallback in dev when RESEND_API_KEY is missing so engineers can grab magic
// links without setting up SMTP.

import { logger } from '@northbeam/core';
import { Resend } from 'resend';
import { env } from '../lib/env.js';
import { automationTemplate } from './templates/automation.js';
import { invitationTemplate } from './templates/invitation.js';
import { magicLinkTemplate } from './templates/magic-link.js';

let cached: Resend | null | undefined;
function client(): Resend | null {
  if (cached !== undefined) return cached;
  const key = env().RESEND_API_KEY;
  cached = key ? new Resend(key) : null;
  return cached;
}

export type EmailTemplate = {
  subject: string;
  text: string;
  html: string;
};

type TemplateMap = {
  'magic-link': { email: string; url: string };
  invitation: { email: string; inviterName: string; orgName: string; acceptUrl: string };
  automation: { subject: string; body: string; flowName?: string };
};

const TEMPLATES: { [K in keyof TemplateMap]: (p: TemplateMap[K]) => EmailTemplate } = {
  'magic-link': magicLinkTemplate,
  invitation: invitationTemplate,
  automation: automationTemplate,
};

export async function send<K extends keyof TemplateMap>(
  to: string,
  template: K,
  payload: TemplateMap[K],
): Promise<void> {
  const built = TEMPLATES[template](payload);
  const c = client();

  if (!c) {
    // Dev fallback — print to console so the callable URL is grabbable.
    logger.warn({ to, template }, '[dev] email send (no RESEND_API_KEY configured)');
    console.log(`\n  ✉️  ${to} · ${built.subject}\n${built.text.replace(/^/gm, '     ')}\n`);
    return;
  }

  const { error } = await c.emails.send({
    from: env().RESEND_FROM,
    to,
    subject: built.subject,
    text: built.text,
    html: built.html,
  });

  if (error) {
    logger.error({ err: error, to, template }, 'failed to send email');
    throw new Error(`failed to send email (${template})`);
  }
}
