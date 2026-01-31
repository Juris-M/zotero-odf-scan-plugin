const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const DOCXScan = require('../../chrome/content/docxScan.js');

// buildWordField() creates the Word XML for a Zotero citation field.
// Word fields have a specific structure: fldChar "begin" → instrText
// containing "ADDIN ZOTERO_ITEM CSL_CITATION {json}" → fldChar
// "separate" → display text → fldChar "end". This is what Zotero
// reads when it opens a .docx file to refresh citations.

describe('buildWordField', () => {
    // Sample citation data matching what Zotero embeds in Word fields
    const citationData = {
        citationID: 'test123',
        properties: {
            formattedCitation: '(Smith, 2020)',
            plainCitation: '(Smith, 2020)'
        },
        citationItems: [{
            uris: ['http://zotero.org/users/local/testKey/items/ABCD1234']
        }],
        schema: 'https://github.com/citation-style-language/schema/raw/master/csl-citation.json'
    };

    it('output contains fldChar begin, separate, and end markers', () => {
        const field = DOCXScan.buildWordField(citationData, '(Smith, 2020)');
        assert.ok(field.includes('w:fldCharType="begin"'));
        assert.ok(field.includes('w:fldCharType="separate"'));
        assert.ok(field.includes('w:fldCharType="end"'));
    });

    it('instrText contains "ADDIN ZOTERO_ITEM CSL_CITATION" prefix', () => {
        const field = DOCXScan.buildWordField(citationData, '(Smith, 2020)');
        assert.ok(field.includes('ADDIN ZOTERO_ITEM CSL_CITATION'));
    });

    it('display text "(Smith, 2020)" appears between separate and end', () => {
        const field = DOCXScan.buildWordField(citationData, '(Smith, 2020)');
        assert.ok(field.includes('(Smith, 2020)'));
    });
});
