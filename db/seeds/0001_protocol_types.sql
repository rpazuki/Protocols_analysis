-- Development seed: protocol types.
-- Safe to re-run: label uniqueness is case-insensitive, so conflicts are skipped.
INSERT INTO protocol_types (label, description, active, sort_order) VALUES
  ('Cell culture',        'Culture conditions, media, passaging, and seeding variations.', true, 10),
  ('Transfection',        'Reagent, ratio, and timing variations for transfection.',       true, 20),
  ('Western blot',        'Antibody, blocking, transfer, and detection variations.',       true, 30),
  ('qPCR',                'Primer, cycling, and template variations.',                     true, 40),
  ('Flow cytometry',      'Staining panel, gating, and fixation variations.',              true, 50),
  ('Microscopy',          'Fixation, mounting, exposure, and objective variations.',       true, 60),
  ('Protein purification','Column, buffer, and elution variations.',                       true, 70),
  ('Cryopreservation',    'Freezing medium and rate variations.',                          false, 80),
  ('Other',               'Anything not covered by another type.',                         true, 999)
ON CONFLICT DO NOTHING;
