const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const DOCXScan = require('../../chrome/content/docxScan.js');

// parsePandocLocator() takes the text after the comma in a pandoc citation
// (e.g. "p. 45" from [@smith, p. 45]) and splits it into a normalized
// locator string and any trailing suffix. It recognizes page, chapter,
// section, volume, and figure prefixes in both abbreviated and full forms.

describe('parsePandocLocator', () => {
    it('"p. 45" → locator "p. 45", no suffix', () => {
        const result = DOCXScan.parsePandocLocator('p. 45');
        assert.equal(result.locator, 'p. 45');
        assert.equal(result.suffix, '');
    });

    it('"pp. 45-50" → normalized to "p. 45-50" (singular prefix)', () => {
        const result = DOCXScan.parsePandocLocator('pp. 45-50');
        assert.equal(result.locator, 'p. 45-50');
        assert.equal(result.suffix, '');
    });

    it('"page 45" → normalized to "p. 45"', () => {
        const result = DOCXScan.parsePandocLocator('page 45');
        assert.equal(result.locator, 'p. 45');
        assert.equal(result.suffix, '');
    });

    it('"ch. 3" → locator "ch. 3"', () => {
        const result = DOCXScan.parsePandocLocator('ch. 3');
        assert.equal(result.locator, 'ch. 3');
        assert.equal(result.suffix, '');
    });

    it('"chapter 3" → normalized to "ch. 3"', () => {
        const result = DOCXScan.parsePandocLocator('chapter 3');
        assert.equal(result.locator, 'ch. 3');
        assert.equal(result.suffix, '');
    });

    it('"sec. 2" → locator "sec. 2"', () => {
        const result = DOCXScan.parsePandocLocator('sec. 2');
        assert.equal(result.locator, 'sec. 2');
        assert.equal(result.suffix, '');
    });

    it('"vol. 2" → locator "vol. 2"', () => {
        const result = DOCXScan.parsePandocLocator('vol. 2');
        assert.equal(result.locator, 'vol. 2');
        assert.equal(result.suffix, '');
    });

    it('"45" (bare digits) → treated as page number "p. 45"', () => {
        const result = DOCXScan.parsePandocLocator('45');
        assert.equal(result.locator, 'p. 45');
        assert.equal(result.suffix, '');
    });

    it('"p. 45 emphasis added" → locator "p. 45", suffix "emphasis added"', () => {
        const result = DOCXScan.parsePandocLocator('p. 45 emphasis added');
        assert.equal(result.locator, 'p. 45');
        assert.equal(result.suffix, 'emphasis added');
    });

    it('"emphasis added" (no locator prefix) → no locator, suffix only', () => {
        const result = DOCXScan.parsePandocLocator('emphasis added');
        assert.equal(result.locator, '');
        assert.equal(result.suffix, 'emphasis added');
    });

    it('"p. 45\u201350" → handles en-dash in page range', () => {
        const result = DOCXScan.parsePandocLocator('p. 45\u201350');
        assert.equal(result.locator, 'p. 45\u201350');
        assert.equal(result.suffix, '');
    });
});
