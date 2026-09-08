import { config } from './config.ts';
import { appPath } from '../lib/paths.ts';

const publicOrigin = new URL(config.appUrl).origin;

export function appUrl(path = '/'): string {
  return new URL(appPath(path), publicOrigin).toString();
}