/**
 * First-access privacy and use agreement.
 *
 * Deliberately worded as an acknowledgement, not as UK GDPR consent: the
 * project sits in a university/employer context with a power imbalance, so
 * consent is unlikely to be the right lawful basis (docs/privacy-security/
 * gdpr-position.md). Imperial data protection reviewers sign off the final
 * wording before production.
 *
 * Bump AGREEMENT_VERSION whenever the wording changes materially. Users are
 * re-prompted for any version they have not accepted.
 */
export const AGREEMENT_VERSION = '2026-10-18.1';

export interface AgreementSection {
  heading: string;
  points: string[];
}

export const AGREEMENT_TITLE = 'Privacy and use agreement';

export const AGREEMENT_INTRO =
  'Before using Lab Protocols Analysis, please read how this app handles your Imperial email address and the text you enter. You must acknowledge this to continue.';

export const AGREEMENT_SECTIONS: AgreementSection[] = [
  {
    heading: 'What this app stores about you',
    points: [
      'Your authenticated email address is stored and used as your username in this app.',
      'In local email/password mode, the app stores a salted password hash, account status, and login security counters and timestamps. It never stores your plaintext password. SSO-only accounts need no local password.',
      'Your email address is attached to the protocol reports you create, to audit events for sensitive actions, to admin changes you make, and to data exports where relevant.',
    ],
  },
  {
    heading: 'What you should not type into reports',
    points: [
      'Do not enter patient-identifiable or participant-identifiable information.',
      'Do not enter personal data about other people that is not needed for the protocol record.',
      'Protocol descriptions and hypotheses are free text and are read by lab admins and by later analysis.',
    ],
  },
  {
    heading: 'Who can see your reports',
    points: [
      'Other researchers cannot see your reports.',
      'Lab admins can view all reports, including recycled ones, and can export them.',
      'Exports currently include raw email addresses, including yours.',
      'Exported records are intended for lab analysis of protocol success and failure patterns, including LLM-assisted analysis.',
    ],
  },
  {
    heading: 'Deleting reports',
    points: [
      'Deleting a report moves it to a recycle bin instead of destroying it immediately.',
      'A recycled report can be restored or permanently deleted by you or by a lab admin.',
      'Permanent deletion removes the report content from the application database. A minimal audit record of the deletion is retained for accountability.',
    ],
  },
  {
    heading: 'Still to be confirmed before production use',
    points: [
      'The lawful basis, the full Imperial privacy notice, the retention period, and the contact route for data protection questions will be provided before this app is used with real lab data.',
    ],
  },
];

export interface AgreementAcceptance {
  researcherEmail: string;
  agreementVersion: string;
  acceptedAt: string;
  acceptedFrom: string | null;
}

export function hasAcceptedCurrent(acceptances: Pick<AgreementAcceptance, 'agreementVersion'>[]): boolean {
  return acceptances.some((a) => a.agreementVersion === AGREEMENT_VERSION);
}
