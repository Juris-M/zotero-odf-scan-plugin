const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const DOCXScan = require('../../chrome/content/docxScan.js');

// extractTextRuns() parses a Word XML paragraph (<w:p>) and returns an
// array of text run objects. Each run has { text, originalText, remove }
// representing a <w:r><w:t>...</w:t></w:r> element. This is the first
// step in scanning a paragraph for citations — later functions modify
// the runs and rebuildParagraph() writes them back to XML.

describe('extractTextRuns', () => {
    it('<w:r><w:t>Hello</w:t></w:r> → one run with text "Hello"', () => {
        const xml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
        const runs = DOCXScan.extractTextRuns(xml);
        assert.equal(runs.length, 1);
        assert.equal(runs[0].text, 'Hello');
        assert.equal(runs[0].originalText, 'Hello');
        assert.equal(runs[0].remove, false);
    });

    it('two <w:r> elements → two runs in order', () => {
        const xml = '<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>';
        const runs = DOCXScan.extractTextRuns(xml);
        assert.equal(runs.length, 2);
        assert.equal(runs[0].text, 'Hello ');
        assert.equal(runs[1].text, 'world');
    });

    it('run with <w:rPr><w:b/></w:rPr> formatting → text still extracted', () => {
        const xml = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold text</w:t></w:r></w:p>';
        const runs = DOCXScan.extractTextRuns(xml);
        assert.equal(runs.length, 1);
        assert.equal(runs[0].text, 'bold text');
    });

    it('xml:space="preserve" → leading/trailing spaces kept', () => {
        const xml = '<w:p><w:r><w:t xml:space="preserve"> hello </w:t></w:r></w:p>';
        const runs = DOCXScan.extractTextRuns(xml);
        assert.equal(runs.length, 1);
        assert.equal(runs[0].text, ' hello ');
    });

    it('paragraph with only <w:pPr> (no text runs) → empty array', () => {
        const xml = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>';
        const runs = DOCXScan.extractTextRuns(xml);
        assert.equal(runs.length, 0);
    });
});
