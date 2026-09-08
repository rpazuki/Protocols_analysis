import 'server-only';
import { DEFAULT_AUTHZ_POLICY, type AuthzPolicy } from '@protocols/domain';
import type { AuthAdapterId } from '@protocols/auth-core';

/**
 * Single place where environment configuration is read and validated.
 *
 * Read once at module load so a misconfigured container fails fast at
 * start-up rather than at the first user request.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required. See .env.example.`);
  }
  return value.trim();
}

function optional(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function list(name: string): string[] {
  return optional(name)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export const isProduction = process.env.NODE_ENV === 'production';

/**
 * `next build` runs with NODE_ENV=production but without the deployment's
 * runtime secrets, so the production assertions below are deferred when the
 * build phase is in progress. They still run on every real server start.
 */
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

const adapterId = (optional('AUTH_ADAPTER', 'mock') as AuthAdapterId) || 'mock';

export interface AppConfig {
  appUrl: string;
  appName: string;
  environmentLabel: string;
  timeZone: string;
  sessionSecret: string;
  sessionTtlHours: number;
  adapterId: AuthAdapterId;
  allowedEmailDomains: string[];
  /**
   * Extra origins accepted for same-origin checks, from ALLOWED_ORIGINS. The
   * same list next.config.ts hands to Next for server actions, so the export
   * route and server actions agree about what counts as our own page.
   */
  allowedOrigins: string[];
  bootstrapAdminEmails: string[];
  /**
   * Addresses blocked from the app regardless of successful SSO. Reconciled
   * into researcher_denylist on start, so an urgent block can be applied on the
   * VM without a working admin session.
   */
  deniedEmails: string[];
  authz: AuthzPolicy;
  exportMaxRows: number;
  entra: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    postLogoutRedirectUri: string;
    scopes: string[];
    emailClaim: string;
  };
  shibboleth: {
    emailHeader: string;
    sessionHeader: string;
    displayNameHeader: string;
    subjectHeader: string;
    idpEntityId: string;
    loginPath: string;
    logoutPath: string;
    proxySecret: string;
    proxyHeaderName: string;
  };
}

const appUrl = optional('APP_URL', 'http://localhost:3000/protocols').replace(/\/$/, '');

export const config: AppConfig = {
  appUrl,
  appName: optional('APP_NAME', 'Lab Protocols Analysis'),
  // Shown as a banner in every non-production environment so nobody mistakes
  // a staging instance for the real lab record.
  environmentLabel: optional('ENVIRONMENT_LABEL', isProduction ? '' : 'DEVELOPMENT'),
  timeZone: optional('APP_TIMEZONE', 'Europe/London'),
  sessionSecret:
    isProduction && !isBuildPhase
      ? required('SESSION_SECRET')
      : optional('SESSION_SECRET', 'development-only-insecure-session-secret-change-me'),
  sessionTtlHours: Number(optional('SESSION_TTL_HOURS', '12')),
  adapterId,
  allowedEmailDomains: list('ALLOWED_EMAIL_DOMAINS'),
  allowedOrigins: list('ALLOWED_ORIGINS'),
  bootstrapAdminEmails: list('ADMIN_BOOTSTRAP_EMAILS'),
  deniedEmails: list('ACCESS_DENYLIST_EMAILS'),
  authz: {
    // Open decision 3 in the plan. Defaults keep the researcher in control of
    // their own records; set these to false to make restore/purge admin-only.
    allowResearcherRestore: bool('ALLOW_RESEARCHER_RESTORE', DEFAULT_AUTHZ_POLICY.allowResearcherRestore),
    allowResearcherPermanentDelete: bool(
      'ALLOW_RESEARCHER_PERMANENT_DELETE',
      DEFAULT_AUTHZ_POLICY.allowResearcherPermanentDelete,
    ),
    permanentDeleteWaitDays: Number(optional('PERMANENT_DELETE_WAIT_DAYS', '0')),
  },
  exportMaxRows: Number(optional('EXPORT_MAX_ROWS', '100000')),
  entra: {
    issuer: optional('ENTRA_ISSUER'),
    clientId: optional('ENTRA_CLIENT_ID'),
    clientSecret: optional('ENTRA_CLIENT_SECRET'),
    redirectUri: optional('ENTRA_REDIRECT_URI', `${appUrl}/auth/callback`),
    postLogoutRedirectUri: optional('ENTRA_POST_LOGOUT_REDIRECT_URI', appUrl),
    scopes: list('ENTRA_SCOPES').length ? list('ENTRA_SCOPES') : ['openid', 'profile', 'email'],
    emailClaim: optional('ENTRA_EMAIL_CLAIM', 'email'),
  },
  shibboleth: {
    emailHeader: optional('SHIBBOLETH_EMAIL_HEADER', 'mail'),
    sessionHeader: optional('SHIBBOLETH_SESSION_HEADER', 'shib-session-id'),
    displayNameHeader: optional('SHIBBOLETH_DISPLAYNAME_HEADER', 'displayname'),
    subjectHeader: optional('SHIBBOLETH_SUBJECT_HEADER', 'persistent-id'),
    idpEntityId: optional('SHIBBOLETH_IDP_ENTITY_ID', 'https://shibboleth.imperial.ac.uk/shibboleth'),
    loginPath: optional('SHIBBOLETH_LOGIN_PATH', '/Shibboleth.sso/Login'),
    logoutPath: optional('SHIBBOLETH_LOGOUT_PATH', '/Shibboleth.sso/Logout'),
    proxySecret: optional('SHIBBOLETH_PROXY_SECRET'),
    proxyHeaderName: optional('SHIBBOLETH_PROXY_HEADER_NAME', 'x-sp-proxy-secret'),
  },
};

/**
 * Production preconditions. Called at module load so a misconfigured container
 * dies on start-up rather than at the first user request, and exported so the
 * health check and tests can assert the same rules.
 */
export function assertProductionConfig(): void {
  if (!isProduction) return;

  // docs/ict-sso/identity-integration.md: "Production builds should fail or
  // refuse to start if mock auth is selected."
  if (config.adapterId === 'mock') {
    throw new Error(
      'AUTH_ADAPTER=mock is not allowed with NODE_ENV=production. Configure entra-oidc or shibboleth-saml.',
    );
  }
  if (config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production.');
  }
  if (!config.appUrl.startsWith('https://')) {
    throw new Error('APP_URL must be an https:// URL in production. Session cookies are Secure-only.');
  }
  if (config.bootstrapAdminEmails.length === 0) {
    throw new Error(
      'ADMIN_BOOTSTRAP_EMAILS must list at least one admin before first production start, or nobody can administer the app.',
    );
  }
  if (config.adapterId === 'entra-oidc' && !config.entra.clientSecret) {
    throw new Error('ENTRA_CLIENT_SECRET is required when AUTH_ADAPTER=entra-oidc.');
  }
  if (config.adapterId === 'shibboleth-saml' && !config.shibboleth.proxySecret) {
    throw new Error('SHIBBOLETH_PROXY_SECRET is required when AUTH_ADAPTER=shibboleth-saml.');
  }
}

if (!isBuildPhase) assertProductionConfig();

export const APP_VERSION = optional('APP_VERSION', '0.1.0');
