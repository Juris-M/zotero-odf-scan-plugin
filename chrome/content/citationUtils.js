/*
    ***** BEGIN LICENSE BLOCK *****

    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org

    This file is part of Zotero.

    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.

    ***** END LICENSE BLOCK *****
*/

/**
 * @fileOverview Format-agnostic citation utilities shared between ODF and DOCX converters.
 *
 * Includes:
 *   - Pandoc citation syntax parsing (parsePandocCitationGroup, parsePandocLocator)
 *   - Locator label mapping (labelToPandocLocator)
 *   - Zotero item lookup (findItemByCitationKey, getItemByURI)
 *   - URI construction and conversion (buildItemURI, buildItemURIShort, httpURIToShort)
 *   - XML escaping (escapeXml)
 *   - Text-based marker ↔ pandoc converters used by the ODF pandoc flows:
 *       pandocToMarkersText  — pandoc plain text → scannable cite markers
 *       markersToPandoc      — scannable cite markers → pandoc plain text
 *
 * Exported as window.CitationUtils in Zotero (via loadSubScript) and as
 * module.exports in Node.js (for unit tests).
 */

var CitationUtils = {

    log(msg) {
        Zotero.debug("CitationUtils: " + msg);
    },

    /**
     * Convert a CSL locator label to pandoc locator prefix
     */
    labelToPandocLocator(label) {
        const map = {
            'page': 'p. ',
            'chapter': 'ch. ',
            'section': 'sec. ',
            'volume': 'vol. ',
            'number': 'no. ',
            'paragraph': 'para. ',
            'figure': 'fig. ',
            'line': 'l. ',
            'note': 'n. ',
            'article': 'art. '
        };
        return map[label] || 'p. ';
    },

    /**
     * Convert scannable cite markers to pandoc citation syntax.
     * Marker format: { prefix | cite | locator | suffix | uri }
     * Adjacent markers (same-citation multi-item groups) are merged into one
     * [@key1; @key2] bracket.
     */
    async markersToPandoc(content) {
        CitationUtils.log("Converting markers to pandoc syntax");

        const markerRegex = /\{\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|}]*?)\s*\}/g;
        const allMatches = [];
        let match;

        // Collect all matches with item lookups
        while ((match = markerRegex.exec(content)) !== null) {
            const [fullMatch, prefix, cite, locator, suffix, uri] = match;

            const item = await CitationUtils.getItemByURI(uri.trim());
            if (!item) {
                CitationUtils.log(`Warning: Item not found for URI: ${uri}`);
                continue;
            }

            let citekey = '';
            try { citekey = item.getField('citationKey') || ''; } catch(e) {}
            if (!citekey) citekey = item.citationKey || item.key;

            allMatches.push({
                index: match.index,
                endIndex: match.index + fullMatch.length,
                prefix: prefix.trim(),
                cite: cite.trim(),
                citekey,
                locator: locator.trim(),
                suffix: suffix.trim(),
                suppressAuthor: cite.trim().startsWith('-')
            });
        }

        // Group consecutive markers (no content between them) into single pandoc cites
        const groups = [];
        let i = 0;
        while (i < allMatches.length) {
            const group = [allMatches[i]];
            while (i + 1 < allMatches.length && allMatches[i + 1].index === allMatches[i].endIndex) {
                i++;
                group.push(allMatches[i]);
            }
            groups.push(group);
            i++;
        }

        // Build replacements in reverse order to preserve indices
        const replacements = [];
        for (const group of groups) {
            const parts = group.map(m => {
                let entry = '';
                if (m.prefix) entry += m.prefix + ' ';
                if (m.suppressAuthor) entry += '-';
                entry += '@' + m.citekey;
                if (m.locator) entry += ', ' + m.locator;
                if (m.suffix) entry += ', ' + m.suffix;
                return entry;
            });
            const start = group[0].index;
            const end = group[group.length - 1].endIndex;
            replacements.push({ start, end, replacement: '[' + parts.join('; ') + ']' });
        }

        // Apply replacements in reverse order
        let result = content;
        for (const r of replacements.reverse()) {
            result = result.substring(0, r.start) + r.replacement + result.substring(r.end);
        }

        CitationUtils.log(`Converted ${groups.length} citation group(s) to pandoc syntax`);
        return result;
    },

    /**
     * Look up Zotero item by URI.
     * Supports: zu:0:KEY, http://zotero.org/users/.../items/KEY,
     *           http://zotero.org/groups/.../items/KEY, zotero://select/...
     */
    async getItemByURI(uri) {
        try {
            let itemKey;
            let libraryID = Zotero.Libraries.userLibraryID;

            if (uri.startsWith('zotero://select/')) {
                if (uri.includes('/groups/')) {
                    const parts = uri.match(/\/groups\/(\d+)\/items\/(.+)/);
                    if (parts) {
                        const groupID = parseInt(parts[1]);
                        libraryID = Zotero.Groups.getLibraryIDFromGroupID(groupID);
                        itemKey = parts[2];
                    }
                } else {
                    itemKey = uri.split('/items/')[1];
                    if (itemKey && itemKey.includes('_')) {
                        itemKey = itemKey.split('_')[1];
                    }
                }
            } else if (uri.startsWith('zu:')) {
                itemKey = uri.split(':')[2];
            } else if (uri.includes('/items/')) {
                if (uri.includes('/groups/')) {
                    const parts = uri.match(/\/groups\/(\d+)\/items\/(.+)/);
                    if (parts) {
                        const groupID = parseInt(parts[1]);
                        libraryID = Zotero.Groups.getLibraryIDFromGroupID(groupID);
                        itemKey = parts[2];
                    }
                } else {
                    itemKey = uri.split('/items/')[1];
                }
            } else {
                CitationUtils.log("Warning: Unrecognized URI format: " + uri);
                return null;
            }

            if (!itemKey) {
                CitationUtils.log("Warning: Could not extract item key from URI: " + uri);
                return null;
            }

            CitationUtils.log("Looking up item with key: " + itemKey + " in library: " + libraryID);

            const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, itemKey);
            return item;

        } catch (e) {
            CitationUtils.log("Error looking up item: " + e);
            return null;
        }
    },

    /**
     * Convert pandoc citations to scannable cite markers in plain text / ODF XML.
     * Unlike the DOCX variant, this does not parse Word XML runs — it works
     * directly on the string, suitable for ODF content.xml.
     *
     * Pass 1: bracket groups [@key; @key2, p. 3]
     * Pass 2: author-in-text @key [loc] or bare @key
     */
    async pandocToMarkersText(content) {
        CitationUtils.log("Converting pandoc citations to markers (ODF/text mode)");

        let convertedCount = 0;
        const notFoundKeys = [];

        // Helper: look up item and return { item, firstCreator, title, year, uri } or null
        // Uses the short zu:/zg: format that odfConverter.js markers require.
        const lookupItem = async (citekey) => {
            const item = await CitationUtils.findItemByCitationKey(citekey);
            if (!item) {
                CitationUtils.log(`Warning: Item not found for citationKey: ${citekey}`);
                notFoundKeys.push(citekey);
                return null;
            }
            const uri = await CitationUtils.buildItemURIShort(item);
            let firstCreator = '';
            let title = '';
            let year = '';
            try { firstCreator = (item.getField('firstCreator') || '').replace(/[\u2068\u2069]/g, ''); } catch(e) {}
            try { title = item.getField('title') || ''; } catch(e) {}
            try { year = item.getField('year') || ''; } catch(e) {
                try { year = (item.getField('date') || '').match(/\d{4}/)?.[0] || ''; } catch(e2) {}
            }
            return { item, firstCreator, title, year, uri };
        };

        // Pass 1: bracket groups  [@key; @key2, p. 3]
        // Collect all matches first, then process in reverse to preserve string indices.
        const bracketRegex = /\[([^\[\]]*@[^\[\]]*)\]/g;
        let bm;
        const bracketMatches = [];
        while ((bm = bracketRegex.exec(content)) !== null) {
            bracketMatches.push({ full: bm[0], inner: bm[1], index: bm.index });
        }
        for (let i = bracketMatches.length - 1; i >= 0; i--) {
            const { full, inner, index } = bracketMatches[i];
            const entries = CitationUtils.parsePandocCitationGroup(inner);
            const markers = [];
            for (const entry of entries) {
                const found = await lookupItem(entry.citekey);
                if (!found) continue;
                let cite = found.firstCreator;
                if (found.title) cite += (cite ? ', ' : '') + found.title;
                if (found.year) cite += ` (${found.year})`;
                if (entry.suppressAuthor) cite = '-' + cite;
                markers.push(`{ ${entry.prefix} | ${cite} | ${entry.locator} | ${entry.suffix} | ${found.uri}}`);
                convertedCount++;
            }
            if (markers.length) {
                content = content.substring(0, index) + markers.join('') + content.substring(index + full.length);
            }
        }

        // Pass 2: author-in-text  @key [loc]  or bare  @key
        // After pass 1 the bracket groups are gone, so all remaining @key are author-in-text.
        const aitRegex = /@([\w][\w:.#$%&\-+?<>~/]*)(?:\s*\[([^\]]*)\])?/g;
        let am;
        const aitMatches = [];
        while ((am = aitRegex.exec(content)) !== null) {
            aitMatches.push({ full: am[0], citekey: am[1], locatorText: am[2], index: am.index });
        }
        for (let i = aitMatches.length - 1; i >= 0; i--) {
            const { full, citekey, locatorText, index } = aitMatches[i];
            const found = await lookupItem(citekey);
            if (!found) continue;
            let cite = '-' + found.firstCreator;
            if (found.title) cite += ', ' + found.title;
            if (found.year) cite += ` (${found.year})`;
            const locatorInfo = locatorText ? CitationUtils.parsePandocLocator(locatorText.trim()) : { locator: '', suffix: '' };
            const marker = `{ | ${cite} | ${locatorInfo.locator} | ${locatorInfo.suffix} | ${found.uri}}`;
            convertedCount++;
            content = content.substring(0, index) + found.firstCreator + ' ' + marker + content.substring(index + full.length);
        }

        if (notFoundKeys.length > 0) {
            CitationUtils.log(`Warning: ${notFoundKeys.length} citation keys not found: ${notFoundKeys.join(', ')}`);
        }
        CitationUtils.log(`Converted ${convertedCount} pandoc citations to markers (ODF/text mode)`);
        return content;
    },

    /**
     * Parse a pandoc citation group (the text inside [...])
     * Returns array of { citekey, prefix, locator, label, suffix, suppressAuthor }
     */
    parsePandocCitationGroup(text) {
        const entries = [];

        const parts = text.split(';');

        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            const citeMatch = trimmed.match(/(-?)@([\w][\w:.#$%&\-+?<>~/]*)/);
            if (!citeMatch) continue;

            const suppressAuthor = citeMatch[1] === '-';
            const citekey = citeMatch[2];

            let prefix = trimmed.substring(0, citeMatch.index).trim();

            const afterKey = trimmed.substring(citeMatch.index + citeMatch[0].length).trim();

            let locator = '';
            let label = 'page';
            let suffix = '';

            if (afterKey.startsWith(',')) {
                const afterComma = afterKey.substring(1).trim();
                const locatorInfo = CitationUtils.parsePandocLocator(afterComma);
                locator = locatorInfo.locator;
                label = locatorInfo.label;
                suffix = locatorInfo.suffix;
            } else if (afterKey) {
                suffix = afterKey;
            }

            entries.push({ citekey, prefix, locator, label, suffix, suppressAuthor });
        }

        return entries;
    },

    /**
     * Parse a pandoc locator string (text after citekey comma).
     * Recognizes: p., pp., ch., chap., chapter, sec., vol., etc.
     * Returns { locator, label, suffix } where label is the CSL term
     * (e.g. "chapter") and locator is the display string (e.g. "ch. 3").
     */
    parsePandocLocator(text) {
        const locatorPrefixes = [
            { pattern: /^pp?\.\s*|^pages?\s*/i,                          label: 'page',      display: 'p.' },
            { pattern: /^ch\.\s*|^chaps?\.\s*|^chapters?\s*/i,           label: 'chapter',   display: 'ch.' },
            { pattern: /^secs?\.\s*|^sections?\s*/i,                      label: 'section',   display: 'sec.' },
            { pattern: /^vols?\.\s*|^volumes?\s*/i,                       label: 'volume',    display: 'vol.' },
            { pattern: /^nos?\.\s*|^numbers?\s*/i,                        label: 'number',    display: 'no.' },
            { pattern: /^paras?\.\s*|^paragraphs?\s*/i,                   label: 'paragraph', display: 'para.' },
            { pattern: /^figs?\.\s*|^figures?\s*/i,                       label: 'figure',    display: 'fig.' },
            { pattern: /^ll?\.\s*/i,                                      label: 'line',      display: 'l.' },
            { pattern: /^nn?\.\s*|^notes?\s*/i,                           label: 'note',      display: 'n.' },
            { pattern: /^arts?\.\s*|^articles?\s*/i,                      label: 'article',   display: 'art.' },
        ];

        for (const lp of locatorPrefixes) {
            const m = text.match(lp.pattern);
            if (m) {
                const rest = text.substring(m[0].length);
                const valueMatch = rest.match(/^([\d\-–—,\s]+)(.*)/);
                if (valueMatch) {
                    return {
                        locator: lp.display + ' ' + valueMatch[1].trim(),
                        label: lp.label,
                        suffix: valueMatch[2].trim()
                    };
                }
                return { locator: lp.display + ' ' + rest.trim(), label: lp.label, suffix: '' };
            }
        }

        // No recognized prefix — if starts with digit, assume page
        const digitMatch = text.match(/^([\d\-–—,\s]+)(.*)/);
        if (digitMatch) {
            return {
                locator: 'p. ' + digitMatch[1].trim(),
                label: 'page',
                suffix: digitMatch[2].trim()
            };
        }

        // No locator found, treat everything as suffix
        return { locator: '', label: 'page', suffix: text.trim() };
    },

    /**
     * Search Zotero for an item by its citationKey field
     */
    async findItemByCitationKey(citationKey) {
        try {
            CitationUtils.log("Searching for citationKey: " + citationKey);

            const s = new Zotero.Search();
            s.libraryID = Zotero.Libraries.userLibraryID;
            s.addCondition('citationKey', 'is', citationKey);
            const ids = await s.search();

            if (ids.length === 0) {
                CitationUtils.log("No item found for citationKey: " + citationKey);
                return null;
            }

            if (ids.length > 1) {
                CitationUtils.log(`Warning: Multiple items found for citationKey: ${citationKey}, using first`);
            }

            const item = await Zotero.Items.getAsync(ids[0]);
            CitationUtils.log(`Found item: ${item.getField('title')} (key: ${item.key})`);
            return item;

        } catch (e) {
            CitationUtils.log("Error searching for citationKey: " + e);
            return null;
        }
    },

    /**
     * Convert a full HTTP Zotero URI to the short zu:/zg: form that
     * odfConverter.js markers require, without needing a live item lookup.
     */
    httpURIToShort(uri) {
        if (uri.startsWith('zu:') || uri.startsWith('zg:') || uri.startsWith('zotero://')) return uri;
        // Local user library: http://zotero.org/users/local/HASH/items/KEY
        const localMatch = uri.match(/\/users\/local\/[^/]+\/items\/(.+)/);
        if (localMatch) return `zu:0:${localMatch[1]}`;
        // Synced user library: http://zotero.org/users/USERID/items/KEY
        const userMatch = uri.match(/\/users\/(\d+)\/items\/(.+)/);
        if (userMatch) return `zu:${userMatch[1]}:${userMatch[2]}`;
        // Group library: http://zotero.org/groups/GROUPID/items/KEY
        const groupMatch = uri.match(/\/groups\/(\d+)\/items\/(.+)/);
        if (groupMatch) return `zg:${groupMatch[1]}:${groupMatch[2]}`;
        return uri;
    },

    /**
     * Build the short-form URI for an item as expected by odfConverter.js markers.
     * Format: zu:LIB:KEY (user library) or zg:GROUPID:KEY (group library)
     */
    async buildItemURIShort(item) {
        const libraryID = item.libraryID;
        const library = Zotero.Libraries.get(libraryID);

        if (library.libraryType === 'user') {
            const userID = Zotero.Users.getCurrentUserID();
            const lib = userID ? String(userID) : '0';
            return `zu:${lib}:${item.key}`;
        } else {
            const groupID = Zotero.Groups.getGroupIDFromLibraryID(libraryID);
            return `zg:${groupID}:${item.key}`;
        }
    },

    /**
     * Build the full HTTP Zotero URI for an item
     */
    async buildItemURI(item) {
        const libraryID = item.libraryID;
        const library = Zotero.Libraries.get(libraryID);

        if (library.libraryType === 'user') {
            const userID = Zotero.Users.getCurrentUserID();
            if (userID) {
                return `http://zotero.org/users/${userID}/items/${item.key}`;
            } else {
                const localKey = Zotero.Users.getLocalUserKey();
                return `http://zotero.org/users/local/${localKey}/items/${item.key}`;
            }
        } else {
            const groupID = Zotero.Groups.getGroupIDFromLibraryID(libraryID);
            return `http://zotero.org/groups/${groupID}/items/${item.key}`;
        }
    },

    /**
     * Build a scannable cite marker string from a CSL citationItem and formatted cite text.
     * Shared by DOCX citationsToMarkers and (via the ODF tmplText equivalent) ODF tomarkers.
     *
     * Returns null if the citationItem has no URI.
     */
    buildMarkerForItem(citItem, formattedCite) {
        const uri = citItem.uris && citItem.uris.length > 0 ? citItem.uris[0] : null;
        if (!uri) return null;
        const shortURI = CitationUtils.httpURIToShort(uri);
        const prefix = citItem.prefix || "";
        const locator = citItem.locator || "";
        const suffix = citItem.suffix || "";
        const suppress = citItem["suppress-author"] ? "-" : "";
        return `{ ${prefix} | ${suppress}${formattedCite} | ${locator} | ${suffix} |${shortURI}}`;
    },

    /**
     * Parse the five pipe-separated fields of a scannable cite marker into a CSL citationItem
     * and the stripped cite text.  Shared by DOCX markersToCitations and ODF tocitations.
     *
     * Returns { citationItem, cite } where cite is the readable text with the suppress-author
     * dash removed.  The caller is responsible for looking up the canonical URI and replacing
     * citationItem.uris[0] if desired.
     */
    parseMarkerToCitationItem(prefix, citeRaw, locator, suffix, uri) {
        const citetrimmed = citeRaw.trim();
        const suppressAuthor = citetrimmed.startsWith('-');
        const cite = suppressAuthor ? citetrimmed.slice(1) : citetrimmed;

        const citationItem = { uris: [uri.trim()] };
        if (prefix.trim()) citationItem.prefix = prefix.trim();
        if (locator.trim()) {
            citationItem.locator = locator.trim();
            citationItem.label = "page";
        }
        if (suffix.trim()) citationItem.suffix = suffix.trim();
        if (suppressAuthor) citationItem["suppress-author"] = true;

        return { citationItem, cite, suppressAuthor };
    },

    /**
     * Escape XML special characters
     */
    escapeXml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
};

if (typeof module !== 'undefined') module.exports = CitationUtils;
else window.CitationUtils = CitationUtils;
