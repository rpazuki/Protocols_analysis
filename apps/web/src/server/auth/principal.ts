import 'server-only';
import { redirect } from 'next/navigation';
import { adminsRepo, agreementsRepo, denylistRepo } from '@protocols/db';
import { DomainError, ForbiddenError, type Principal } from '@protocols/domain';
import { config } from '../config.ts';
import { auditBestEffort } from '../audit.ts';
import { readSession } from './session.ts';
import { appPath } from '../../lib/paths.ts';

/**
 * Resolves the current request's principal.
 *
 * Role is read from the database allowlist on every call rather than from the
 * session cookie, so an admin removed through the admin page loses access on
 * their next request.
 */

let bootstrapPromise: Promise<void> | null = null;

/**
 * Reconciles ADMIN_BOOTSTRAP_EMAILS into the allowlist. Runs once per process,
 * lazily on the first authenticated request, because there is no reliable
 * start-up hook in the Next.js server runtime.
 */
async function ensureBootstrapAdmins(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = Promise.all([
      adminsRepo.syncConfigAdmins(config.bootstrapAdminEmails),
      denylistRepo.syncConfigDenylist(config.deniedEmails),
    ]).then(
      () => undefined,
      (err: unknown) => {
        // Allow a retry on the next request rather than wedging the app.
        bootstrapPromise = null;
        throw err;
      },
    );
  }
  return bootstrapPromise;
}

/**
 * Thrown when an authenticated user is on the researcher denylist. Identity is
 * proven; access is refused. Callers turn this into a redirect or a refused
 * action rather than letting it reach the generic error boundary.
 */
export class AccessDeniedError extends DomainError {
  constructor(email: string) {
    super('forbidden', 'Your access to this app has been withdrawn.', { email });
    this.name = 'AccessDeniedError';
  }
}

/**
 * Resolves the principal, or throws AccessDeniedError for a denied user.
 *
 * The denylist is read on every request, like admin status, so blocking
 * someone takes effect on their next request rather than when their session
 * expires.
 */
export async function getPrincipal(): Promise<Principal | null> {
  const session = await readSession();
  if (!session) return null;

  await ensureBootstrapAdmins();

  const [admin, denied] = await Promise.all([
    adminsRepo.isActiveAdmin(session.email),
    denylistRepo.isDenied(session.email),
  ]);

  // Checked after the admin lookup so a denied address that is somehow also on
  // the admin allowlist is still refused: the denylist is the stricter rule.
  if (denied) throw new AccessDeniedError(session.email);

  return {
    email: session.email,
    role: admin ? 'admin' : 'researcher',
    isMock: session.isMock,
  };
}

/**
 * For callers that render rather than guard - the layout header, the home
 * redirect. A denied user reads as signed out here; the page guard they land
 * on is what tells them why.
 */
export async function getPrincipalSafe(): Promise<Principal | null> {
  try {
    return await getPrincipal();
  } catch (err) {
    if (err instanceof AccessDeniedError) return null;
    throw err;
  }
}

/**
 * Page variant: a denied user is sent to a page that explains the block rather
 * than to the generic error boundary.
 */
async function getPrincipalOrRedirect(): Promise<Principal | null> {
  try {
    return await getPrincipal();
  } catch (err) {
    if (err instanceof AccessDeniedError) redirect(appPath('/access-denied'));
    throw err;
  }
}

/**
 * Requires a signed-in user who has accepted the current agreement version.
 * Anything else redirects rather than throwing, so pages stay simple.
 */
export async function requirePrincipal(returnTo?: string): Promise<Principal> {
  const principal = await getPrincipalOrRedirect();
  if (!principal) {
    const target = returnTo ? appPath(`/auth/signin?returnTo=${encodeURIComponent(returnTo)}`) : appPath('/auth/signin');
    redirect(target);
  }

  const accepted = await agreementsRepo.hasAcceptedCurrentAgreement(principal.email);
  if (!accepted) {
    const target = returnTo ? appPath(`/agreement?returnTo=${encodeURIComponent(returnTo)}`) : appPath('/agreement');
    redirect(target);
  }

  return principal;
}

/** Requires a signed-in user, but does not require the agreement (used by the agreement page itself). */
export async function requireSignedIn(returnTo?: string): Promise<Principal> {
  const principal = await getPrincipalOrRedirect();
  if (!principal) {
    const target = returnTo ? appPath(`/auth/signin?returnTo=${encodeURIComponent(returnTo)}`) : appPath('/auth/signin');
    redirect(target);
  }
  return principal;
}

/**
 * Admin-only page guard.
 *
 * A non-admin is sent to an explanatory page rather than the generic error
 * boundary, and the attempt is audited: repeated denials are worth seeing in
 * the trail.
 */
export async function requireAdmin(returnTo?: string): Promise<Principal> {
  const principal = await requirePrincipal(returnTo);
  if (principal.role !== 'admin') {
    await auditBestEffort({
      actorEmail: principal.email,
      action: 'auth.denied',
      targetType: 'session',
      metadata: { reason: 'not_admin', path: returnTo ?? null },
    });
    redirect(appPath(`/no-access?from=${encodeURIComponent(returnTo ?? '')}`));
  }
  return principal;
}

/**
 * Server-action variant: throws instead of redirecting, so the caller can
 * return a form error rather than a navigation.
 */
export async function requirePrincipalForAction(): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) throw new ForbiddenError('Your session has expired. Sign in again.');

  const accepted = await agreementsRepo.hasAcceptedCurrentAgreement(principal.email);
  if (!accepted) throw new ForbiddenError('You must accept the privacy and use agreement first.');

  return principal;
}

export async function requireAdminForAction(): Promise<Principal> {
  const principal = await requirePrincipalForAction();
  if (principal.role !== 'admin') throw new ForbiddenError('This action is for lab admins only.');
  return principal;
}
