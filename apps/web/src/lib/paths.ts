const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH || process.env.APP_BASE_PATH || '/protocols';

export const appBasePath = configuredBasePath === '/' ? '' : `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`;

export function appPath(path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  // Callers may already carry the public prefix (for example a returnTo URL).
  // Add it at most once, without confusing /protocols-other with /protocols.
  if (appBasePath && (suffix === appBasePath || suffix.startsWith(`${appBasePath}/`)
      || suffix.startsWith(`${appBasePath}?`) || suffix.startsWith(`${appBasePath}#`))) return suffix;
  if (suffix === '/') return appBasePath || '/';
  return `${appBasePath}${suffix}`;
}
