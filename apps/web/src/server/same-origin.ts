/**
 * Same-origin check for non-action POST handlers.
 *
 * Next applies this check to server actions itself, but a route handler has to
 * do it explicitly. The export route needs one because producing an export
 * releases raw email addresses and the full text of every matching report, so
 * it must be a deliberate submit from our own page rather than something a
 * link, an image tag, a prefetch, or a form on another site can trigger.
 *
 * Kept free of `server-only` and of Next imports so it can be unit tested
 * directly.
 */

export interface SameOriginOptions {
  /** The app's public URL. The authoritative origin this app answers on. */
  appUrl: string;
  /**
   * Additional accepted origins, from ALLOWED_ORIGINS. Same list Next uses for
   * server actions, so both checks agree about what "our own page" means.
   * Entries may omit the scheme, in which case appUrl's scheme is assumed.
   */
  allowedOrigins?: string[];
}

/**
 * Normalizes a value to a bare origin (`scheme://host[:port]`), or null.
 *
 * Comparison is on the full origin rather than the host alone: `http://host`
 * and `https://host` are different origins, and treating them as equal would
 * let a plaintext attacker-controlled origin match a secure production host by
 * name.
 */
function toOrigin(value: string, fallbackScheme: string): string | null {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `${fallbackScheme}//${value}`;
  try {
    const url = new URL(candidate);
    return url.host === '' ? null : url.origin;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(headers: Headers, options: SameOriginOptions): boolean {
  const origin = headers.get('origin');

  // Browsers set Origin on every POST, and page script cannot forge it. A
  // missing header therefore means a non-browser client, which must not be
  // able to skip the check by simply omitting it.
  if (!origin) return false;

  // "null" is what a sandboxed iframe or some redirect chains send. It is not
  // our origin.
  if (origin === 'null') return false;

  let appOrigin: URL;
  try {
    appOrigin = new URL(options.appUrl);
  } catch {
    // A malformed APP_URL must fail closed rather than accept everything.
    return false;
  }

  const requestOrigin = toOrigin(origin, appOrigin.protocol);
  if (requestOrigin === null) return false;

  const accepted = new Set<string>([appOrigin.origin]);
  for (const entry of options.allowedOrigins ?? []) {
    const normalized = toOrigin(entry.trim(), appOrigin.protocol);
    if (normalized) accepted.add(normalized);
  }

  // Deliberately does NOT consult Host, X-Forwarded-Host, or X-Forwarded-Proto.
  // Those are attacker-controllable unless the reverse proxy is known to
  // overwrite them, and we cannot verify that from here. A proxied deployment
  // still works without them: the browser sends the public origin, which is
  // what APP_URL names, even when the proxy rewrites Host to localhost:3000.
  return accepted.has(requestOrigin);
}
