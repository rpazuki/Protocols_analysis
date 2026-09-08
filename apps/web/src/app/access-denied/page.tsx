import { readSession } from '../../server/auth/session.ts';
import { config } from '../../server/config.ts';
import { appPath } from '../../lib/paths.ts';

/**
 * Shown to an authenticated user whose access has been withdrawn.
 *
 * It states the fact and nothing else: the reason recorded on the denylist
 * entry is for admins, not for the blocked person, and repeating it here would
 * turn an access-control record into a message the app delivers on the lab's
 * behalf.
 */
export default async function AccessDeniedPage() {
  const session = await readSession();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Access withdrawn</h1>
          <p className="lede">
            {session
              ? `${session.email} signed in successfully, but access to ${config.appName} has been withdrawn for this account.`
              : `Access to ${config.appName} has been withdrawn for this account.`}
          </p>
        </div>
      </div>

      <div className="notice notice--warning" role="alert">
        <p>
          Your sign-in worked. It is this app that is refusing access, not Imperial&rsquo;s login. No
          reports can be created, viewed, or exported from this account.
        </p>
        <p>
          If you think this is a mistake, speak to a lab admin. They can restore your access, and
          they can see when and why it was withdrawn.
        </p>
      </div>

      <form action={appPath('/auth/signout')} method="post">
        <button className="btn" type="submit">
          Sign out
        </button>
      </form>
    </>
  );
}
