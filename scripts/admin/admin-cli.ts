#!/usr/bin/env node
/**
 * VM-level admin recovery tool (docs/admin-ops/admin-management.md).
 *
 * Runs against the database directly, bypassing the web UI. It is the
 * documented break-glass path for when nobody can sign in as an admin.
 * Every change it makes is written to audit_events with an actor of
 * `cli:<os-user>` so VM-level intervention is distinguishable from an
 * in-app change.
 *
 *   node scripts/admin/admin-cli.ts list
 *   node scripts/admin/admin-cli.ts add    name@ic.ac.uk
 *   node scripts/admin/admin-cli.ts remove name@ic.ac.uk
 *   node scripts/admin/admin-cli.ts audit  [--action=admin.add] [--limit=50]
 *   node scripts/admin/admin-cli.ts check
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminsRepo, auditRepo, closePool, denylistRepo, query, withTransaction } from '@protocols/db';
import { DomainError, adminEmailSchema, assertDeniable } from '@protocols/domain';
import { loadDotEnv } from '../db/env.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
loadDotEnv(repoRoot);

const ACTOR = `cli:${os.userInfo().username}@${os.hostname()}`;

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function list(): Promise<void> {
  const admins = await adminsRepo.listAdmins({ includeRemoved: arg('all') !== undefined });
  if (admins.length === 0) {
    console.log('No admins. Set ADMIN_BOOTSTRAP_EMAILS and restart the app to bootstrap one.');
    return;
  }
  console.log(`${admins.length} admin(s):\n`);
  for (const admin of admins) {
    const source = admin.fromConfig ? 'config' : 'in-app';
    const status = admin.removedAt ? `REMOVED ${admin.removedAt} by ${admin.removedBy}` : 'active';
    console.log(`  ${admin.email.padEnd(34)} ${source.padEnd(7)} ${status}`);
  }
}

/**
 * The mutation and its audit event share one transaction, matching the web
 * action. A break-glass admin grant that committed without an audit row would
 * be exactly the change nobody could account for afterwards.
 */
async function add(email: string): Promise<void> {
  const normalized = adminEmailSchema.parse(email);

  const entry = await withTransaction(async (client) => {
    const added = await adminsRepo.addAdmin(normalized, ACTOR, client);
    await auditRepo.recordAuditEvent(
      {
        actorEmail: 'cli@localhost',
        action: 'admin.add',
        targetType: 'admin_allowlist',
        targetId: added.email,
        metadata: { via: 'cli', operator: ACTOR },
      },
      client,
    );
    return added;
  });

  console.log(`Added ${entry.email} as an admin.`);
}

async function remove(email: string): Promise<void> {
  const normalized = adminEmailSchema.parse(email);

  const entry = await withTransaction(async (client) => {
    // removeAdmin applies the last-admin and config-admin guards against
    // FOR UPDATE-locked rows inside whichever transaction it is given.
    const removed = await adminsRepo.removeAdmin(normalized, ACTOR, client);
    await auditRepo.recordAuditEvent(
      {
        actorEmail: 'cli@localhost',
        action: 'admin.remove',
        targetType: 'admin_allowlist',
        targetId: removed.email,
        metadata: { via: 'cli', operator: ACTOR },
      },
      client,
    );
    return removed;
  });

  console.log(`Removed ${entry.email} from the admin allowlist.`);
}

/**
 * Researcher access denylist. The VM-level counterpart of /admin/access, for
 * blocking someone when no admin session is available.
 */
async function access(sub: string | undefined, value: string | undefined): Promise<void> {
  if (sub === 'list' || sub === undefined) {
    const entries = await denylistRepo.listDenylist({ includeLifted: arg('all') !== undefined });
    if (entries.length === 0) {
      console.log('Nobody is blocked.');
      return;
    }
    console.log(`${entries.length} entry(ies):\n`);
    for (const entry of entries) {
      const status = entry.removedAt ? `lifted ${entry.removedAt} by ${entry.removedBy}` : 'BLOCKED';
      console.log(`  ${entry.email.padEnd(34)} ${status.padEnd(46)} ${entry.reason ?? ''}`);
    }
    return;
  }

  if (sub === 'block') {
    if (!value) throw new Error('Usage: admin-cli.ts access block <email> [--reason=...]');
    const email = adminEmailSchema.parse(value);

    const entry = await withTransaction(async (client) => {
      // Same guard as the UI: an admin must lose admin rights first, so the
      // two lists cannot disagree about who has access.
      const activeAdmins = await adminsRepo.listActiveAdminEmails(client);
      assertDeniable({ target: email, actor: 'cli', activeAdmins });

      const denied = await denylistRepo.denyAccess(email, arg('reason') ?? null, ACTOR, client);
      await auditRepo.recordAuditEvent(
        {
          actorEmail: 'cli@localhost',
          action: 'access.deny',
          targetType: 'researcher_denylist',
          targetId: denied.email,
          metadata: { via: 'cli', operator: ACTOR },
        },
        client,
      );
      return denied;
    });

    console.log(`Blocked ${entry.email}. Their existing reports are untouched.`);
    return;
  }

  if (sub === 'unblock') {
    if (!value) throw new Error('Usage: admin-cli.ts access unblock <email>');
    const email = adminEmailSchema.parse(value);

    const entry = await withTransaction(async (client) => {
      const restored = await denylistRepo.restoreAccess(email, ACTOR, client);
      if (!restored) return null;
      await auditRepo.recordAuditEvent(
        {
          actorEmail: 'cli@localhost',
          action: 'access.restore',
          targetType: 'researcher_denylist',
          targetId: restored.email,
          metadata: { via: 'cli', operator: ACTOR },
        },
        client,
      );
      return restored;
    });

    console.log(entry ? `Restored access for ${entry.email}.` : `${email} was not blocked.`);
    return;
  }

  throw new Error(`Unknown access subcommand "${sub}". Use list, block, or unblock.`);
}

async function audit(): Promise<void> {
  const { events, total } = await auditRepo.listAuditEvents({
    action: arg('action'),
    actorEmail: arg('actor'),
    targetId: arg('target'),
    page: 1,
    pageSize: Number(arg('limit', '50')),
  });
  console.log(`${events.length} of ${total} matching event(s), newest first:\n`);
  for (const event of events) {
    console.log(
      `  ${event.createdAt}  ${event.actorEmail.padEnd(30)} ${event.action.padEnd(28)} ` +
        `${event.targetType}${event.targetId ? `/${event.targetId}` : ''} ${JSON.stringify(event.metadata)}`,
    );
  }
}

/** Connectivity and sanity check, for use during an incident. */
async function check(): Promise<void> {
  const version = await query<{ version: string }>('SELECT version()');
  console.log(`Database: ${version.rows[0]?.version.split(',')[0]}`);

  const counts = await query<{ table_name: string; n: number }>(`
    SELECT 'protocol_reports' AS table_name, count(*)::bigint AS n FROM protocol_reports
    UNION ALL SELECT 'recycled',       count(*)::bigint FROM protocol_reports WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'tombstones',     count(*)::bigint FROM report_tombstones
    UNION ALL SELECT 'protocol_types', count(*)::bigint FROM protocol_types
    UNION ALL SELECT 'admins',         count(*)::bigint FROM admin_allowlist WHERE removed_at IS NULL
    UNION ALL SELECT 'blocked',        count(*)::bigint FROM researcher_denylist WHERE removed_at IS NULL
    UNION ALL SELECT 'agreements',     count(*)::bigint FROM user_agreement_acceptances
    UNION ALL SELECT 'audit_events',   count(*)::bigint FROM audit_events
  `);
  for (const row of counts.rows) console.log(`  ${row.table_name.padEnd(16)} ${row.n}`);

  const admins = await adminsRepo.listActiveAdminEmails();
  if (admins.length === 0) {
    console.error('\nWARNING: there are no active admins. Nobody can administer the app.');
    process.exitCode = 1;
  }

  const migrations = await query<{ filename: string; applied_at: Date }>(
    'SELECT filename, applied_at FROM schema_migrations ORDER BY filename',
  );
  console.log(`\n${migrations.rowCount} migration(s) applied:`);
  for (const row of migrations.rows) console.log(`  ${row.filename}`);
}

async function main(): Promise<void> {
  const [command, value, third] = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  switch (command) {
    case 'access':
      await access(value, third);
      break;
    case 'list':
      await list();
      break;
    case 'add':
      if (!value) throw new Error('Usage: admin-cli.ts add <email>');
      await add(value);
      break;
    case 'remove':
      if (!value) throw new Error('Usage: admin-cli.ts remove <email>');
      await remove(value);
      break;
    case 'audit':
      await audit();
      break;
    case 'check':
      await check();
      break;
    default:
      console.log(
        [
          'Lab Protocols Analysis - admin recovery CLI',
          '',
          '  list [--all]                       show the admin allowlist',
          '  add <email>                        grant admin access (break-glass)',
          '  remove <email>                     revoke admin access',
          '  access list [--all]                show the researcher access denylist',
          '  access block <email> [--reason=]   block someone from using the app',
          '  access unblock <email>             lift a block',
          '  audit [--action=] [--actor=] [--target=] [--limit=50]',
          '  check                              database connectivity and record counts',
          '',
          'Requires DATABASE_URL. Every change is written to audit_events.',
        ].join('\n'),
      );
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .catch((err: unknown) => {
    if (err instanceof DomainError) {
      console.error(`Refused: ${err.message}`);
    } else {
      console.error(err instanceof Error ? err.message : err);
    }
    process.exitCode = 1;
  })
  .finally(() => closePool());
