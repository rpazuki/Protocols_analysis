import { redirect } from 'next/navigation';
import { agreementsRepo } from '@protocols/db';
import {
  AGREEMENT_INTRO,
  AGREEMENT_SECTIONS,
  AGREEMENT_TITLE,
  AGREEMENT_VERSION,
} from '@protocols/domain';
import { requireSignedIn } from '../../server/auth/principal.ts';
import { safeReturnTo } from '../../server/auth/session.ts';
import { AgreementForm } from '../../components/AgreementForm.tsx';

/**
 * First-access gate. Every authenticated page routes here until the current
 * agreement version has been accepted (product-overview.md, "First Access").
 */
export default async function AgreementPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo, '/reports/new');

  const principal = await requireSignedIn('/agreement');
  const alreadyAccepted = await agreementsRepo.hasAcceptedCurrentAgreement(principal.email);
  if (alreadyAccepted) redirect(returnTo);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{AGREEMENT_TITLE}</h1>
          <p className="lede">{AGREEMENT_INTRO}</p>
        </div>
      </div>

      <div className="card">
        {AGREEMENT_SECTIONS.map((section) => (
          <section className="agreement-section" key={section.heading}>
            <h2 style={{ marginTop: 0 }}>{section.heading}</h2>
            <ul>
              {section.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>
        ))}

        <p className="cell-secondary">
          Agreement version {AGREEMENT_VERSION}. Accepting records your email address, this version
          number, and the time of acceptance.
        </p>
      </div>

      <AgreementForm returnTo={returnTo} email={principal.email} />
    </>
  );
}
