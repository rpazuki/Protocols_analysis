'use server';

import { revalidatePath } from 'next/cache';
import { isUniqueViolation, protocolTypesRepo, withTransaction } from '@protocols/db';
import { DomainError, protocolTypeInputSchema, protocolTypeUpdateSchema } from '@protocols/domain';
import { auditRequired } from '../audit.ts';
import { requireAdminForAction } from '../auth/principal.ts';
import { errorState, successState, toFormState, type FormState } from './form-state.ts';

/**
 * Protocol type management. Each change commits with its audit event, so a
 * rename or a disable cannot land without a record of who made it.
 */

export async function createProtocolTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const principal = await requireAdminForAction();
    const input = protocolTypeInputSchema.parse({
      label: String(formData.get('label') ?? ''),
      description: String(formData.get('description') ?? ''),
      active: formData.get('active') !== null,
      sortOrder: String(formData.get('sortOrder') ?? '0'),
    });

    const type = await withTransaction(async (client) => {
      const created = await protocolTypesRepo.createProtocolType(input, client);
      await auditRequired(
        {
          actorEmail: principal.email,
          action: 'protocol_type.create',
          targetType: 'protocol_type',
          targetId: created.id,
          metadata: { label: created.label, active: created.active },
        },
        client,
      );
      return created;
    });

    revalidatePath('/admin/protocol-types');
    revalidatePath('/reports/new');
    return successState(`Protocol type "${type.label}" created.`);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return errorState('A protocol type with that label already exists.', {
        label: 'This label is already in use.',
      });
    }
    return toFormState(err);
  }
}

/**
 * Renaming a type does not touch existing reports: they keep the label
 * snapshot taken when they were saved (product-overview.md, "Protocol Type
 * Management" step 3).
 */
export async function updateProtocolTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  try {
    const principal = await requireAdminForAction();
    const before = await protocolTypesRepo.getProtocolType(id);
    if (!before) throw new DomainError('not_found', 'That protocol type no longer exists.');

    const input = protocolTypeUpdateSchema.parse({
      label: String(formData.get('label') ?? ''),
      description: String(formData.get('description') ?? ''),
      active: formData.get('active') !== null,
      sortOrder: String(formData.get('sortOrder') ?? String(before.sortOrder)),
    });

    const after = await withTransaction(async (client) => {
      const updated = await protocolTypesRepo.updateProtocolType(id, input, client);
      if (!updated) throw new DomainError('not_found', 'That protocol type no longer exists.');

      await auditRequired(
        {
          actorEmail: principal.email,
          action: 'protocol_type.update',
          targetType: 'protocol_type',
          targetId: id,
          metadata: {
            labelBefore: before.label,
            labelAfter: updated.label,
            activeBefore: before.active,
            activeAfter: updated.active,
          },
        },
        client,
      );
      return updated;
    });

    revalidatePath('/admin/protocol-types');
    revalidatePath('/reports/new');
    return successState(
      before.label !== after.label
        ? `Renamed to "${after.label}". Existing reports keep the label they were saved with.`
        : `Protocol type "${after.label}" updated.`,
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      return errorState('A protocol type with that label already exists.', {
        label: 'This label is already in use.',
      });
    }
    return toFormState(err);
  }
}
