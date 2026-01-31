/**
 * Zotero API mock for testing DOCXScanConvert functions
 * that depend on Zotero.Search, Zotero.Items, etc.
 */

function createMockItem({ key, id, citationKey, firstCreator, title, year, libraryID }) {
    return {
        key,
        id: id || Math.floor(Math.random() * 10000),
        libraryID: libraryID || 1,
        citationKey,
        getField(field) {
            const fields = { firstCreator, title, year, date: year };
            if (field in fields) return fields[field] || '';
            return '';
        }
    };
}

function createZoteroMock(options = {}) {
    const items = options.items || {}; // Map of key -> mock item

    return {
        debug() {},

        Libraries: {
            userLibraryID: 1,
            get() {
                return { libraryType: 'user' };
            }
        },

        Users: {
            getCurrentUserID() { return null; },
            getLocalUserKey() { return 'testLocalKey'; }
        },

        Groups: {
            getGroupIDFromLibraryID() { return '99'; },
            getLibraryIDFromGroupID() { return 2; }
        },

        Items: {
            async getByLibraryAndKeyAsync(libraryID, key) {
                return items[key] || null;
            },
            async getAsync(id) {
                return Object.values(items).find(i => i.id === id) || null;
            }
        },

        Search: class {
            constructor() {
                this.conditions = [];
                this.libraryID = null;
            }
            addCondition(field, op, value) {
                this.conditions.push({ field, op, value });
            }
            async search() {
                const cond = this.conditions.find(c => c.field === 'citationKey');
                if (!cond) return [];
                const found = Object.values(items).find(i => i.citationKey === cond.value);
                return found ? [found.id] : [];
            }
        }
    };
}

module.exports = { createZoteroMock, createMockItem };
