import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { adminsRepo, denylistRepo, getPool, reportsRepo } from '@protocols/db';
import { DomainError, assertDeniable, parseReportFilters } from '@protocols/domain';
import {
  ADMIN,
  OTHER,
  OWNER,
  TYPE_TRANSFECTION,
  setupDatabase,
  skipWithoutDatabase,
  teardownDatabase,
} from '../helpers/db.ts';

/**
 * The researcher denylist.
 *
 * Imperial SSO authenticates the whole institution, so the app needs a way to
 * refuse a named person after their sign-in has legitimately succeeded. These
 * tests prove the block is real at the data layer and that lifting it is
 * recorded rather than erased.
 */

const base = {
  reportDate: '2026-08-30',
  protocolTypeId: TYPE_TRANSFECTION,
  protocolTypeLabelSnapshot: 'Transfection',
  protocolName: 'Ratio 1:2',
  descriptionText: 'Swapped reagent A for reagent B.',
  outcome: 'success' as const,
  outcomeHypothesis: null,
};

describe('security: researcher denylist', { skip: skipWithoutDatabase }, () => {
  beforeEach(setupDatabase);
  after(teardownDatabase);

  test('an address is not denied by default', async () => {
    assert.equal(await denylistRepo.isDenied(OWNER), false);
  });

  test('blocking an address denies it immediately', async () => {
    await denylistRepo.denyAccess(OWNER, 'Left the lab', ADMIN);
    assert.equal(await denylistRepo.isDenied(OWNER), true);
    // Blocking one person must not affect anyone else.
    assert.equal(await denylistRepo.isDenied(OTHER), false);
  });

  test('the check is case-insensitive, so capitalisation cannot evade a block', async () => {
    await denylistRepo.denyAccess('Former.Member@IC.AC.UK', null, ADMIN);
    assert.equal(await denylistRepo.isDenied('former.member@ic.ac.uk'), true);
    assert.equal(await denylistRepo.isDenied('FORMER.MEMBER@ic.ac.uk'), true);
  });

  test('lifting a block restores access and keeps the record of it', async () => {
    await denylistRepo.denyAccess(OWNER, 'Under review', ADMIN);
    const lifted = await denylistRepo.restoreAccess(OWNER, ADMIN);

    assert.ok(lifted);
    assert.ok(lifted.removedAt);
    assert.equal(lifted.removedBy, ADMIN);
    assert.equal(await denylistRepo.isDenied(OWNER), false);

    // The original denial is still visible to an admin reviewing later.
    const all = await denylistRepo.listDenylist({ includeLifted: true });
    assert.equal(all.length, 1);
    assert.equal(all[0]!.reason, 'Under review');

    const activeOnly = await denylistRepo.listDenylist();
    assert.equal(activeOnly.length, 0);
  });

  test('lifting a block that is not in place is a no-op, not an error', async () => {
    assert.equal(await denylistRepo.restoreAccess(OWNER, ADMIN), null);
  });

  test('re-blocking a lifted address reuses the row and clears the lift', async () => {
    await denylistRepo.denyAccess(OWNER, 'First reason', ADMIN);
    await denylistRepo.restoreAccess(OWNER, ADMIN);
    const again = await denylistRepo.denyAccess(OWNER, 'Second reason', ADMIN);

    assert.equal(again.removedAt, null);
    assert.equal(again.reason, 'Second reason');
    assert.equal(await denylistRepo.isDenied(OWNER), true);
    assert.equal((await denylistRepo.listDenylist({ includeLifted: true })).length, 1);
  });

  test('blocking does not delete or hide the person’s existing reports', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    await denylistRepo.denyAccess(OWNER, 'Left the lab', ADMIN);

    // The lab record is evidence; withdrawing access must not erase it. An
    // admin can still see the reports.
    const stillThere = await reportsRepo.getReport(report.id);
    assert.ok(stillThere);
    const adminView = await reportsRepo.listReports(parseReportFilters({}));
    assert.equal(adminView.total, 1);
  });

  test('an admin cannot be blocked while they are still an admin', async () => {
    await adminsRepo.addAdmin(ADMIN, 'seed');
    await adminsRepo.addAdmin(OTHER, 'seed');
    const activeAdmins = await adminsRepo.listActiveAdminEmails();

    assert.throws(
      () => assertDeniable({ target: ADMIN, actor: OTHER, activeAdmins }),
      (err: unknown) => err instanceof DomainError && err.code === 'forbidden',
    );
  });

  test('config bootstrap applies a block without an admin session', async () => {
    await denylistRepo.syncConfigDenylist([OWNER]);
    assert.equal(await denylistRepo.isDenied(OWNER), true);
  });

  test('config bootstrap re-applies a block that was lifted in the app', async () => {
    await denylistRepo.syncConfigDenylist([OWNER]);
    await denylistRepo.restoreAccess(OWNER, ADMIN);
    assert.equal(await denylistRepo.isDenied(OWNER), false);

    // On the next restart the deployment config wins again.
    await denylistRepo.syncConfigDenylist([OWNER]);
    assert.equal(await denylistRepo.isDenied(OWNER), true);
  });

  test('config bootstrap is idempotent', async () => {
    await denylistRepo.syncConfigDenylist([OWNER]);
    await denylistRepo.syncConfigDenylist([OWNER]);
    assert.equal((await denylistRepo.listDenylist({ includeLifted: true })).length, 1);
  });

  test('a config-seeded block is marked as coming from config', async () => {
    await denylistRepo.syncConfigDenylist([OWNER]);
    const [entry] = await denylistRepo.listDenylist();
    assert.equal(entry!.fromConfig, true);
  });

  test('an in-app block is not marked as coming from config', async () => {
    await denylistRepo.denyAccess(OWNER, 'Left the lab', ADMIN);
    const [entry] = await denylistRepo.listDenylist();
    assert.equal(entry!.fromConfig, false);
  });

  test('removing an address from config unpins it without lifting the block', async () => {
    await denylistRepo.syncConfigDenylist([OWNER]);
    assert.equal((await denylistRepo.listDenylist())[0]!.fromConfig, true);

    // Config no longer lists them. Tidying a config file must not quietly give
    // someone their access back, so the block stays - but it becomes an
    // ordinary entry an admin can now lift.
    await denylistRepo.syncConfigDenylist([]);

    assert.equal(await denylistRepo.isDenied(OWNER), true);
    const [entry] = await denylistRepo.listDenylist();
    assert.equal(entry!.fromConfig, false);
  });

  test('an unpinned block can then be lifted in the app', async () => {
    await denylistRepo.syncConfigDenylist([OWNER]);
    await denylistRepo.syncConfigDenylist([]);

    const lifted = await denylistRepo.restoreAccess(OWNER, ADMIN);
    assert.ok(lifted, 'the block should be liftable once config no longer pins it');
    assert.equal(await denylistRepo.isDenied(OWNER), false);
  });

  test('unpinning one address leaves other config entries pinned', async () => {
    await denylistRepo.syncConfigDenylist([OWNER, OTHER]);
    await denylistRepo.syncConfigDenylist([OTHER]);

    const byEmail = new Map((await denylistRepo.listDenylist()).map((e) => [e.email, e]));
    assert.equal(byEmail.get(OWNER)!.fromConfig, false);
    assert.equal(byEmail.get(OTHER)!.fromConfig, true);
    // Both are still blocked; only the source changed.
    assert.equal(await denylistRepo.isDenied(OWNER), true);
    assert.equal(await denylistRepo.isDenied(OTHER), true);
  });

  test('a restart re-pins an address that is still listed in config', async () => {
    await denylistRepo.syncConfigDenylist([OWNER]);
    await denylistRepo.syncConfigDenylist([]);
    await denylistRepo.restoreAccess(OWNER, ADMIN);
    assert.equal(await denylistRepo.isDenied(OWNER), false);

    // Put them back in config and restart: the block returns and is pinned again.
    await denylistRepo.syncConfigDenylist([OWNER]);
    assert.equal(await denylistRepo.isDenied(OWNER), true);
    assert.equal((await denylistRepo.listDenylist())[0]!.fromConfig, true);
  });

  test('an empty config list still runs reconciliation', async () => {
    // The early return for an empty list used to skip the demotion entirely,
    // which left the last config entry pinned forever.
    await denylistRepo.syncConfigDenylist([OWNER]);
    await denylistRepo.syncConfigDenylist([]);
    assert.equal((await denylistRepo.listDenylist())[0]!.fromConfig, false);
  });

  test('an in-app block on a config-pinned address keeps it pinned', async () => {
    await denylistRepo.syncConfigDenylist([OWNER]);
    await denylistRepo.denyAccess(OWNER, 'Also blocked in app', ADMIN);

    // Re-blocking must not silently unpin an entry config still owns, or the
    // admin page would offer a restore that the next restart undoes.
    const [entry] = await denylistRepo.listDenylist();
    assert.equal(entry!.fromConfig, true);
  });

  test('the database refuses a mixed-case denylist entry', async () => {
    await assert.rejects(
      () =>
        getPool().query(
          `INSERT INTO researcher_denylist (email, added_by) VALUES ('Mixed.Case@ic.ac.uk', 'admin@ic.ac.uk')`,
        ),
      (err: unknown) => (err as { constraint?: string }).constraint === 'researcher_denylist_email_lower',
    );
  });

  test('a lifted entry always records who lifted it', async () => {
    await denylistRepo.denyAccess(OWNER, null, ADMIN);
    await assert.rejects(
      () =>
        getPool().query('UPDATE researcher_denylist SET removed_at = now() WHERE email = $1', [OWNER]),
      (err: unknown) => (err as { constraint?: string }).constraint === 'researcher_denylist_remove_pair',
    );
  });
});
