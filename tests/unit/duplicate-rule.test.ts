import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateKey, isSameDuplicateKey } from '@protocols/domain';

/**
 * The rule from product-overview.md: same researcher + same report date +
 * same normalized description. Protocol name, type, outcome, and hypothesis
 * are explicitly outside the comparison.
 */
const base = {
  researcherEmail: 'mock.researcher@ic.ac.uk',
  reportDate: '2026-08-30',
  descriptionText: 'Swapped reagent A for reagent B.',
};

describe('exact duplicate key', () => {
  test('identical submissions collide', () => {
    assert.ok(isSameDuplicateKey(duplicateKey(base), duplicateKey({ ...base })));
  });

  test('whitespace-only differences still collide', () => {
    const a = duplicateKey(base);
    const b = duplicateKey({ ...base, descriptionText: '  Swapped reagent A for reagent B.  \r\n' });
    assert.ok(isSameDuplicateKey(a, b));
  });

  test('a different date is allowed', () => {
    const a = duplicateKey(base);
    const b = duplicateKey({ ...base, reportDate: '2026-08-31' });
    assert.ok(!isSameDuplicateKey(a, b));
  });

  test('a different researcher is allowed', () => {
    const a = duplicateKey(base);
    const b = duplicateKey({ ...base, researcherEmail: 'other.person@ic.ac.uk' });
    assert.ok(!isSameDuplicateKey(a, b));
  });

  test('different wording is allowed', () => {
    const a = duplicateKey(base);
    const b = duplicateKey({ ...base, descriptionText: 'Swapped reagent A for reagent C.' });
    assert.ok(!isSameDuplicateKey(a, b));
  });

  test('email case does not create a second identity', () => {
    const a = duplicateKey(base);
    const b = duplicateKey({ ...base, researcherEmail: 'Mock.Researcher@IC.AC.UK' });
    assert.ok(isSameDuplicateKey(a, b));
  });
});
