import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AUTHZ_POLICY,
  canEditReport,
  canExport,
  canManageAdmins,
  canManageProtocolTypes,
  canPermanentlyDeleteReport,
  canRecycleReport,
  canRestoreReport,
  canViewAllReports,
  canViewReport,
  type Principal,
  type ProtocolReport,
} from '@protocols/domain';

const researcher: Principal = { email: 'owner@ic.ac.uk', role: 'researcher', isMock: true };
const otherResearcher: Principal = { email: 'other@ic.ac.uk', role: 'researcher', isMock: true };
const admin: Principal = { email: 'admin@ic.ac.uk', role: 'admin', isMock: true };

function report(overrides: Partial<ProtocolReport> = {}): ProtocolReport {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    reportDate: '2026-08-30',
    researcherEmail: 'owner@ic.ac.uk',
    protocolTypeId: null,
    protocolTypeLabelSnapshot: 'Transfection',
    protocolName: 'Test',
    descriptionText: 'text',
    descriptionNormalized: 'text',
    outcome: 'success',
    outcomeHypothesis: null,
    createdAt: '2026-08-30T09:00:00.000Z',
    updatedAt: '2026-08-30T09:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
    restoredAt: null,
    restoredBy: null,
    ...overrides,
  };
}

const recycled = report({ deletedAt: '2026-08-30T10:00:00.000Z', deletedBy: 'owner@ic.ac.uk' });

describe('viewing', () => {
  test('a researcher sees only their own reports', () => {
    assert.ok(canViewReport(researcher, report()));
    assert.ok(!canViewReport(otherResearcher, report()));
  });

  test('an admin sees every report', () => {
    assert.ok(canViewReport(admin, report()));
    assert.ok(canViewAllReports(admin));
    assert.ok(!canViewAllReports(researcher));
  });

  test('ownership comparison is case-insensitive', () => {
    const upper: Principal = { email: 'Owner@IC.AC.UK', role: 'researcher', isMock: true };
    assert.ok(canViewReport(upper, report()));
  });
});

describe('editing', () => {
  test('only the owner may edit, not an admin', () => {
    assert.ok(canEditReport(researcher, report()));
    assert.ok(!canEditReport(otherResearcher, report()));
    assert.ok(!canEditReport(admin, report()));
  });

  test('a recycled report cannot be edited until it is restored', () => {
    assert.ok(!canEditReport(researcher, recycled));
  });
});

describe('recycle bin', () => {
  test('the owner or an admin may recycle an active report', () => {
    assert.ok(canRecycleReport(researcher, report()));
    assert.ok(canRecycleReport(admin, report()));
    assert.ok(!canRecycleReport(otherResearcher, report()));
  });

  test('an already-recycled report cannot be recycled again', () => {
    assert.ok(!canRecycleReport(researcher, recycled));
  });

  test('restore follows the configured policy', () => {
    assert.ok(canRestoreReport(researcher, recycled, DEFAULT_AUTHZ_POLICY));
    assert.ok(!canRestoreReport(otherResearcher, recycled, DEFAULT_AUTHZ_POLICY));

    const adminOnly = { ...DEFAULT_AUTHZ_POLICY, allowResearcherRestore: false };
    assert.ok(!canRestoreReport(researcher, recycled, adminOnly));
    assert.ok(canRestoreReport(admin, recycled, adminOnly));
  });

  test('an active report cannot be restored', () => {
    assert.ok(!canRestoreReport(admin, report(), DEFAULT_AUTHZ_POLICY));
  });
});

describe('permanent delete', () => {
  test('only applies to recycled reports', () => {
    assert.ok(!canPermanentlyDeleteReport(admin, report(), DEFAULT_AUTHZ_POLICY));
    assert.ok(canPermanentlyDeleteReport(admin, recycled, DEFAULT_AUTHZ_POLICY));
  });

  test('another researcher can never permanently delete someone else’s report', () => {
    assert.ok(!canPermanentlyDeleteReport(otherResearcher, recycled, DEFAULT_AUTHZ_POLICY));
  });

  test('the waiting period blocks everyone, including admins', () => {
    const policy = { ...DEFAULT_AUTHZ_POLICY, permanentDeleteWaitDays: 30 };
    const now = new Date('2026-08-31T10:00:00.000Z');
    assert.ok(!canPermanentlyDeleteReport(admin, recycled, policy, now));
    assert.ok(!canPermanentlyDeleteReport(researcher, recycled, policy, now));

    const later = new Date('2026-10-30T10:00:00.000Z');
    assert.ok(canPermanentlyDeleteReport(admin, recycled, policy, later));
  });

  test('researcher purge can be turned off without affecting admins', () => {
    const policy = { ...DEFAULT_AUTHZ_POLICY, allowResearcherPermanentDelete: false };
    assert.ok(!canPermanentlyDeleteReport(researcher, recycled, policy));
    assert.ok(canPermanentlyDeleteReport(admin, recycled, policy));
  });
});

describe('admin-only capabilities', () => {
  test('researchers cannot manage types, admins, or exports', () => {
    assert.ok(!canManageProtocolTypes(researcher));
    assert.ok(!canManageAdmins(researcher));
    assert.ok(!canExport(researcher));
  });

  test('admins can', () => {
    assert.ok(canManageProtocolTypes(admin));
    assert.ok(canManageAdmins(admin));
    assert.ok(canExport(admin));
  });
});
