import { query, type Queryable } from '../client.ts';
import { mapAgreement, type AgreementRow } from '../mappers.ts';
import { AGREEMENT_VERSION, normalizeEmail, type AgreementAcceptance } from '@protocols/domain';

export async function hasAcceptedCurrentAgreement(email: string, client?: Queryable): Promise<boolean> {
  const res = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM user_agreement_acceptances
        WHERE researcher_email = $1 AND agreement_version = $2
     ) AS exists`,
    [normalizeEmail(email), AGREEMENT_VERSION],
    client,
  );
  return res.rows[0]?.exists ?? false;
}

export async function recordAcceptance(
  email: string,
  acceptedFrom: string | null,
  client?: Queryable,
): Promise<AgreementAcceptance> {
  const res = await query<AgreementRow>(
    `INSERT INTO user_agreement_acceptances (researcher_email, agreement_version, accepted_from)
     VALUES ($1, $2, $3)
     ON CONFLICT (researcher_email, agreement_version) DO UPDATE
       SET accepted_at = user_agreement_acceptances.accepted_at
     RETURNING researcher_email, agreement_version, accepted_at, accepted_from`,
    [normalizeEmail(email), AGREEMENT_VERSION, acceptedFrom],
    client,
  );
  return mapAgreement(res.rows[0]!);
}

export async function listAcceptances(email: string, client?: Queryable): Promise<AgreementAcceptance[]> {
  const res = await query<AgreementRow>(
    `SELECT researcher_email, agreement_version, accepted_at, accepted_from
       FROM user_agreement_acceptances
      WHERE researcher_email = $1
      ORDER BY accepted_at DESC`,
    [normalizeEmail(email)],
    client,
  );
  return res.rows.map(mapAgreement);
}
