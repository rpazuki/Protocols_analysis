/**
 * Normalization rules shared by the app server, the database, and the tests.
 *
 * The duplicate rule is intentionally exact, not fuzzy (product-overview.md,
 * "Exact Duplicate Rule"). Normalization exists only to avoid accidental
 * whitespace-only duplicates.
 */

/**
 * Minimal normalization for the main protocol description used by the exact
 * duplicate check:
 *
 * - normalize line endings to \n;
 * - trim leading and trailing whitespace;
 * - collapse repeated trailing blank lines (covered by the trim above);
 * - strip trailing whitespace on each line, so an invisible trailing space
 *   cannot be used to sneak an "identical" report past the check.
 *
 * It deliberately does NOT lowercase, strip punctuation, or collapse interior
 * whitespace: different wording must stay a different report.
 */
export function normalizeDescription(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

/**
 * Normalizes an email address for use as the app username / allowlist key.
 * Lowercased and trimmed only; the local part is not otherwise rewritten
 * because we must be able to hand the exact stored value back to ICT support.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Trims and collapses interior runs of whitespace. For short single-line labels. */
export function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Normalizes free text that is stored (not just compared): line endings + trim. */
export function normalizeFreeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}
