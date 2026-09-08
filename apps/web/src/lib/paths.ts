const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH || process.env.APP_BASE_PATH || '/protocols';

export const appBasePath = configuredBasePath === '/' ? '' : `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`;

export function appPath(path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (suffix === '/') return appBasePath || '/';
  return `${appBasePath}${suffix}`;
}