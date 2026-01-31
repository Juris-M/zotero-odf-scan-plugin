const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createZoteroMock, createMockItem } = require('../helpers/zotero-mock.js');

// getItemByURI() resolves a Zotero item URI to the actual item object.
// Zotero has used several URI formats across versions:
//   - zu:0:KEY               (short form used in scannable cite markers)
//   - http://zotero.org/users/local/.../items/KEY  (local library)
//   - http://zotero.org/users/USERID/items/KEY     (synced library)
//   - zotero://select/library/items/KEY            (older Zotero select)
//   - zotero://select/items/0_KEY                  (library prefix form)
//   - zotero://select/groups/GROUPID/items/KEY     (group library)
// All of these need to work so the plugin can handle documents created
// with any Zotero version.

describe('getItemByURI', () => {
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

        global.Zotero = createZoteroMock({ items: { SMITH2020: smith } });
        delete require.cache[require.resolve('../../chrome/content/docxScan.js')];
        DOCXScan = require('../../chrome/content/docxScan.js');
    });

    it('"zu:0:SMITH2020" → resolves item (short form)', async () => {
        const item = await DOCXScan.getItemByURI('zu:0:SMITH2020');
        assert.ok(item);
        assert.equal(item.key, 'SMITH2020');
    });

    it('"http://zotero.org/users/local/testKey/items/SMITH2020" → resolves item', async () => {
        const item = await DOCXScan.getItemByURI('http://zotero.org/users/local/testKey/items/SMITH2020');
        assert.ok(item);
        assert.equal(item.key, 'SMITH2020');
    });

    it('"http://zotero.org/users/12345/items/SMITH2020" → resolves item (synced user)', async () => {
        const item = await DOCXScan.getItemByURI('http://zotero.org/users/12345/items/SMITH2020');
        assert.ok(item);
        assert.equal(item.key, 'SMITH2020');
    });

    it('"zotero://select/library/items/SMITH2020" → resolves item (old select URI)', async () => {
        const item = await DOCXScan.getItemByURI('zotero://select/library/items/SMITH2020');
        assert.ok(item);
        assert.equal(item.key, 'SMITH2020');
    });

    it('"zotero://select/items/0_SMITH2020" → resolves item (library prefix form)', async () => {
        const item = await DOCXScan.getItemByURI('zotero://select/items/0_SMITH2020');
        assert.ok(item);
        assert.equal(item.key, 'SMITH2020');
    });

    it('"zotero://select/groups/32807/items/SMITH2020" → resolves item (group library)', async () => {
        const item = await DOCXScan.getItemByURI('zotero://select/groups/32807/items/SMITH2020');
        assert.ok(item);
        assert.equal(item.key, 'SMITH2020');
    });

    it('"ftp://something/weird" → returns null (unrecognized format)', async () => {
        const item = await DOCXScan.getItemByURI('ftp://something/weird');
        assert.equal(item, null);
    });

    it('"zu:0:NONEXISTENT" → returns null (item not in library)', async () => {
        const item = await DOCXScan.getItemByURI('zu:0:NONEXISTENT');
        assert.equal(item, null);
    });
});
