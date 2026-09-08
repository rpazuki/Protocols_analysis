import { protocolTypesRepo, reportsRepo } from '@protocols/db';
import { EXPORT_FIELDS, EXPORT_SCHEMA_VERSION, OUTCOMES, OUTCOME_LABELS } from '@protocols/domain';
import { requireAdmin } from '../../../server/auth/principal.ts';
import { Notice } from '../../../components/Notice.tsx';
import { appPath } from '../../../lib/paths.ts';

/**
 * Export builder.
 *
 * The form POSTs to /admin/export/download, which checks the request origin,
 * audits, and streams the file. It is deliberately not a GET: an export
 * releases raw email addresses and the full text of every matching report, and
 * a GET can be triggered by a link, a prefetch, an image tag, or a pasted URL,
 * none of which an admin meant as "release the lab record". The cost is that
 * the filters no longer survive in a shareable URL, which is the right trade
 * for this particular payload.
 */
export default async function ExportPage() {
  await requireAdmin('/admin/export');

  const [protocolTypes, researcherEmails] = await Promise.all([
    protocolTypesRepo.listProtocolTypes({ includeInactive: true }),
    reportsRepo.listResearcherEmails(),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Export reports</h1>
          <p className="lede">
            CSV for spreadsheet review, JSONL for LLM and batch-analysis pipelines. Schema version{' '}
            {EXPORT_SCHEMA_VERSION}.
          </p>
        </div>
      </div>

      <Notice kind="warning" title="Exports contain raw email addresses.">
        Every exported record includes the researcher&rsquo;s Imperial email address, which is
        personal data. Keep export files inside lab-controlled storage, delete them when the
        analysis is finished, and talk to the lab and Imperial data protection contacts before
        sharing them outside the lab. Every export is recorded in the audit log against your
        account, and an export that cannot be recorded is refused. Downloads are produced only by
        submitting this form, so a shared or bookmarked link cannot release lab data on its own.
      </Notice>

      <form className="card" method="post" action={appPath('/admin/export/download')}>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="e-format">Format</label>
            <select id="e-format" name="format" defaultValue="csv">
              <option value="csv">CSV (spreadsheet)</option>
              <option value="jsonl">JSONL (one JSON object per line)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="e-from">From date</label>
            <input id="e-from" name="from" type="date" />
          </div>
          <div className="field">
            <label htmlFor="e-to">To date</label>
            <input id="e-to" name="to" type="date" />
          </div>
          <div className="field">
            <label htmlFor="e-researcher">Researcher</label>
            <select id="e-researcher" name="researcherEmail" defaultValue="">
              <option value="">All researchers</option>
              {researcherEmails.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="e-type">Protocol type</label>
            <select id="e-type" name="protocolTypeId" defaultValue="">
              <option value="">All types</option>
              {protocolTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                  {type.active ? '' : ' (disabled)'}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="e-outcome">Outcome</label>
            <select id="e-outcome" name="outcome" defaultValue="">
              <option value="">Any outcome</option>
              {OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {OUTCOME_LABELS[outcome]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="e-q">Text search (optional)</label>
          <input id="e-q" name="q" type="search" placeholder="name, description, hypothesis" />
        </div>

        <div className="checkbox-row field">
          <input id="e-recycled" name="includeRecycled" type="checkbox" value="true" />
          <label htmlFor="e-recycled">
            Include recycle-bin records
            <span className="hint" style={{ display: 'block' }}>
              Excluded by default. Recycled reports were deleted by their researcher, so include
              them only when the analysis needs them. Permanently deleted reports are never
              exported - their content no longer exists.
            </span>
          </label>
        </div>

        <div className="row row--end">
          <button className="btn btn--primary" type="submit">
            Download export
          </button>
        </div>
      </form>

      <h2>Fields in every record</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Field</th>
            </tr>
          </thead>
          <tbody>
            {EXPORT_FIELDS.map((field) => (
              <tr key={field}>
                <td>
                  <code>{field}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
