// Generic automation email — the send_email flow node's only template. The
// subject/body arrive fully interpolated from user-authored node config, so
// the body is HTML-escaped here (never trusted as markup).

import type { EmailTemplate } from '../index.js';
import { layout } from './_layout.js';

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function automationTemplate({
  subject,
  body,
  flowName,
}: {
  subject: string;
  body: string;
  flowName?: string;
}): EmailTemplate {
  const footer = flowName ? `Sent by the "${flowName}" automation.` : 'Sent by an automation.';
  const text = `${body}\n\n—\n${footer}`;
  const html = layout(
    `<p style="margin:0 0 16px;white-space:pre-wrap;">${escapeHtml(body)}</p>
     <p style="margin:0;font-size:12px;color:#8792a2;">${escapeHtml(footer)}</p>`,
  );
  return { subject, text, html };
}
