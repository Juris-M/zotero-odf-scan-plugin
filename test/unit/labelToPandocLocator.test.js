const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const DOCXScan = require('../../chrome/content/docxScan.js');

// labelToPandocLocator() maps CSL locator labels (used internally by
// Zotero) to pandoc's abbreviated locator prefixes. For example,
// Zotero stores label "page" in its citation JSON, and pandoc uses
// "p. " in citation syntax like [@smith, p. 45].

describe('labelToPandocLocator', () => {
    it('"page" → "p. "', () => {
        assert.equal(DOCXScan.labelToPandocLocator('page'), 'p. ');
    });

    it('"chapter" → "ch. "', () => {
        assert.equal(DOCXScan.labelToPandocLocator('chapter'), 'ch. ');
    });

    it('"section" → "sec. "', () => {
        assert.equal(DOCXScan.labelToPandocLocator('section'), 'sec. ');
    });

    it('"volume" → "vol. "', () => {
        assert.equal(DOCXScan.labelToPandocLocator('volume'), 'vol. ');
    });

    it('"figure" → "fig. "', () => {
        assert.equal(DOCXScan.labelToPandocLocator('figure'), 'fig. ');
    });

    it('"unknown" (unrecognized label) → defaults to "p. "', () => {
        assert.equal(DOCXScan.labelToPandocLocator('unknown'), 'p. ');
    });
});
