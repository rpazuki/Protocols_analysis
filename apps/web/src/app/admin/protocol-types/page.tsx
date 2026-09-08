import { protocolTypesRepo } from '@protocols/db';
import { requireAdmin } from '../../../server/auth/principal.ts';
import {
  CreateProtocolTypeForm,
  EditProtocolTypeCard,
} from '../../../components/ProtocolTypeForms.tsx';
import { Notice } from '../../../components/Notice.tsx';

export default async function ProtocolTypesPage() {
  await requireAdmin('/admin/protocol-types');

  const types = await protocolTypesRepo.listProtocolTypes({ includeInactive: true });
  const counts = await Promise.all(
    types.map(async (type) => [type.id, await protocolTypesRepo.countReportsForType(type.id)] as const),
  );
  const countById = new Map(counts);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Protocol types</h1>
          <p className="lede">
            The dropdown researchers pick from. Disable a type to retire it without affecting
            reports that already use it.
          </p>
        </div>
      </div>

      <Notice kind="info" title="Renaming is safe.">
        Each report stores the type label as it was when the report was saved, so historic
        submissions keep reading correctly after a rename. Disabled types stay visible on the
        reports that already use them.
      </Notice>

      <CreateProtocolTypeForm />

      <h2>Current types ({types.length})</h2>

      {types.length === 0 ? (
        <div className="table-wrap">
          <p className="empty-state">
            No protocol types yet. Add one above so researchers can save reports.
          </p>
        </div>
      ) : (
        <div className="stack">
          {types.map((type) => (
            <EditProtocolTypeCard
              key={type.id}
              type={type}
              reportCount={countById.get(type.id) ?? 0}
            />
          ))}
        </div>
      )}
    </>
  );
}
