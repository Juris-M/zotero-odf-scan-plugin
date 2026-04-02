const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createZoteroMock, createMockItem } = require('../helpers/zotero-mock.js');

// markersToPandoc() converts pipe-separated scannable cite markers into
// pandoc citation syntax. This is used for the ODF→pandoc flow, where
// ODF citations are first converted to markers (via rtfScan.js), then
// this function converts the markers to pandoc syntax.
//
// Marker format: { prefix | Author, Title (Year) | locator | suffix | uri }
// Output examples:
//   { | Smith, Title (2020) | | | uri }          → [@smith2020]
//   { | Smith, Title (2020) | p. 45 | | uri }    → [@smith2020, p. 45]
//   { | -Smith, Title (2020) | | | uri }          → [-@smith2020]
//   { see | Smith, Title (2020) | | | uri }       → [see @smith2020]

describe('markersToPandoc', () => {
    let DOCXScan;

    beforeEach(() => {
        const smith = createMockItem({
            key: 'SMITH2020',
            id: 1,
            citationKey: 'smith2020',
            firstCreator: 'Smith',
            title: 'A Great Paper',
            year: '2020'
        });
        const jones = createMockItem({
            key: 'JONES2019',
            id: 2,
            citationKey: 'jones2019',
            firstCreator: 'Jones',
            title: 'Another Paper',
            year: '2019'
        });

        global.Zotero = createZoteroMock({
            items: { SMITH2020: smith, JONES2019: jones }
        });
        delete require.cache[require.resolve('../../chrome/content/docxScan.js')];
        DOCXScan = require('../../chrome/content/docxScan.js');
    });

    it('basic marker → [@smith2020]', async () => {
        const input = '{ | Smith, A Great Paper (2020) | | | http://zotero.org/users/local/testKey/items/SMITH2020}';
        const result = await DOCXScan.markersToPandoc(input);
        assert.equal(result, '[@smith2020]');
    });

    it('marker with locator "p. 45" → [@smith2020, p. 45]', async () => {
        const input = '{ | Smith, A Great Paper (2020) | p. 45 | | http://zotero.org/users/local/testKey/items/SMITH2020}';
        const result = await DOCXScan.markersToPandoc(input);
        assert.equal(result, '[@smith2020, p. 45]');
    });

    it('marker with suppress-author (leading dash) → [-@smith2020]', async () => {
        const input = '{ | -Smith, A Great Paper (2020) | | | http://zotero.org/users/local/testKey/items/SMITH2020}';
        const result = await DOCXScan.markersToPandoc(input);
        assert.equal(result, '[-@smith2020]');
    });

    it('marker with prefix "see" → [see @smith2020]', async () => {
        const input = '{ see | Smith, A Great Paper (2020) | | | http://zotero.org/users/local/testKey/items/SMITH2020}';
        const result = await DOCXScan.markersToPandoc(input);
        assert.equal(result, '[see @smith2020]');
    });

    it('marker with zotero://select/library/items/KEY URI → [@smith2020]', async () => {
        // Tests the older zotero://select URI format
        const input = '{ | Smith, A Great Paper (2020) | | | zotero://select/library/items/SMITH2020}';
        const result = await DOCXScan.markersToPandoc(input);
        assert.equal(result, '[@smith2020]');
    });

    it('marker with zotero://select/items/0_KEY URI → [@smith2020]', async () => {
        // Tests the library-prefix form of zotero://select URIs
        const input = '{ | Smith, A Great Paper (2020) | | | zotero://select/items/0_SMITH2020}';
        const result = await DOCXScan.markersToPandoc(input);
        assert.equal(result, '[@smith2020]');
    });

    it('marker with locator + suffix → [@smith2020, p. 33, quoting Jones]', async () => {
        const input = '{ | Smith, A Great Paper (2020) | p. 33 | quoting Jones | http://zotero.org/users/local/testKey/items/SMITH2020}';
        const result = await DOCXScan.markersToPandoc(input);
        assert.equal(result, '[@smith2020, p. 33, quoting Jones]');
    });

    it('two adjacent markers (ODF multi-cite) → single [@smith2020; @jones2019]', async () => {
        // rtfScan.js produces adjacent markers for multi-item citations.
        // They should be merged into one pandoc group, not two separate brackets.
        const input =
            '{ | (Smith, 2020; Jones, 2019) | | | http://zotero.org/users/local/testKey/items/SMITH2020}' +
            '{ | (Smith, 2020; Jones, 2019) | | | http://zotero.org/users/local/testKey/items/JONES2019}';
        const result = await DOCXScan.markersToPandoc(input);
        assert.equal(result, '[@smith2020; @jones2019]');
    });

    it('two adjacent markers with locators → single group with both locators', async () => {
        const input =
            '{ | (Smith, 2020; Jones, 2019) | p. 45 | | http://zotero.org/users/local/testKey/items/SMITH2020}' +
            '{ | (Smith, 2020; Jones, 2019) | ch. 3 | | http://zotero.org/users/local/testKey/items/JONES2019}';
        const result = await DOCXScan.markersToPandoc(input);
        assert.equal(result, '[@smith2020, p. 45; @jones2019, ch. 3]');
    });

    it('non-adjacent markers → separate pandoc cites', async () => {
        // Markers separated by text are distinct citations, not the same group.
        const input =
            '{ | Smith (2020) | | | http://zotero.org/users/local/testKey/items/SMITH2020}' +
            ' and ' +
            '{ | Jones (2019) | | | http://zotero.org/users/local/testKey/items/JONES2019}';
        const result = await DOCXScan.markersToPandoc(input);
        assert.equal(result, '[@smith2020] and [@jones2019]');
    });
});
