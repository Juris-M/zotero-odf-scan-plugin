const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const DOCXScan = require('../../chrome/content/docxScan.js');

// escapeXml() converts special characters to XML entities so that
// arbitrary text (like JSON or user-entered citations) can be safely
// embedded inside XML elements without breaking the document structure.

describe('escapeXml', () => {
    it('"A & B" → "A &amp; B"', () => {
        assert.equal(DOCXScan.escapeXml('A & B'), 'A &amp; B');
    });

    it('"<div>" → "&lt;div&gt;"', () => {
        assert.equal(DOCXScan.escapeXml('<div>'), '&lt;div&gt;');
    });

    it('double quotes → &quot;', () => {
        assert.equal(DOCXScan.escapeXml('say "hello"'), 'say &quot;hello&quot;');
    });

    it("single quotes → &apos;", () => {
        assert.equal(DOCXScan.escapeXml("it's"), "it&apos;s");
    });

    it('escapes all five XML entities in a single string', () => {
        assert.equal(
            DOCXScan.escapeXml('<a href="x">&'),
            '&lt;a href=&quot;x&quot;&gt;&amp;'
        );
    });

    it('returns empty string unchanged', () => {
        assert.equal(DOCXScan.escapeXml(''), '');
    });
});
