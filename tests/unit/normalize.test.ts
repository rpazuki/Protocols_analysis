import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDescription, normalizeEmail, normalizeLabel } from '@protocols/domain';

/**
 * The duplicate rule is exact, not fuzzy. These tests pin both halves: what
 * normalization must collapse (accidental whitespace) and what it must NOT
 * collapse (real wording differences).
 */
describe('normalizeDescription', () => {
  test('normalizes CRLF and CR line endings to LF', () => {
    assert.equal(normalizeDescription('a\r\nb\rc'), 'a\nb\nc');
  });

  test('trims leading and trailing whitespace', () => {
    assert.equal(normalizeDescription('  \n  step one  \n\n  '), 'step one');
  });

  test('strips trailing whitespace on each line', () => {
    assert.equal(normalizeDescription('one   \ntwo\t\nthree'), 'one\ntwo\nthree');
  });

  test('collapses repeated trailing blank lines', () => {
    assert.equal(normalizeDescription('body\n\n\n\n'), 'body');
  });

  test('treats whitespace-only variants of the same text as identical', () => {
    const a = normalizeDescription('Step one.\r\nStep two.  \r\n\r\n');
    const b = normalizeDescription('  Step one.\nStep two.');
    assert.equal(a, b);
  });

  test('does not lowercase', () => {
    assert.notEqual(normalizeDescription('Step One'), normalizeDescription('step one'));
  });

  test('does not collapse interior whitespace', () => {
    assert.notEqual(normalizeDescription('a  b'), normalizeDescription('a b'));
  });

  test('does not strip punctuation', () => {
    assert.notEqual(normalizeDescription('ratio 1:2'), normalizeDescription('ratio 12'));
  });

  test('keeps interior blank lines, which are meaningful paragraph breaks', () => {
    assert.equal(normalizeDescription('one\n\ntwo'), 'one\n\ntwo');
  });
});

describe('normalizeEmail', () => {
  test('lowercases and trims', () => {
    assert.equal(normalizeEmail('  Mock.Researcher@IC.AC.UK '), 'mock.researcher@ic.ac.uk');
  });

  test('leaves the local part otherwise untouched', () => {
    assert.equal(normalizeEmail('a.b+tag@ic.ac.uk'), 'a.b+tag@ic.ac.uk');
  });
});

describe('normalizeLabel', () => {
  test('collapses interior whitespace for short labels', () => {
    assert.equal(normalizeLabel('  Western   blot  '), 'Western blot');
  });
});
