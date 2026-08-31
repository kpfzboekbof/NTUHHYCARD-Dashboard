/**
 * The one place that decides whether a caller-supplied redirect target is
 * safely inside this app.
 *
 * `//evil.com` is the case everybody remembers. `/\evil.com` is the one that
 * gets through a `startsWith('//')` check and still resolves to another
 * origin — `new URL('/\\evil.com', 'https://app/x')` is `https://evil.com/`.
 * That matters most on the login callback, where the redirect happens with a
 * freshly minted session cookie attached.
 */
export function safeInternalPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || !raw.startsWith('/')) return fallback;
  // A backslash anywhere is never legitimate in a path this app generated, and
  // `/\host` is read as a protocol-relative URL.
  if (raw.includes('\\')) return fallback;
  if (raw.startsWith('//')) return fallback;
  // Browsers strip tabs and newlines before parsing, so `/<tab>/evil.com`
  // would otherwise sneak past the two checks above.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}
