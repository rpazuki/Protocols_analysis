import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_FIELDS,
  EXPORT_SCHEMA_VERSION,
  csvEscape,
  exportFilename,
  exportRequestSchema,
  toCsv,
  toExportRecord,
  toJsonl,
  type ProtocolReport,
} from '@protocols/domain';

function report(overrides: Partial<ProtocolReport> = {}): ProtocolReport {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    reportDate: '2026-08-30',
    researcherEmail: 'mock.researcher@ic.ac.uk',
    protocolTypeId: 'bbbbbbbb-0000-0000-0000-000000000002',
    protocolTypeLabelSnapshot: 'Transfection',
    protocolName: 'Ratio 1:2',
    descriptionText: 'Line one\nLine two',
    descriptionNormalized: 'Line one\nLine two',
    outcome: 'failure',
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

describe('export records', () => {
  test('every declared field is present and versioned', () => {
    const record = toExportRecord(report());
    assert.equal(record.schema_version, EXPORT_SCHEMA_VERSION);
    for (const field of EXPORT_FIELDS) {
      assert.ok(field in record, `missing export field ${field}`);
    }
  });

  test('record_state distinguishes active from recycled', () => {
    assert.equal(toExportRecord(report()).record_state, 'active');
    assert.equal(
      toExportRecord(report({ deletedAt: '2026-08-30T10:00:00.000Z', deletedBy: 'x@ic.ac.uk' }))
        .record_state,
      'recycled',
    );
  });
});

describe('CSV serialization', () => {
  test('quotes values containing commas, quotes, or newlines', () => {
    assert.equal(csvEscape('a,b'), '"a,b"');
    assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
    assert.equal(csvEscape('one\ntwo'), '"one\ntwo"');
    assert.equal(csvEscape('plain'), 'plain');
  });

  test('null becomes an empty field, not the string "null"', () => {
    assert.equal(csvEscape(null), '');
  });

  test('neutralises spreadsheet formula injection', () => {
    // Protocol free text is user-controlled and these files are opened in Excel.
    assert.equal(csvEscape('=SUM(A1:A9)'), "'=SUM(A1:A9)");
    assert.equal(csvEscape('+1'), "'+1");
    assert.equal(csvEscape('-1'), "'-1");
    assert.equal(csvEscape('@cmd'), "'@cmd");
  });

  test('emits a header row followed by one row per record', () => {
    const csv = toCsv([toExportRecord(report())]);
    const [header] = csv.split('\r\n');
    assert.equal(header, EXPORT_FIELDS.join(','));
    assert.ok(csv.includes('mock.researcher@ic.ac.uk'));
  });
});

describe('JSONL serialization', () => {
  test('produces one parsable object per line', () => {
    const jsonl = toJsonl([toExportRecord(report()), toExportRecord(report({ id: 'x' }))]);
    const lines = jsonl.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]!).researcher_email, 'mock.researcher@ic.ac.uk');
  });

  test('an empty export is an empty string, not a stray newline', () => {
    assert.equal(toJsonl([]), '');
  });
});

describe('export request', () => {
  test('recycled records are excluded unless explicitly requested', () => {
    assert.equal(exportRequestSchema.parse({}).includeRecycled, false);
    assert.equal(exportRequestSchema.parse({ includeRecycled: true }).includeRecycled, true);
  });

  test('defaults to CSV', () => {
    assert.equal(exportRequestSchema.parse({}).format, 'csv');
  });

  test('rejects an unknown format', () => {
    assert.throws(() => exportRequestSchema.parse({ format: 'xlsx' }));
  });

  test('rejects a malformed date filter', () => {
    assert.throws(() => exportRequestSchema.parse({ from: '30/08/2026' }));
  });

  test('filename records scope and format', () => {
    const name = exportFilename(exportRequestSchema.parse({}), new Date('2026-08-30T09:00:00Z'));
    assert.match(name, /^protocol-reports_active_2026-08-30T09-00-00\.csv$/);

    const all = exportFilename(
      exportRequestSchema.parse({ includeRecycled: true, format: 'jsonl' }),
      new Date('2026-08-30T09:00:00Z'),
    );
    assert.match(all, /^protocol-reports_all_.*\.jsonl$/);
  });
});
