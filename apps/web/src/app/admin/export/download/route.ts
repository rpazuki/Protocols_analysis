import { NextResponse, type NextRequest } from 'next/server';
import { agreementsRepo, reportsRepo } from '@protocols/db';
import {
  csvHeaderRow,
  csvRow,
  exportContentType,
  exportFilename,
  exportRequestSchema,
  jsonlRow,
  toExportRecord,
} from '@protocols/domain';
import { config } from '../../../../server/config.ts';
import { auditBestEffort, auditRequired } from '../../../../server/audit.ts';
import { AccessDeniedError, getPrincipal } from '../../../../server/auth/principal.ts';
import { isSameOriginRequest } from '../../../../server/same-origin.ts';
import { appUrl } from '../../../../server/urls.ts';

/**
 * Streams a CSV or JSONL export.
 *
 * POST only. An export carries raw email addresses and the full text of every
 * matching report, so producing one must be a deliberate same-origin action:
 * a GET route can be triggered by a link, an image tag, a prefetch, or a
 * pasted URL in another tab, none of which the admin meant as "release the lab
 * record". The handler therefore checks `Origin` against the request host
 * before doing any work, the same check Next applies to server actions.
 *
 * Admin-only and audited (docs/data-export/export-plan.md).
 */

export async function POST(request: NextRequest): Promise<Response> {
  if (
    !isSameOriginRequest(request.headers, {
      appUrl: config.appUrl,
      allowedOrigins: config.allowedOrigins,
    })
  ) {
    return new NextResponse('Export requests must come from the export page.', { status: 403 });
  }

  let principal;
  try {
    principal = await getPrincipal();
  } catch (err) {
    // A denied user is refused here rather than redirected: this endpoint
    // returns a file, and a redirect would land in the download.
    if (err instanceof AccessDeniedError) {
      return new NextResponse('Your access to this app has been withdrawn.', { status: 403 });
    }
    throw err;
  }
  if (!principal) {
    return NextResponse.redirect(appUrl('/auth/signin?returnTo=/admin/export'), 303);
  }
  if (!(await agreementsRepo.hasAcceptedCurrentAgreement(principal.email))) {
    return NextResponse.redirect(appUrl('/agreement?returnTo=/admin/export'), 303);
  }
  if (principal.role !== 'admin') {
    await auditBestEffort({
      actorEmail: principal.email,
      action: 'auth.denied',
      targetType: 'export',
      metadata: { reason: 'not_admin' },
    });
    return new NextResponse('Exports are for lab admins only.', { status: 403 });
  }

  const form = await request.formData();
  const field = (name: string): string | undefined => {
    const value = form.get(name);
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };

  const parsed = exportRequestSchema.safeParse({
    format: field('format') ?? 'csv',
    from: field('from'),
    to: field('to'),
    researcherEmail: field('researcherEmail'),
    protocolTypeId: field('protocolTypeId'),
    outcome: field('outcome'),
    q: field('q'),
    // An unticked checkbox is absent from the body entirely.
    includeRecycled: field('includeRecycled') === 'true',
  });

  if (!parsed.success) {
    return new NextResponse(`Invalid export filters: ${parsed.error.issues[0]?.message ?? 'unknown'}`, {
      status: 400,
    });
  }
  const exportRequest = parsed.data;

  const total = await reportsRepo.countReportsForExport(exportRequest);
  if (total > config.exportMaxRows) {
    return new NextResponse(
      `This export would contain ${total} records, above the configured limit of ${config.exportMaxRows}. Narrow the date range and try again.`,
      { status: 413 },
    );
  }

  const generatedAt = new Date();
  const filename = exportFilename(exportRequest, generatedAt);

  // Audited before a single byte is sent, and the export is refused outright if
  // the audit write fails: an export that failed halfway still means the data
  // left the database, and an unrecorded one would defeat the accountability
  // requirement in the export plan.
  try {
    await auditRequired({
      actorEmail: principal.email,
      action: 'export.run',
      targetType: 'export',
      targetId: filename,
      metadata: {
        format: exportRequest.format,
        rows: total,
        includeRecycled: exportRequest.includeRecycled,
        from: exportRequest.from ?? null,
        to: exportRequest.to ?? null,
        researcherEmail: exportRequest.researcherEmail ?? null,
        protocolTypeId: exportRequest.protocolTypeId ?? null,
        outcome: exportRequest.outcome ?? null,
        textSearch: Boolean(exportRequest.q),
      },
    });
  } catch {
    return new NextResponse(
      'This export could not be recorded in the audit log, so it was not produced. Tell the lab admin.',
      { status: 503 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (exportRequest.format === 'csv') {
          // BOM so Excel opens UTF-8 protocol text correctly.
          controller.enqueue(encoder.encode('﻿'));
          controller.enqueue(encoder.encode(`${csvHeaderRow()}\r\n`));
        }

        for await (const batch of reportsRepo.streamReportsForExport(exportRequest)) {
          const chunk = batch
            .map((report) => {
              const record = toExportRecord(report);
              return exportRequest.format === 'csv' ? `${csvRow(record)}\r\n` : `${jsonlRow(record)}\n`;
            })
            .join('');
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        console.error('[export] stream failed', err);
        controller.error(err);
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'content-type': exportContentType(exportRequest.format),
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
      'x-export-rows': String(total),
    },
  });
}

/**
 * A GET is almost always a pasted or bookmarked download URL. Redirect to the
 * export page rather than producing a file, so the release of lab data always
 * goes through a deliberate submit.
 */
export async function GET(): Promise<Response> {
  return NextResponse.redirect(appUrl('/admin/export'), 303);
}
