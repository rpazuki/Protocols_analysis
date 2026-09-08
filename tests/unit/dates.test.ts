import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isIsoDate, todayIsoDate, toIsoDate } from '@protocols/domain';

describe('report dates', () => {
  test('accepts real calendar dates', () => {
    assert.ok(isIsoDate('2026-08-30'));
    assert.ok(isIsoDate('2024-02-29'));
  });

  test('rejects impossible dates rather than rolling them over', () => {
    assert.ok(!isIsoDate('2026-02-30'));
    assert.ok(!isIsoDate('2025-02-29'));
    assert.ok(!isIsoDate('2026-13-01'));
    assert.ok(!isIsoDate('30/08/2026'));
    assert.ok(!isIsoDate(''));
  });

  test('todayIsoDate uses the lab timezone, not the server timezone', () => {
    // 23:30 UTC on 30 Aug is already 31 Aug in Sydney but still 30 Aug in London.
    const instant = new Date('2026-08-30T23:30:00Z');
    assert.equal(todayIsoDate('Europe/London', instant), '2026-08-31');
    assert.equal(todayIsoDate('Australia/Sydney', instant), '2026-08-31');

    const morning = new Date('2026-08-30T09:00:00Z');
    assert.equal(todayIsoDate('Europe/London', morning), '2026-08-30');
  });

  test('toIsoDate passes through a pg date string without timezone drift', () => {
    assert.equal(toIsoDate('2026-08-30'), '2026-08-30');
  });
});
