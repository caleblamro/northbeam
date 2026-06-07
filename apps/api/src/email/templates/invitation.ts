import { BRAND } from '@northbeam/config';
import type { EmailTemplate } from '../index.js';
import { layout } from './_layout.js';

export function invitationTemplate({
  inviterName,
  orgName,
  acceptUrl,
}: {
  email: string;
  inviterName: string;
  orgName: string;
  acceptUrl: string;
}): EmailTemplate {
  const subject = `${inviterName} invited you to ${orgName} on ${BRAND.name}`;
  const text = `${inviterName} invited you to join ${orgName} on ${BRAND.name}.\n\nAccept the invitation:\n${acceptUrl}`;
  const html = layout(
    `<p style="margin:0 0 16px;"><strong>${inviterName}</strong> invited you to join <strong>${orgName}</strong> on ${BRAND.name}.</p>
     <p style="margin:0 0 20px;"><a href="${acceptUrl}" style="display:inline-block;background:#635bff;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px;padding:10px 18px;border-radius:6px;">Accept invitation</a></p>`,
  );
  return { subject, text, html };
}
