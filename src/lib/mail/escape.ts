/**
 * HTML escaping for mail bodies, with no transport dependencies.
 *
 * It lives here rather than beside the Gmail transporter because that module
 * imports `next/headers`, which cannot load outside a request — and a mail
 * body builder that cannot be unit-tested is one whose escaping nobody checks.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
