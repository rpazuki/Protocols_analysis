import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, assertRemovable, isAdmin } from '@protocols/domain';

describe('admin allowlist guards', () => {
  test('the last remaining admin cannot be removed', () => {
    assert.throws(
      () =>
        assertRemovable({
          target: 'only@ic.ac.uk',
          actor: 'only@ic.ac.uk',
          activeAdmins: ['only@ic.ac.uk'],
          configAdmins: [],
        }),
      (err: unknown) => err instanceof DomainError && err.code === 'last_admin_protected',
    );
  });

  test('a config-sourced admin cannot be removed in the app', () => {
    assert.throws(
      () =>
        assertRemovable({
          target: 'boot@ic.ac.uk',
          actor: 'other@ic.ac.uk',
          activeAdmins: ['boot@ic.ac.uk', 'other@ic.ac.uk'],
          configAdmins: ['boot@ic.ac.uk'],
        }),
      (err: unknown) => err instanceof DomainError && err.code === 'last_admin_protected',
    );
  });

  test('a normal admin can be removed while another remains', () => {
    assert.doesNotThrow(() =>
      assertRemovable({
        target: 'added@ic.ac.uk',
        actor: 'boot@ic.ac.uk',
        activeAdmins: ['boot@ic.ac.uk', 'added@ic.ac.uk'],
        configAdmins: ['boot@ic.ac.uk'],
      }),
    );
  });

  test('an admin may remove themselves while another admin remains', () => {
    assert.doesNotThrow(() =>
      assertRemovable({
        target: 'added@ic.ac.uk',
        actor: 'added@ic.ac.uk',
        activeAdmins: ['boot@ic.ac.uk', 'added@ic.ac.uk'],
        configAdmins: ['boot@ic.ac.uk'],
      }),
    );
  });

  test('removing someone who is not an admin is a not_found, not a silent success', () => {
    assert.throws(
      () =>
        assertRemovable({
          target: 'nobody@ic.ac.uk',
          actor: 'boot@ic.ac.uk',
          activeAdmins: ['boot@ic.ac.uk'],
          configAdmins: ['boot@ic.ac.uk'],
        }),
      (err: unknown) => err instanceof DomainError && err.code === 'not_found',
    );
  });

  test('guards are case-insensitive', () => {
    assert.ok(isAdmin('Boot@IC.AC.UK', ['boot@ic.ac.uk']));
    assert.throws(() =>
      assertRemovable({
        target: 'BOOT@ic.ac.uk',
        actor: 'x@ic.ac.uk',
        activeAdmins: ['boot@ic.ac.uk', 'x@ic.ac.uk'],
        configAdmins: ['boot@ic.ac.uk'],
      }),
    );
  });
});
