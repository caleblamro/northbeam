import { BRAND } from '@northbeam/config';
import type { EmailTemplate } from '../index.js';
import { layout } from './_layout.js';

export function magicLinkTemplate({ url }: { email: string; url: string }): EmailTemplate {
  const subject = `Sign in to ${BRAND.name}`;
  const text = `Sign in to ${BRAND.name}\n\nClick the link below to finish signing in. It expires in 10 minutes.\n\n${url}\n\nIf you didn't request this, you can ignore this email.`;
  const html = layout(
    `<p style="margin:0 0 16px;">Click the button below to finish signing in. The link expires in 10 minutes.</p>
     <p style="margin:0 0 20px;"><a href="${url}" style="display:inline-block;background:#635bff;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px;padding:10px 18px;border-radius:6px;">Sign in to ${BRAND.name}</a></p>
     <p style="margin:0;font-size:12px;color:#8792a2;">If you didn't request this, you can ignore this email.</p>`,
  );
  return { subject, text, html };
}
