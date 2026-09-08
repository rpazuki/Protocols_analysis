import { OUTCOMES, OUTCOME_LABELS, type ProtocolType } from '@protocols/domain';
import { appPath } from '../lib/paths.ts';

export interface FilterValues {
  from?: string;
  to?: string;
  protocolTypeId?: string;
  researcherEmail?: string;
  outcome?: string;
  q?: string;
  state?: string;
}

/**
 * A plain GET form, so filters live in the URL and a filtered view can be
 * bookmarked or pasted to a colleague.
 */
export function ReportFilters({
  action,
  values,
  protocolTypes,
  researcherEmails,
  showState = false,
}: {
  action: string;
  values: FilterValues;
  protocolTypes: ProtocolType[];
  researcherEmails?: string[];
  showState?: boolean;
}) {
  return (
    <form className="filters" method="get" action={appPath(action)}>
      <div className="grid-3">
        <div className="field">
          <label htmlFor="f-from">From date</label>
          <input id="f-from" name="from" type="date" defaultValue={values.from ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="f-to">To date</label>
          <input id="f-to" name="to" type="date" defaultValue={values.to ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="f-type">Protocol type</label>
          <select id="f-type" name="protocolTypeId" defaultValue={values.protocolTypeId ?? ''}>
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
          <label htmlFor="f-outcome">Outcome</label>
          <select id="f-outcome" name="outcome" defaultValue={values.outcome ?? ''}>
            <option value="">Any outcome</option>
            {OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {OUTCOME_LABELS[outcome]}
              </option>
            ))}
          </select>
        </div>

        {researcherEmails ? (
          <div className="field">
            <label htmlFor="f-researcher">Researcher</label>
            <select id="f-researcher" name="researcherEmail" defaultValue={values.researcherEmail ?? ''}>
              <option value="">All researchers</option>
              {researcherEmails.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {showState ? (
          <div className="field">
            <label htmlFor="f-state">Records</label>
            <select id="f-state" name="state" defaultValue={values.state ?? 'active'}>
              <option value="active">Active only</option>
              <option value="recycled">Recycle bin only</option>
              <option value="all">Active and recycled</option>
            </select>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="f-q">Search text</label>
          <input
            id="f-q"
            name="q"
            type="search"
            defaultValue={values.q ?? ''}
            placeholder="name, description, hypothesis"
          />
        </div>
      </div>

      <div className="row row--end" style={{ paddingBottom: '1rem' }}>
        <a className="btn" href={appPath(action)}>
          Clear
        </a>
        <button className="btn btn--primary" type="submit">
          Apply filters
        </button>
      </div>
    </form>
  );
}
