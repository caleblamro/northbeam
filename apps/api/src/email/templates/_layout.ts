import { BRAND } from '@northbeam/config';

// Minimal shared HTML wrapper. Inline styles only — email clients ignore <style>.
export function layout(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f7fb;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#0a2540;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border:1px solid #e3e8ee;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:24px 28px 8px;font-weight:600;font-size:16px;letter-spacing:-0.01em;">${BRAND.name}</td></tr>
          <tr><td style="padding:8px 28px 28px;font-size:14px;line-height:1.55;color:#3c4257;">${bodyHtml}</td></tr>
        </table>
        <div style="margin-top:16px;font-size:12px;color:#8792a2;">${BRAND.name} · ${BRAND.tagline}</div>
      </td></tr>
    </table>
  </body>
</html>`;
}
