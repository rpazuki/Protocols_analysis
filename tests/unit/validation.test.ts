import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGREEMENT_VERSION,
  assertDeniable,
  DomainError,
  denylistAddSchema,
  hasAcceptedCurrent,
  parseReportFilters,
  protocolReportInputSchema,
  protocolTypeInputSchema,
  sanitizeAuditMetadata,
} from '@protocols/domain';

const valid = {
  reportDate: '2026-08-30',
  protocolTypeId: '60c673a4-f865-414c-a543-84879614e2da',
  protocolName: 'Ratio 1:2',
  descriptionText: 'Swapped reagent A for reagent B.',
  outcome: 'success',
  outcomeHypothesis: '',
};

describe('protocol report input', () => {
  test('accepts a complete submission', () => {
    const parsed = protocolReportInputSchema.parse(valid);
    assert.equal(parsed.outcome, 'success');
    // An empty hypothesis is stored as NULL, not as an empty string.
    assert.equal(parsed.outcomeHypothesis, null);
  });

  test('rejects a blank description', () => {
    assert.throws(() => protocolReportInputSchema.parse({ ...valid, descriptionText: '   \n  ' }));
  });

  test('rejects a blank protocol name', () => {
    assert.throws(() => protocolReportInputSchema.parse({ ...valid, protocolName: '  ' }));
  });

  test('rejects an outcome outside success/failure', () => {
    assert.throws(() => protocolReportInputSchema.parse({ ...valid, outcome: 'partial' }));
  });

  test('rejects an impossible report date', () => {
    assert.throws(() => protocolReportInputSchema.parse({ ...valid, reportDate: '2026-02-30' }));
  });

  test('rejects a non-uuid protocol type', () => {
    assert.throws(() => protocolReportInputSchema.parse({ ...valid, protocolTypeId: 'transfection' }));
  });

  test('never accepts a researcher email from the form', () => {
    const parsed = protocolReportInputSchema.parse({
      ...valid,
      researcherEmail: 'attacker@ic.ac.uk',
    } as Record<string, unknown>);
    assert.ok(!('researcherEmail' in parsed));
  });

  test('accepts a very long description, since length is unrestricted by design', () => {
    const long = 'x'.repeat(50_000);
    assert.equal(protocolReportInputSchema.parse({ ...valid, descriptionText: long }).descriptionText, long);
  });
});

describe('protocol type input', () => {
  test('normalizes the label and defaults to active', () => {
    const parsed = protocolTypeInputSchema.parse({ label: '  Western   blot ' });
    assert.equal(parsed.label, 'Western blot');
    assert.equal(parsed.active, true);
  });

  test('an empty description becomes null', () => {
    assert.equal(protocolTypeInputSchema.parse({ label: 'X', description: '  ' }).description, null);
  });

  test('rejects a blank label', () => {
    assert.throws(() => protocolTypeInputSchema.parse({ label: '   ' }));
  });
});

describe('agreement', () => {
  test('an older accepted version does not satisfy the current one', () => {
    assert.ok(!hasAcceptedCurrent([{ agreementVersion: '2020-01-01.1' }]));
    assert.ok(hasAcceptedCurrent([{ agreementVersion: AGREEMENT_VERSION }]));
    assert.ok(!hasAcceptedCurrent([]));
  });
});

describe('audit metadata sanitization', () => {
  test('truncates long strings so report text cannot leak into the audit trail', () => {
    const out = sanitizeAuditMetadata({ note: 'y'.repeat(1000) });
    assert.ok((out.note as string).length <= 301);
  });

  test('drops nested objects', () => {
    const out = sanitizeAuditMetadata({ nested: { secret: 'value' }, keep: 1 });
    assert.ok(!('nested' in out));
    assert.equal(out.keep, 1);
  });

  test('preserves scalars and caps arrays', () => {
    const out = sanitizeAuditMetadata({ n: 5, b: true, nil: null, arr: Array(50).fill('a') });
    assert.equal(out.n, 5);
    assert.equal(out.b, true);
    assert.equal(out.nil, null);
    assert.equal((out.arr as unknown[]).length, 20);
  });
});


describe('report filter parsing', () => {
  /**
   * An HTML GET form submits every field, so an untouched filter arrives as an
   * empty string. Blank must mean "no filter", not "invalid date".
   */
  test('blank fields from an untouched filter form parse as no filter', () => {
    const filter = parseReportFilters({
      from: '',
      to: '',
      protocolTypeId: '',
      researcherEmail: '',
      outcome: '',
      q: '',
    });

    assert.equal(filter.from, undefined);
    assert.equal(filter.to, undefined);
    assert.equal(filter.protocolTypeId, undefined);
    assert.equal(filter.researcherEmail, undefined);
    assert.equal(filter.outcome, undefined);
    assert.equal(filter.q, undefined);
  });

  test('blank state and paging fields fall back to their defaults', () => {
    const filter = parseReportFilters({ state: '', page: '', pageSize: '' });
    assert.equal(filter.state, 'active');
    assert.equal(filter.page, 1);
    assert.equal(filter.pageSize, 25);
  });

  test('whitespace-only values are treated as blank', () => {
    assert.equal(parseReportFilters({ q: '   ' }).q, undefined);
  });

  test('real values still parse', () => {
    const filter = parseReportFilters({
      from: '2026-01-01',
      outcome: 'failure',
      q: 'lipofectamine',
      page: '3',
    });
    assert.equal(filter.from, '2026-01-01');
    assert.equal(filter.outcome, 'failure');
    assert.equal(filter.q, 'lipofectamine');
    assert.equal(filter.page, 3);
  });

  test('genuinely invalid values are still rejected', () => {
    assert.throws(() => parseReportFilters({ from: '30/08/2026' }));
    assert.throws(() => parseReportFilters({ outcome: 'partial' }));
    assert.throws(() => parseReportFilters({ protocolTypeId: 'not-a-uuid' }));
  });

  test('forceState cannot be overridden through the query string', () => {
    const filter = parseReportFilters({ state: 'all' }, { forceState: 'recycled' });
    assert.equal(filter.state, 'recycled');
  });

  test('accepts a URLSearchParams directly', () => {
    const filter = parseReportFilters(new URLSearchParams('from=&outcome=success'));
    assert.equal(filter.from, undefined);
    assert.equal(filter.outcome, 'success');
  });
});

describe('access denylist input', () => {
  test('normalizes the email and blanks an empty reason', () => {
    const parsed = denylistAddSchema.parse({ email: '  Former.Member@IC.AC.UK ', reason: '   ' });
    assert.equal(parsed.email, 'former.member@ic.ac.uk');
    assert.equal(parsed.reason, null);
  });

  test('keeps a real reason', () => {
    const parsed = denylistAddSchema.parse({ email: 'x@ic.ac.uk', reason: 'Left the lab' });
    assert.equal(parsed.reason, 'Left the lab');
  });

  test('rejects an invalid address', () => {
    assert.throws(() => denylistAddSchema.parse({ email: 'not-an-email' }));
  });

  test('an admin cannot be blocked without first removing their admin access', () => {
    assert.throws(
      () =>
        assertDeniable({
          target: 'admin@ic.ac.uk',
          actor: 'other.admin@ic.ac.uk',
          activeAdmins: ['admin@ic.ac.uk', 'other.admin@ic.ac.uk'],
        }),
      (err: unknown) => err instanceof DomainError && err.code === 'forbidden',
    );
  });

  test('an admin cannot block themselves', () => {
    assert.throws(
      () =>
        assertDeniable({
          target: 'admin@ic.ac.uk',
          actor: 'admin@ic.ac.uk',
          activeAdmins: ['admin@ic.ac.uk'],
        }),
      (err: unknown) => err instanceof DomainError && err.code === 'forbidden',
    );
  });

  test('an ordinary researcher can be blocked', () => {
    assert.doesNotThrow(() =>
      assertDeniable({
        target: 'researcher@ic.ac.uk',
        actor: 'admin@ic.ac.uk',
        activeAdmins: ['admin@ic.ac.uk'],
      }),
    );
  });

  test('the admin guard is case-insensitive', () => {
    assert.throws(() =>
      assertDeniable({
        target: 'ADMIN@ic.ac.uk',
        actor: 'other@ic.ac.uk',
        activeAdmins: ['admin@ic.ac.uk', 'other@ic.ac.uk'],
      }),
    );
  });
});
