'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { appPath } from '../../lib/paths.ts';
import { protocolTypesRepo, reportsRepo, withTransaction } from '@protocols/db';
import {
  DomainError,
  NotFoundError,
  canEditReport,
  canPermanentlyDeleteReport,
  canRecycleReport,
  canRestoreReport,
  canViewReport,
  protocolReportInputSchema,
  type ProtocolReport,
} from '@protocols/domain';
import { config } from '../config.ts';
import { auditRequired } from '../audit.ts';
import { requirePrincipalForAction } from '../auth/principal.ts';
import { errorState, successState, toFormState, type FormState } from './form-state.ts';

/**
 * Every action here re-derives the principal from the session and re-checks
 * authorization against the freshly loaded row. Nothing trusts a hidden form
 * field, and researcher_email is never read from the request.
 */

function parseForm(formData: FormData) {
  return protocolReportInputSchema.parse({
    reportDate: String(formData.get('reportDate') ?? ''),
    protocolTypeId: String(formData.get('protocolTypeId') ?? ''),
    protocolName: String(formData.get('protocolName') ?? ''),
    descriptionText: String(formData.get('descriptionText') ?? ''),
    outcome: String(formData.get('outcome') ?? ''),
    outcomeHypothesis: String(formData.get('outcomeHypothesis') ?? ''),
  });
}

/** Loads the protocol type and refuses inactive ones for new/edited reports. */
async function resolveActiveType(protocolTypeId: string): Promise<{ id: string; label: string }> {
  const type = await protocolTypesRepo.getProtocolType(protocolTypeId);
  if (!type) throw new DomainError('validation_failed', 'That protocol type no longer exists.');
  if (!type.active) {
    throw new DomainError(
      'inactive_protocol_type',
      `"${type.label}" has been disabled by an admin and cannot be used for new reports.`,
    );
  }
  return { id: type.id, label: type.label };
}

export async function createReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let newId: string;
  try {
    const principal = await requirePrincipalForAction();
    const input = parseForm(formData);
    const type = await resolveActiveType(input.protocolTypeId);

    // Friendly pre-check. The unique index is the real guard; see below.
    const existing = await reportsRepo.findDuplicate({
      researcherEmail: principal.email,
      reportDate: input.reportDate,
      descriptionText: input.descriptionText,
    });
    if (existing) {
      return {
        ok: false,
        message: duplicateMessage(existing),
        fieldErrors: { descriptionText: 'This exact description already exists for this date.' },
        data: { existingReportId: existing.id, existingState: existing.deletedAt ? 'recycled' : 'active' },
      };
    }

    const copiedFrom = String(formData.get('copiedFromReportId') ?? '').trim();

    // The insert and its audit event commit together, so a failed audit write
    // cannot leave a saved report that the trail has no record of.
    const report = await withTransaction(async (client) => {
      const created = await reportsRepo.createReport(
        {
          ...input,
          researcherEmail: principal.email,
          protocolTypeLabelSnapshot: type.label,
        },
        client,
      );
      await auditRequired(
        {
          actorEmail: principal.email,
          action: copiedFrom ? 'report.create_from_existing' : 'report.create',
          targetType: 'protocol_report',
          targetId: created.id,
          metadata: {
            reportDate: created.reportDate,
            outcome: created.outcome,
            protocolTypeId: created.protocolTypeId,
            ...(copiedFrom ? { copiedFrom } : {}),
          },
        },
        client,
      );
      return created;
    });

    newId = report.id;
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath('/reports');
  redirect(appPath(`/reports/${newId}?created=1`));
}

export async function updateReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  try {
    const principal = await requirePrincipalForAction();
    const existing = await reportsRepo.getReport(id);
    if (!existing) throw new NotFoundError('That report no longer exists.');
    if (!canViewReport(principal, existing)) throw new NotFoundError('That report no longer exists.');
    if (!canEditReport(principal, existing)) {
      throw new DomainError('forbidden', 'You can only edit your own active reports.');
    }

    const input = parseForm(formData);
    // Keep the original snapshot when the type is unchanged, so an admin
    // renaming a type does not silently rewrite history through an edit.
    const label =
      input.protocolTypeId === existing.protocolTypeId
        ? existing.protocolTypeLabelSnapshot
        : (await resolveActiveType(input.protocolTypeId)).label;

    const duplicate = await reportsRepo.findDuplicate({
      researcherEmail: principal.email,
      reportDate: input.reportDate,
      descriptionText: input.descriptionText,
      excludeId: id,
    });
    if (duplicate) {
      return {
        ok: false,
        message: duplicateMessage(duplicate),
        fieldErrors: { descriptionText: 'This exact description already exists for this date.' },
        data: { existingReportId: duplicate.id },
      };
    }

    await withTransaction(async (client) => {
      await reportsRepo.updateReport(id, { ...input, protocolTypeLabelSnapshot: label }, client);
      await auditRequired(
        {
          actorEmail: principal.email,
          action: 'report.update',
          targetType: 'protocol_report',
          targetId: id,
          metadata: { reportDate: input.reportDate, outcome: input.outcome },
        },
        client,
      );
    });
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath('/reports');
  revalidatePath(`/reports/${id}`);
  redirect(appPath(`/reports/${id}?updated=1`));
}

export async function recycleReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  try {
    const principal = await requirePrincipalForAction();
    const existing = await reportsRepo.getReport(id);
    if (!existing || !canViewReport(principal, existing)) {
      throw new NotFoundError('That report no longer exists.');
    }
    if (!canRecycleReport(principal, existing)) {
      throw new DomainError('forbidden', 'You can only move your own active reports to the recycle bin.');
    }

    await withTransaction(async (client) => {
      await reportsRepo.recycleReport(id, principal.email, client);
      await auditRequired(
        {
          actorEmail: principal.email,
          action: 'report.recycle',
          targetType: 'protocol_report',
          targetId: id,
          metadata: { owner: existing.researcherEmail, byAdmin: principal.role === 'admin' },
        },
        client,
      );
    });
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath('/reports');
  revalidatePath('/reports/recycle-bin');
  revalidatePath('/admin/reports');
  return successState('Report moved to the recycle bin.');
}

export async function restoreReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  try {
    const principal = await requirePrincipalForAction();
    const existing = await reportsRepo.getReport(id);
    if (!existing || !canViewReport(principal, existing)) {
      throw new NotFoundError('That report no longer exists.');
    }
    if (!canRestoreReport(principal, existing, config.authz)) {
      return errorState(
        config.authz.allowResearcherRestore
          ? 'You can only restore your own recycled reports.'
          : 'Restoring recycled reports is reserved for lab admins. Ask an admin to restore it for you.',
      );
    }

    await withTransaction(async (client) => {
      await reportsRepo.restoreReport(id, principal.email, client);
      await auditRequired(
        {
          actorEmail: principal.email,
          action: 'report.restore',
          targetType: 'protocol_report',
          targetId: id,
          metadata: { owner: existing.researcherEmail, byAdmin: principal.role === 'admin' },
        },
        client,
      );
    });
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath('/reports');
  revalidatePath('/reports/recycle-bin');
  revalidatePath('/admin/recycle-bin');
  return successState('Report restored.');
}

/**
 * Permanently deletes a recycled report. The row and all its free text are
 * removed; a tombstone and an audit event remain. Irreversible.
 */
export async function permanentlyDeleteReportAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  try {
    const principal = await requirePrincipalForAction();

    // Typed confirmation, because there is no undo.
    if (String(formData.get('confirm') ?? '').trim().toUpperCase() !== 'DELETE') {
      return errorState('Type DELETE to confirm permanent deletion.', {
        confirm: 'Type DELETE to confirm.',
      });
    }

    const existing = await reportsRepo.getReport(id);
    if (!existing || !canViewReport(principal, existing)) {
      throw new NotFoundError('That report no longer exists.');
    }
    if (!canPermanentlyDeleteReport(principal, existing, config.authz)) {
      return errorState(permanentDeleteRefusal(existing));
    }

    // The tombstone, the delete, and the audit event commit together: an
    // untraceable permanent deletion would defeat the accountability
    // requirement in the privacy notes.
    await withTransaction(async (client) => {
      const res = await client.query(
        `DELETE FROM protocol_reports WHERE id = $1 AND deleted_at IS NOT NULL
         RETURNING id, researcher_email, report_date, created_at, deleted_at`,
        [id],
      );
      const row = res.rows[0];
      if (!row) throw new NotFoundError('That report is not in the recycle bin.');

      await client.query(
        `INSERT INTO report_tombstones (report_id, researcher_email, report_date, created_at, deleted_at, permanently_deleted_by)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (report_id) DO NOTHING`,
        [row.id, row.researcher_email, row.report_date, row.created_at, row.deleted_at, principal.email],
      );

      await auditRequired(
        {
          actorEmail: principal.email,
          action: 'report.permanent_delete',
          targetType: 'protocol_report',
          targetId: id,
          metadata: {
            owner: row.researcher_email,
            reportDate: String(row.report_date),
            byAdmin: principal.role === 'admin',
          },
        },
        client,
      );
    });
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath('/reports/recycle-bin');
  revalidatePath('/admin/recycle-bin');
  return successState('Report permanently deleted.');
}

function duplicateMessage(existing: ProtocolReport): string {
  return existing.deletedAt
    ? 'You already have a report with this exact description for this date. It is in your recycle bin - restore it instead, or change the date or wording.'
    : 'You already have a report with this exact description for this date. Change the date or the wording, or open the existing report.';
}

function permanentDeleteRefusal(report: ProtocolReport): string {
  if (config.authz.permanentDeleteWaitDays > 0) {
    return `Recycled reports can only be permanently deleted after ${config.authz.permanentDeleteWaitDays} day(s) in the recycle bin.`;
  }
  return config.authz.allowResearcherPermanentDelete
    ? 'You can only permanently delete your own recycled reports.'
    : 'Permanent deletion is reserved for lab admins. Ask an admin if this report must be removed.';
}
