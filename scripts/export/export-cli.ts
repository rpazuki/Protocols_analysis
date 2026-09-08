#!/usr/bin/env node
/**
 * Operational export tool (docs/data-export/export-plan.md).
 *
 * The admin UI is the normal route. This exists for scheduled or scripted
 * exports on the VM, and for the case where a lab admin needs a large export
 * that would be awkward through a browser.
 *
 * It applies the same rules as the app: recycled records are excluded unless
 * asked for, permanently deleted records cannot be exported at all, and every
 * run is written to audit_events.
 *
 *   node scripts/export/export-cli.ts --format=csv --out=exports/reports.csv
 *   node scripts/export/export-cli.ts --format=jsonl --from=2026-01-01 --to=2026-06-30
 *   node scripts/export/export-cli.ts --include-recycled --researcher=name@ic.ac.uk
 *
 * WARNING: the output contains raw Imperial email addresses, which are
 * personal data. Write it to lab-controlled storage, and delete it when the
 * analysis is done.
 */
import os from 'node:os';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { auditRepo, closePool, reportsRepo } from '@protocols/db';
import {
  csvHeaderRow,
  csvRow,
  exportFilename,
  exportRequestSchema,
  jsonlRow,
  toExportRecord,
} from '@protocols/domain';
import { loadDotEnv } from '../db/env.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
loadDotEnv(repoRoot);

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  if (flag('help')) {
    console.log(
      [
        'Lab Protocols Analysis - export CLI',
        '',
        '  --format=csv|jsonl        default csv',
        '  --out=<path>              default storage/local-dev/<generated name>',
        '  --from=YYYY-MM-DD         earliest report date',
        '  --to=YYYY-MM-DD           latest report date',
        '  --researcher=<email>      one researcher only',
        '  --type=<uuid>             one protocol type only',
        '  --outcome=success|failure',
        '  --search=<text>           full-text search',
        '  --include-recycled        include recycle-bin records (excluded by default)',
        '',
        'Refuses exports larger than EXPORT_MAX_ROWS (default 100000).',
        'The audit event is written before the file, so a failed write still leaves',
        'a record of the attempt rather than an unaudited data release.',
        'Output contains raw email addresses. Treat it as personal data.',
      ].join('\n'),
    );
    return;
  }

  const request = exportRequestSchema.parse({
    format: arg('format') ?? 'csv',
    from: arg('from'),
    to: arg('to'),
    researcherEmail: arg('researcher'),
    protocolTypeId: arg('type'),
    outcome: arg('outcome'),
    q: arg('search'),
    includeRecycled: flag('include-recycled'),
  });

  const generatedAt = new Date();
  const outPath = path.resolve(
    repoRoot,
    arg('out') ?? path.join('storage', 'local-dev', exportFilename(request, generatedAt)),
  );
  await mkdir(path.dirname(outPath), { recursive: true });

  const total = await reportsRepo.countReportsForExport(request);

  // Same ceiling as the web app, so one scripted run cannot pull the whole lab
  // record by accident when the UI would have refused.
  const maxRows = Number(process.env.EXPORT_MAX_ROWS ?? '100000');
  if (Number.isFinite(maxRows) && total > maxRows) {
    throw new Error(
      `This export would contain ${total} records, above the EXPORT_MAX_ROWS limit of ${maxRows}. ` +
        'Narrow the date range, or raise the limit deliberately.',
    );
  }

  console.log(`Exporting ${total} record(s) as ${request.format} to ${outPath}`);
  if (request.includeRecycled) console.log('Including recycle-bin records.');

  // Audited before the output file is opened, and the export is abandoned if
  // the audit write fails. The web route does the same before streaming its
  // first byte: an unrecorded release of the lab record is the thing the
  // export plan exists to prevent, and a file on disk is a release.
  await auditRepo.recordAuditEvent({
    actorEmail: 'cli@localhost',
    action: 'export.run',
    targetType: 'export',
    targetId: path.basename(outPath),
    metadata: {
      via: 'cli',
      operator: `${os.userInfo().username}@${os.hostname()}`,
      format: request.format,
      rows: total,
      includeRecycled: request.includeRecycled,
      from: request.from ?? null,
      to: request.to ?? null,
      researcherEmail: request.researcherEmail ?? null,
    },
  });

  const out = createWriteStream(outPath, { encoding: 'utf8' });
  const write = (chunk: string): Promise<void> =>
    new Promise((resolve, reject) => {
      out.write(chunk, (err) => (err ? reject(err) : resolve()));
    });

  if (request.format === 'csv') {
    await write('﻿');
    await write(`${csvHeaderRow()}\r\n`);
  }

  let written = 0;
  for await (const batch of reportsRepo.streamReportsForExport(request)) {
    const chunk = batch
      .map((report) => {
        const record = toExportRecord(report);
        return request.format === 'csv' ? `${csvRow(record)}\r\n` : `${jsonlRow(record)}\n`;
      })
      .join('');
    await write(chunk);
    written += batch.length;
  }

  await new Promise<void>((resolve, reject) => out.end((err?: Error) => (err ? reject(err) : resolve())));

  console.log(`Wrote ${written} record(s). Export recorded in audit_events before writing.`);
  console.log('Reminder: this file contains raw email addresses. Store and delete it accordingly.');
}

main()
  .catch((err: unknown) => {
    console.error('Export failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
