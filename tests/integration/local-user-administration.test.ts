import { describe, test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { adminsRepo, localAuthRepo, query, withTransaction, type Queryable } from '@protocols/db';
import { setupDatabase, teardownDatabase, skipWithoutDatabase } from '../helpers/db.ts';

const ADMIN = 'manager@ic.ac.uk';
const OTHER = 'other-manager@ic.ac.uk';
const USER = 'new-user@ic.ac.uk';
const TEMP = 'temporary-test-password';
async function asApp(fn: (client: Queryable) => Promise<unknown>) {
  return withTransaction(async client => { await client.query('SET LOCAL ROLE protocols_app'); return fn(client); });
}
async function op(email: string, operation: localAuthRepo.AccountOperation, actor = ADMIN, version = 1) {
  return asApp(client => localAuthRepo.manageAccount(actor,version,email,operation,
    operation === 'create' || operation === 'reset' ? TEMP : undefined,client));
}

describe('in-app local user administration', { skip: skipWithoutDatabase }, () => {
  beforeEach(async () => {
    await setupDatabase();
    await localAuthRepo.setPassword(ADMIN, 'manager-test-password', true);
    await adminsRepo.addAdmin(ADMIN, 'cli@localhost');
  });
  after(teardownDatabase);

  test('app-role provisioning is audited, forces password change, and never lists hashes', async () => {
    await op(USER,'create');
    assert.deepEqual(await localAuthRepo.sessionState(USER,1),{ mustChangePassword: true });
    assert.ok(await localAuthRepo.authenticate(USER,TEMP));
    const { accounts,total } = await localAuthRepo.listAccounts('NEW-USER');
    assert.equal(total,1); assert.equal(accounts[0]?.email,USER);
    assert.equal('password_hash' in accounts[0]!,false);
    const audit = await query("SELECT * FROM audit_events WHERE action='local-account.create'");
    assert.equal(audit.rowCount,1);
    assert.equal(audit.rows[0].actor_email,ADMIN);
    assert.ok(!JSON.stringify(audit.rows).includes(TEMP));
    await assert.rejects(op(USER,'create'),/already exists/);
  });

  test('researchers, pending admins, disabled or stale actors cannot provision users', async () => {
    await localAuthRepo.setPassword(USER,TEMP,true);
    await assert.rejects(op('forged@ic.ac.uk','create',USER),/active administrator/);
    await assert.rejects(op(USER,'reset',ADMIN,99),/active administrator/);
    await query('UPDATE local_accounts SET must_change_password=true WHERE email=$1',[ADMIN]);
    await assert.rejects(op(USER,'reset'),/active administrator/);
    await query('UPDATE local_accounts SET must_change_password=false,is_active=false WHERE email=$1',[ADMIN]);
    await assert.rejects(op(USER,'reset'),/active administrator/);
  });

  test('reset, disable and reactivate invalidate sessions and preserve report ownership', async () => {
    await localAuthRepo.setPassword(USER,'original-test-password',true);
    const report=await query("INSERT INTO protocol_reports(researcher_email,report_date,protocol_type_label_snapshot,protocol_name,description_text,outcome) VALUES($1,'2026-10-27','Test type','Retained report','Retained procedure','success') RETURNING id",[USER]);
    await op(USER,'reset');
    assert.equal(await localAuthRepo.isSessionCurrent(USER,1),false);
    assert.deepEqual(await localAuthRepo.sessionState(USER,2),{ mustChangePassword: true });
    await op(USER,'disable');
    assert.equal(await localAuthRepo.authenticate(USER,TEMP),null);
    await op(USER,'reactivate');
    assert.ok(await localAuthRepo.authenticate(USER,TEMP));
    assert.equal(await localAuthRepo.isSessionCurrent(USER,2),false);
    const retained=await query('SELECT researcher_email,description_text FROM protocol_reports WHERE id=$1',[report.rows[0].id]);
    assert.equal(retained.rows[0].researcher_email,USER);
    assert.equal(retained.rows[0].description_text,'Retained procedure');
    const events = await query('SELECT action FROM audit_events WHERE target_id=$1 ORDER BY created_at',[USER]);
    assert.deepEqual(events.rows.map(r=>r.action),['local-account.reset','local-account.disable','local-account.reactivate']);
  });

  test('password change verifies current credentials, clears forced change and revokes other sessions', async () => {
    await op(USER,'create');
    await assert.rejects(localAuthRepo.changePassword(USER,1,'wrong','replacement-password'),/current password/);
    await assert.rejects(localAuthRepo.changePassword(USER,1,TEMP,TEMP),/different/);
    const version = await localAuthRepo.changePassword(USER,1,TEMP,'replacement-password');
    assert.equal(version,2);
    assert.deepEqual(await localAuthRepo.sessionState(USER,version),{mustChangePassword:false});
    assert.equal(await localAuthRepo.isSessionCurrent(USER,1),false);
    await assert.rejects(localAuthRepo.changePassword(USER,1,'replacement-password','another-new-password'),/current password/);
    assert.equal((await query("SELECT count(*) AS total FROM audit_events WHERE action='local-account.password-change'")).rows[0].total,1);
  });

  test('the app cannot directly update credentials or call privileged routines through PUBLIC', async () => {
    await assert.rejects(asApp(c => c.query("UPDATE local_accounts SET must_change_password=false WHERE email=$1",[ADMIN])),/permission denied/);
    await assert.rejects(asApp(c => c.query("DELETE FROM local_accounts WHERE email=$1",[ADMIN])),/permission denied/);
    const rights = await query("SELECT count(*) AS total FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.proname IN ('protocols_manage_local_account','protocols_change_local_password') AND a.grantee=0 AND a.privilege_type='EXECUTE'");
    assert.equal(rights.rows[0].total,0);

  });

  test('config admins and self-disable/reset are protected', async () => {
    await assert.rejects(op(ADMIN,'disable'),/cannot disable yourself/);
    await assert.rejects(op(ADMIN,'reset'),/own account/);
    await localAuthRepo.setPassword(OTHER,TEMP,true);
    await adminsRepo.addAdmin(OTHER,ADMIN);
    await adminsRepo.syncConfigAdmins([OTHER]);
    await assert.rejects(op(OTHER,'disable'),/deployment configuration/);
    await assert.rejects(op(OTHER,'demote'),/deployment configuration/);
  });

  test('only active local admins count for last-admin protection', async () => {
    await adminsRepo.addAdmin('sso-only@ic.ac.uk',ADMIN);
    await localAuthRepo.setPassword(OTHER,TEMP,true);
    await adminsRepo.addAdmin(OTHER,ADMIN);
    await query('UPDATE local_accounts SET is_active=false WHERE email=$1',[OTHER]);
    await assert.rejects(op(ADMIN,'demote'),/last active local administrator/);
  });

  test('historical SSO-only admin entries can be removed without creating password accounts', async () => {
    await adminsRepo.addAdmin('sso-only@ic.ac.uk',ADMIN);
    await op('sso-only@ic.ac.uk','demote');
    assert.equal(await adminsRepo.isActiveAdmin('sso-only@ic.ac.uk'),false);
    assert.equal((await localAuthRepo.listAccounts('sso-only')).total,0);
  });

  test('concurrent demotions cannot remove all active admins', async () => {
    await localAuthRepo.setPassword(OTHER,TEMP,true);
    await adminsRepo.addAdmin(OTHER,ADMIN);
    const results = await Promise.allSettled([op(ADMIN,'demote'),op(OTHER,'demote',OTHER)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await adminsRepo.listActiveAdminEmails()).length,1);
  });

  test('concurrent disable and demotion leave an active administrator', async () => {
    await localAuthRepo.setPassword(OTHER,TEMP,true);
    await adminsRepo.addAdmin(OTHER,ADMIN);
    const results=await Promise.allSettled([op(OTHER,'disable'),op(ADMIN,'demote',OTHER)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const active=await query('SELECT count(*) AS total FROM admin_allowlist a JOIN local_accounts l USING(email) WHERE a.removed_at IS NULL AND l.is_active');
    assert.equal(active.rows[0].total,1);
  });

  test('audit failure rolls back the credential operation', async () => {
    await query("CREATE FUNCTION test_reject_local_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$");
    await query('CREATE TRIGGER test_reject_local_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_reject_local_audit()');
    try {
      await assert.rejects(op(USER,'create'),/test audit failure/);
      assert.equal((await query('SELECT 1 FROM local_accounts WHERE email=$1',[USER])).rowCount,0);
    } finally {
      await query('DROP TRIGGER test_reject_local_audit ON audit_events');
      await query('DROP FUNCTION test_reject_local_audit()');
    }
  });
});
