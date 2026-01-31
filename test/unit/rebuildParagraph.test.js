const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const DOCXScan = require('../../chrome/content/docxScan.js');

// rebuildParagraph() takes the original paragraph XML and a (possibly
// modified) array of text runs from extractTextRuns(), and produces
// new XML with the changes applied. Runs can have their .text changed,
// or be marked with .remove = true to delete them entirely.

describe('rebuildParagraph', () => {
    it('unmodified runs → returns identical XML', () => {
        const xml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
        const runs = DOCXScan.extractTextRuns(xml);
        const result = DOCXScan.rebuildParagraph(xml, runs);
        assert.equal(result, xml);
    });

    it('run.text changed from "Hello" to "Goodbye" → output contains "Goodbye"', () => {
        const xml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
        const runs = DOCXScan.extractTextRuns(xml);
        runs[0].text = 'Goodbye';
        const result = DOCXScan.rebuildParagraph(xml, runs);
        assert.ok(result.includes('Goodbye'));
        assert.ok(!result.includes('Hello'));
    });

    it('run.remove = true → that run is deleted from output', () => {
        const xml = '<w:p><w:r><w:t>Keep</w:t></w:r><w:r><w:t>Remove</w:t></w:r></w:p>';
        const runs = DOCXScan.extractTextRuns(xml);
        runs[1].remove = true;
        const result = DOCXScan.rebuildParagraph(xml, runs);
        assert.ok(result.includes('Keep'));
        assert.ok(!result.includes('Remove'));
    });

    it('text with spaces → adds xml:space="preserve" attribute', () => {
        const xml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
        const runs = DOCXScan.extractTextRuns(xml);
        runs[0].text = ' spaced ';
        const result = DOCXScan.rebuildParagraph(xml, runs);
        assert.ok(result.includes('xml:space="preserve"'));
        assert.ok(result.includes(' spaced '));
    });
});
