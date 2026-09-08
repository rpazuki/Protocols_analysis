-- Development seed: sample protocol reports for the mock personas.
-- DEVELOPMENT ONLY. Never run against an environment holding real lab data.
--
-- Covers the cases the UI and tests care about: an active report, a report by
-- a second researcher, a recycled report, and two reports that differ only by
-- date (allowed by the exact duplicate rule).

WITH t AS (
  SELECT id, label FROM protocol_types
)
INSERT INTO protocol_reports (
  report_date, researcher_email, protocol_type_id, protocol_type_label_snapshot,
  protocol_name, description_text, outcome, outcome_hypothesis, deleted_at, deleted_by
)
SELECT * FROM (VALUES
  (
    CURRENT_DATE - 3,
    'mock.researcher@ic.ac.uk',
    (SELECT id FROM t WHERE label = 'Transfection'),
    'Transfection',
    'Lipofectamine ratio 1:2',
    E'Seeded HEK293T at 70% confluence.\nUsed Lipofectamine 3000 at a 1:2 DNA:reagent ratio instead of the standard 1:3.\nHarvested at 48 h.',
    'failure',
    'Ratio was probably too low for this plasmid size; expression was very weak by 48 h.',
    NULL::timestamptz,
    NULL::text
  ),
  (
    CURRENT_DATE - 2,
    'mock.researcher@ic.ac.uk',
    (SELECT id FROM t WHERE label = 'Transfection'),
    'Transfection',
    'Lipofectamine ratio 1:3',
    E'Seeded HEK293T at 70% confluence.\nReturned to the standard 1:3 DNA:reagent ratio.\nHarvested at 48 h.',
    'success',
    'Standard ratio restored expression, so the 1:2 variation was the cause.',
    NULL::timestamptz,
    NULL::text
  ),
  (
    CURRENT_DATE - 1,
    'mock.researcher@ic.ac.uk',
    (SELECT id FROM t WHERE label = 'Western blot'),
    'Western blot',
    'Overnight primary at 4C',
    E'Blocked in 5% BSA rather than milk.\nPrimary antibody overnight at 4 degrees instead of 1 h at room temperature.',
    'success',
    NULL,
    NULL::timestamptz,
    NULL::text
  ),
  (
    CURRENT_DATE - 5,
    'mock.researcher@ic.ac.uk',
    (SELECT id FROM t WHERE label = 'qPCR'),
    'qPCR',
    'Annealing temperature sweep',
    E'Ran an annealing gradient from 58 to 64 degrees on the new primer pair.',
    'failure',
    'Recycled: this was a duplicate entry I made by mistake.',
    now() - interval '2 days',
    'mock.researcher@ic.ac.uk'
  ),
  (
    CURRENT_DATE - 1,
    'mock.colleague@ic.ac.uk',
    (SELECT id FROM t WHERE label = 'Cell culture'),
    'Cell culture',
    'Reduced FBS to 5%',
    E'Dropped FBS from 10% to 5% to test growth sensitivity.\nCounted at 72 h.',
    'failure',
    'Growth stalled; 5% is below the threshold for this line.',
    NULL::timestamptz,
    NULL::text
  )
) AS v
ON CONFLICT DO NOTHING;

INSERT INTO user_agreement_acceptances (researcher_email, agreement_version, accepted_from)
VALUES
  ('mock.researcher@ic.ac.uk', '2026-08-30.1', 'seed:development'),
  ('mock.admin@ic.ac.uk',      '2026-08-30.1', 'seed:development')
ON CONFLICT DO NOTHING;
