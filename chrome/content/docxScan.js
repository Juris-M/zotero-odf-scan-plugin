/* DOCX Scan - Convert between Word markers and Zotero citations in DOCX files
 * Based on rtfScan.js ODF logic, adapted for DOCX Word field structure
 */

var DOCXScanConvert = {

    log(msg) {
        Zotero.debug("DOCX Scan: " + msg);
    },

    /**
     * Main entry point for DOCX scanning
     * @param {string} outputMode - "tocitations", "tomarkers", "pandoctocitations", or "topandoc"
     */
    async scanDOCX(outputMode) {
        this.log(`Starting DOCX scan in ${outputMode} mode`);

        try {
            // Get file paths from globals
            const inputPath = window.inputFile;
            const outputPath = window.outputFile;

            if (!inputPath || !outputPath) {
                throw new Error("Input or output file path not set");
            }

            this.log(`Input: ${inputPath}`);
            this.log(`Output: ${outputPath}`);

            // Extract DOCX to temp directory
            const tempDir = await this.extractDocx(inputPath);

            // Read document.xml
            const docFile = tempDir.clone();
            docFile.append("word");
            docFile.append("document.xml");
            let content = this.readFileContents(docFile);

            this.log("Loaded document.xml, length: " + content.length);

            // Process content
            if (outputMode === "tomarkers") {
                content = await this.citationsToMarkers(content);
            } else if (outputMode === "topandoc") {
                content = await this.citationsToPandoc(content);
            } else if (outputMode === "pandoctocitations") {
                // Two-step: pandoc → scannable cite markers → Zotero citations
                content = await this.pandocToMarkers(content);
                content = await this.markersToCitations(content);
            } else {
                content = await this.markersToCitations(content);
            }

            // Write modified content to a separate temp file (avoid lock on extracted file)
            const modifiedDocFile = Zotero.getTempDirectory();
            modifiedDocFile.append("docx-scan-document.xml");
            Zotero.File.putContents(modifiedDocFile, content);

            // Repackage DOCX, substituting the modified document.xml
            await this.packageDocx(tempDir, outputPath, modifiedDocFile);

            // Clean up the modified file
            if (modifiedDocFile.exists()) {
                modifiedDocFile.remove(false);
            }

            // Clean up temp directory
            await this.cleanupTempDir(tempDir);

            this.log("DOCX scan completed successfully");
            window.DOCXScanComplete = true;
            return true;

        } catch (e) {
            this.log("Error during DOCX scan: " + e);
            this.log(e.stack);
            window.DOCXScanFailed = true;
            throw e;
        }
    },

    /**
     * Read file contents synchronously
     */
    readFileContents(file) {
        const inputStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
            .createInstance(Components.interfaces.nsIFileInputStream);
        inputStream.init(file, 0x01, 0o444, 0);

        const converterStream = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
            .createInstance(Components.interfaces.nsIConverterInputStream);
        converterStream.init(inputStream, "UTF-8", 0, 0);

        let content = "";
        let str = {};
        while (converterStream.readString(4096, str) !== 0) {
            content += str.value;
        }

        converterStream.close();
        inputStream.close();

        return content;
    },

    /**
     * Extract DOCX (ZIP) to temp directory
     */
    async extractDocx(docxPath) {
        const inputFile = Zotero.File.pathToFile(docxPath);
        const tempDirBase = Zotero.getTempDirectory();

        // Create extraction directory
        const extractDir = tempDirBase.clone();
        extractDir.append("docx-scan-" + Date.now());

        if (!extractDir.exists()) {
            extractDir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
        }

        // Use nsIZipReader to extract
        const zipReader = Components.classes["@mozilla.org/libjar/zip-reader;1"]
            .createInstance(Components.interfaces.nsIZipReader);
        zipReader.open(inputFile);

        try {
            const entries = zipReader.findEntries(null);
            while (entries.hasMore()) {
                const entryName = entries.getNext();
                const entry = zipReader.getEntry(entryName);

                if (entry.isDirectory) {
                    // Create directory
                    const dirFile = extractDir.clone();
                    const parts = entryName.split('/').filter(p => p);
                    for (const part of parts) {
                        dirFile.append(part);
                    }
                    if (!dirFile.exists()) {
                        dirFile.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
                    }
                } else {
                    // Extract file
                    const targetFile = extractDir.clone();
                    const parts = entryName.split('/').filter(p => p);

                    // Ensure parent directories exist
                    for (let i = 0; i < parts.length - 1; i++) {
                        targetFile.append(parts[i]);
                        if (!targetFile.exists()) {
                            targetFile.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
                        }
                    }
                    targetFile.append(parts[parts.length - 1]);

                    // Extract entry to file using zipReader's extract method
                    zipReader.extract(entryName, targetFile);
                }
            }
        } finally {
            zipReader.close();
        }

        this.log("Extracted DOCX to: " + extractDir.path);
        return extractDir;
    },

    /**
     * Package directory back into DOCX (ZIP)
     * @param {nsIFile} sourceDir - The extracted DOCX directory
     * @param {string} outputPath - Path for the output DOCX file
     * @param {nsIFile} modifiedDocFile - The modified document.xml to substitute
     */
    async packageDocx(sourceDir, outputPath, modifiedDocFile) {
        this.log("Packaging DOCX to: " + outputPath);

        const outputFile = Zotero.File.pathToFile(outputPath);
        if (outputFile.exists()) {
            outputFile.remove(false);
        }

        const zipWriter = Components.classes["@mozilla.org/zipwriter;1"]
            .createInstance(Components.interfaces.nsIZipWriter);
        zipWriter.open(outputFile, 0x04 | 0x08 | 0x20);

        try {
            // Add all files from source directory, substituting document.xml
            await this.addDirectoryToZip(zipWriter, sourceDir, null, modifiedDocFile);
            zipWriter.close();
        } catch (e) {
            this.log("Error packaging DOCX: " + e);
            throw e;
        }
    },

    /**
     * Recursively add directory contents to ZIP
     * @param {nsIFile} modifiedDocFile - If provided, substitute this for word/document.xml
     */
    async addDirectoryToZip(zipWriter, baseDir, relativePath, modifiedDocFile) {
        const currentDir = relativePath ? baseDir.clone() : baseDir;

        if (relativePath) {
            const parts = relativePath.split('/').filter(p => p);
            for (const part of parts) {
                currentDir.append(part);
            }
        }

        // Get directory entries
        const entries = currentDir.directoryEntries;
        while (entries.hasMoreElements()) {
            const entry = entries.nextFile;
            const entryName = entry.leafName;
            const entryRelPath = relativePath ? relativePath + '/' + entryName : entryName;

            if (entry.isDirectory()) {
                // Recursively add subdirectory
                await this.addDirectoryToZip(zipWriter, baseDir, entryRelPath, modifiedDocFile);
            } else {
                // Add file - use forward slashes in ZIP entries (DOCX standard)
                const zipPath = entryRelPath.replace(/\\/g, '/');

                // Substitute modified document.xml if this is word/document.xml
                if (zipPath === 'word/document.xml' && modifiedDocFile) {
                    this.log("Substituting modified document.xml");
                    zipWriter.addEntryFile(zipPath, 9, modifiedDocFile, false);
                } else {
                    zipWriter.addEntryFile(zipPath, 9, entry, false);
                }
            }
        }
    },

    /**
     * Clean up temporary directory
     */
    async cleanupTempDir(tempDir) {
        try {
            if (tempDir && tempDir.exists()) {
                tempDir.remove(true); // true = recursive
                this.log("Cleaned up temp directory");
            }
        } catch (e) {
            this.log("Warning: Could not clean up temp directory: " + e);
        }
    },

    /**
     * Convert markers to citations in DOCX content
     */
    async markersToCitations(content) {
        this.log("Converting markers to citations");

        // Regex to find markers in plain text: { | Author, Year | | |zu:0:ITEMKEY}
        // The marker can span across w:t elements, so we look for the pattern anywhere
        const markerRegex = /\{\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|}]*?)\s*\}/g;

        const citations = [];
        let match;

        // First pass: find all markers and build citations
        while ((match = markerRegex.exec(content)) !== null) {
            const [fullMatch, prefix, cite, locator, suppress, uri] = match;

            this.log(`Found marker: ${cite} | ${uri}`);

            // Look up item in Zotero
            const item = await this.getItemByURI(uri.trim());
            if (!item) {
                this.log(`Warning: Item not found for URI: ${uri}`);
                continue;
            }

            // Build citation data
            const citationData = await this.buildCitationData(item, cite.trim(), locator.trim(), suppress.trim());
            citations.push({
                marker: fullMatch,
                citationData,
                formattedCitation: cite.trim() || "Citation"
            });
        }

        // Second pass: replace markers with Word fields
        let tempContent = content;
        for (const citation of citations) {
            const wordField = this.buildWordField(citation.citationData, citation.formattedCitation);
            tempContent = tempContent.replace(citation.marker, wordField);
        }

        this.log(`Converted ${citations.length} markers to citations`);
        return tempContent;
    },

    /**
     * Convert citations to markers in DOCX content
     */
    async citationsToMarkers(content) {
        this.log("Converting citations to markers");

        // Word fields can have instrText split across multiple w:r elements with different formatting
        // We need to find the complete field structure and extract all instrText content

        // Find all complete Word fields: from fldChar begin to fldChar end
        const fieldRegex = /<w:r[^>]*><w:fldChar\s+w:fldCharType="begin"[^>]*\/><\/w:r>([\s\S]*?)<w:r[^>]*><w:fldChar\s+w:fldCharType="end"[^>]*\/><\/w:r>/g;

        let convertedCount = 0;
        let tempContent = content;

        // Find and replace each citation field
        tempContent = tempContent.replace(fieldRegex, (fullMatch, fieldContent) => {
            try {
                // Extract all instrText content from within the field
                const instrTextRegex = /<w:instrText[^>]*>([^<]*)<\/w:instrText>/g;
                let instrText = '';
                let instrMatch;
                while ((instrMatch = instrTextRegex.exec(fieldContent)) !== null) {
                    instrText += instrMatch[1];
                }

                // Check if this is a Zotero citation field
                if (!instrText.includes('ADDIN ZOTERO_ITEM CSL_CITATION')) {
                    return fullMatch; // Not a Zotero field, leave unchanged
                }

                this.log("Found Zotero field, instrText length: " + instrText.length);

                // Extract JSON from instrText - find the JSON object after CSL_CITATION
                const jsonMatch = instrText.match(/ADDIN ZOTERO_ITEM CSL_CITATION\s+(\{[\s\S]*\})\s*$/);
                if (!jsonMatch) {
                    this.log("Warning: Could not extract JSON from instrText");
                    return fullMatch;
                }

                const jsonStr = jsonMatch[1];
                this.log("Extracted JSON, length: " + jsonStr.length);

                // Parse citation JSON
                const citationData = JSON.parse(jsonStr);
                this.log("Found citation: " + JSON.stringify(citationData).substring(0, 100));

                // Extract first citation item
                if (!citationData.citationItems || citationData.citationItems.length === 0) {
                    this.log("Warning: No citation items found");
                    return fullMatch;
                }

                const item = citationData.citationItems[0];

                // Extract URI
                const uri = item.uris && item.uris.length > 0 ? item.uris[0] : null;
                if (!uri) {
                    this.log("Warning: No URI found in citation");
                    return fullMatch;
                }

                // Extract components for marker
                const cite = citationData.properties?.plainCitation || "";
                const locator = item.locator || "";
                const suppress = item["suppress-author"] ? "-" : "";

                // Build marker format: { | cite | locator | suppress | uri }
                const marker = `{ | ${suppress}${cite} | ${locator} | | ${uri}}`;

                // Wrap in Word text run
                const markerXml = `<w:r><w:t>${this.escapeXml(marker)}</w:t></w:r>`;

                convertedCount++;
                this.log(`Converted citation to marker: ${marker}`);

                return markerXml;

            } catch (e) {
                this.log("Error parsing citation: " + e);
                this.log(e.stack);
                return fullMatch;
            }
        });

        this.log(`Converted ${convertedCount} citations to markers`);
        return tempContent;
    },

    /**
     * Convert Zotero citations to pandoc citation syntax in DOCX content.
     * Reverse of pandocToMarkers: extracts Word field citations and replaces
     * them with [@citekey] syntax.
     */
    async citationsToPandoc(content) {
        this.log("Converting citations to pandoc syntax");

        const fieldRegex = /<w:r[^>]*><w:fldChar\s+w:fldCharType="begin"[^>]*\/><\/w:r>([\s\S]*?)<w:r[^>]*><w:fldChar\s+w:fldCharType="end"[^>]*\/><\/w:r>/g;

        let convertedCount = 0;
        const matches = [];
        let match;

        // Collect all matches first (we need async lookups)
        while ((match = fieldRegex.exec(content)) !== null) {
            matches.push({ fullMatch: match[0], fieldContent: match[1], index: match.index });
        }

        // Process in reverse order to preserve indices
        let result = content;
        for (let i = matches.length - 1; i >= 0; i--) {
            const m = matches[i];
            try {
                // Extract all instrText content
                const instrTextRegex = /<w:instrText[^>]*>([^<]*)<\/w:instrText>/g;
                let instrText = '';
                let instrMatch;
                while ((instrMatch = instrTextRegex.exec(m.fieldContent)) !== null) {
                    instrText += instrMatch[1];
                }

                if (!instrText.includes('ADDIN ZOTERO_ITEM CSL_CITATION')) {
                    continue; // Not a Zotero field
                }

                const jsonMatch = instrText.match(/ADDIN ZOTERO_ITEM CSL_CITATION\s+(\{[\s\S]*\})\s*$/);
                if (!jsonMatch) continue;

                const citationData = JSON.parse(jsonMatch[1]);
                if (!citationData.citationItems || citationData.citationItems.length === 0) continue;

                // Build pandoc citation for each citation item
                const pandocParts = [];
                for (const citItem of citationData.citationItems) {
                    const uri = citItem.uris && citItem.uris.length > 0 ? citItem.uris[0] : null;
                    if (!uri) continue;

                    const item = await this.getItemByURI(uri);
                    if (!item) {
                        this.log(`Warning: Item not found for URI: ${uri}`);
                        continue;
                    }

                    // Get citation key - prefer citationKey field, fall back to item key
                    let citekey = '';
                    try { citekey = item.getField('citationKey') || ''; } catch(e) {}
                    if (!citekey) citekey = item.citationKey || item.key;

                    // Build individual pandoc cite entry
                    let entry = '';

                    // Prefix (text before @)
                    if (citItem.prefix) {
                        entry += citItem.prefix + ' ';
                    }

                    // Suppress-author
                    if (citItem["suppress-author"]) {
                        entry += '-';
                    }

                    entry += '@' + citekey;

                    // Locator
                    if (citItem.locator) {
                        const label = citItem.label || 'page';
                        const locatorPrefix = this.labelToPandocLocator(label);
                        entry += ', ' + locatorPrefix + citItem.locator;
                    }

                    // Suffix
                    if (citItem.suffix) {
                        entry += ', ' + citItem.suffix;
                    }

                    pandocParts.push(entry);
                }

                if (pandocParts.length === 0) continue;

                const pandocCite = '[' + pandocParts.join('; ') + ']';
                const pandocXml = `<w:r><w:t>${this.escapeXml(pandocCite)}</w:t></w:r>`;

                result = result.substring(0, m.index) + pandocXml + result.substring(m.index + m.fullMatch.length);
                convertedCount++;
                this.log(`Converted citation to pandoc: ${pandocCite}`);

            } catch (e) {
                this.log("Error converting citation to pandoc: " + e);
            }
        }

        this.log(`Converted ${convertedCount} citations to pandoc syntax`);
        return result;
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
     */
    async markersToPandoc(content) {
        this.log("Converting markers to pandoc syntax");

        const markerRegex = /\{\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|}]*?)\s*\}/g;
        let convertedCount = 0;
        const replacements = [];
        let match;

        while ((match = markerRegex.exec(content)) !== null) {
            const [fullMatch, prefix, cite, locator, suffix, uri] = match;

            const item = await this.getItemByURI(uri.trim());
            if (!item) {
                this.log(`Warning: Item not found for URI: ${uri}`);
                continue;
            }

            // Get citation key
            let citekey = '';
            try { citekey = item.getField('citationKey') || ''; } catch(e) {}
            if (!citekey) citekey = item.citationKey || item.key;

            // Detect suppress-author (cite starts with -)
            let suppressAuthor = false;
            let cleanCite = cite.trim();
            if (cleanCite.startsWith('-')) {
                suppressAuthor = true;
            }

            let entry = '';
            if (prefix.trim()) {
                entry += prefix.trim() + ' ';
            }
            if (suppressAuthor) {
                entry += '-';
            }
            entry += '@' + citekey;
            if (locator.trim()) {
                entry += ', ' + locator.trim();
            }
            if (suffix.trim()) {
                entry += ', ' + suffix.trim();
            }

            replacements.push({ fullMatch, replacement: '[' + entry + ']' });
            convertedCount++;
        }

        let result = content;
        for (const r of replacements) {
            result = result.replace(r.fullMatch, r.replacement);
        }

        this.log(`Converted ${convertedCount} markers to pandoc syntax`);
        return result;
    },

    /**
     * Look up Zotero item by URI
     */
    async getItemByURI(uri) {
        try {
            // URI formats supported:
            // zu:0:ITEMKEY (short form)
            // http://zotero.org/users/local/USER/items/ITEMKEY
            // http://zotero.org/users/USERID/items/ITEMKEY
            // http://zotero.org/groups/GROUPID/items/ITEMKEY
            // zotero://select/library/items/ITEMKEY
            // zotero://select/groups/GROUPID/items/ITEMKEY

            let itemKey;
            let libraryID = Zotero.Libraries.userLibraryID;

            if (uri.startsWith('zotero://select/')) {
                // Older Zotero select link format
                if (uri.includes('/groups/')) {
                    const parts = uri.match(/\/groups\/(\d+)\/items\/(.+)/);
                    if (parts) {
                        const groupID = parseInt(parts[1]);
                        libraryID = Zotero.Groups.getLibraryIDFromGroupID(groupID);
                        itemKey = parts[2];
                    }
                } else {
                    // zotero://select/library/items/ITEMKEY or zotero://select/items/0_ITEMKEY
                    itemKey = uri.split('/items/')[1];
                    // Handle 0_ITEMKEY format (strip library prefix)
                    if (itemKey && itemKey.includes('_')) {
                        itemKey = itemKey.split('_')[1];
                    }
                }
            } else if (uri.startsWith('zu:')) {
                // Short form: zu:0:ITEMKEY
                itemKey = uri.split(':')[2];
            } else if (uri.includes('/items/')) {
                // Full HTTP form
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
                this.log("Warning: Unrecognized URI format: " + uri);
                return null;
            }

            if (!itemKey) {
                this.log("Warning: Could not extract item key from URI: " + uri);
                return null;
            }

            this.log("Looking up item with key: " + itemKey + " in library: " + libraryID);

            const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, itemKey);
            return item;

        } catch (e) {
            this.log("Error looking up item: " + e);
            return null;
        }
    },

    /**
     * Build CSL citation data structure for an item
     * Only includes uri - Zotero will look up metadata when processing
     */
    async buildCitationData(item, cite, locator, suppress) {
        const uri = await this.buildItemURI(item);

        // Build citation item - only uri needed, no itemData
        const citationItem = {
            uris: [uri]
        };

        // Add locator if present
        if (locator) {
            citationItem.locator = locator;
            citationItem.label = "page";
        }

        // Add suppress-author if present
        if (suppress) {
            citationItem["suppress-author"] = true;
        }

        // Build full citation data
        const citationData = {
            citationID: this.generateCitationID(),
            properties: {
                formattedCitation: cite,
                plainCitation: cite
            },
            citationItems: [citationItem],
            schema: "https://github.com/citation-style-language/schema/raw/master/csl-citation.json"
        };

        return citationData;
    },

    /**
     * Build Word field XML for a citation
     * This creates a complete field structure with proper w:r (run) elements
     */
    buildWordField(citationData, formattedCitation) {
        const jsonStr = JSON.stringify(citationData);

        // Escape XML special characters in the JSON
        const escapedJson = this.escapeXml(jsonStr);

        // Build Word field structure - each part must be in its own w:r element
        // The field structure is: begin -> instrText -> separate -> displayText -> end
        const field =
            `</w:t></w:r>` +  // Close the current text run
            `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:r><w:instrText xml:space="preserve"> ADDIN ZOTERO_ITEM CSL_CITATION ${escapedJson} </w:instrText></w:r>` +
            `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
            `<w:r><w:t>${this.escapeXml(formattedCitation)}</w:t></w:r>` +
            `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
            `<w:r><w:t>`;  // Reopen a text run for any following content

        return field;
    },

    /**
     * Generate random citation ID
     */
    generateCitationID() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let id = '';
        for (let i = 0; i < 8; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    },

    /**
     * Convert pandoc citations to scannable cite markers in DOCX content.
     * Pandoc syntax: [@citekey], [@citekey, p. 33], [-@citekey], [see @key1; @key2]
     * Converts to: { prefix | Author, Title (Year) | locator | suffix | uri }
     *
     * Word splits text across multiple w:r/w:t elements with different formatting,
     * so we need to extract plain text, find citations, then replace the XML spans.
     */
    async pandocToMarkers(content) {
        this.log("Converting pandoc citations to markers");

        // Strategy: find all <w:p> paragraphs, extract their plain text,
        // find pandoc citations in the plain text, then rebuild the paragraph
        // with markers replacing the citation spans.

        const paraRegex = /(<w:p[ >][\s\S]*?<\/w:p>)/g;
        let convertedCount = 0;
        let notFoundKeys = [];

        // Process each paragraph
        const processedContent = await this.replaceAsync(content, paraRegex, async (paraXml) => {
            // Extract text runs: each { xml, text } from <w:r>...<w:t>text</w:t>...</w:r>
            const runs = this.extractTextRuns(paraXml);
            if (runs.length === 0) return paraXml;

            // Build concatenated plain text and a map from plain-text offset to run index + offset
            let plainText = '';
            const charMap = []; // charMap[plainIdx] = { runIdx, charIdx }
            for (let ri = 0; ri < runs.length; ri++) {
                for (let ci = 0; ci < runs[ri].text.length; ci++) {
                    charMap.push({ runIdx: ri, charIdx: ci });
                    plainText += runs[ri].text[ci];
                }
            }

            // Find pandoc citations in the plain text
            const pandocCiteRegex = /\[([^\[\]]*@[^\[\]]*)\]/g;
            let match;
            const citations = [];

            while ((match = pandocCiteRegex.exec(plainText)) !== null) {
                const innerText = match[1];
                const startIdx = match.index;
                const endIdx = match.index + match[0].length - 1;

                this.log(`Found pandoc citation in plain text: ${match[0]}`);

                // Parse individual citations
                const citeEntries = this.parsePandocCitationGroup(innerText);
                const markers = [];

                for (const entry of citeEntries) {
                    const item = await this.findItemByCitationKey(entry.citekey);
                    if (!item) {
                        this.log(`Warning: Item not found for citationKey: ${entry.citekey}`);
                        notFoundKeys.push(entry.citekey);
                        continue;
                    }

                    const uri = await this.buildItemURI(item);

                    let firstCreator = '';
                    let title = '';
                    let year = '';
                    try { firstCreator = item.getField('firstCreator') || ''; } catch(e) {}
                    try { title = item.getField('title') || ''; } catch(e) {}
                    try { year = item.getField('year') || ''; } catch(e) {
                        try { year = (item.getField('date') || '').match(/\d{4}/)?.[0] || ''; } catch(e2) {}
                    }
                    let cite = firstCreator;
                    if (title) cite += (cite ? ', ' : '') + title;
                    if (year) cite += ` (${year})`;

                    if (entry.suppressAuthor) {
                        cite = '-' + cite;
                    }

                    const marker = `{ ${entry.prefix} | ${cite} | ${entry.locator} | ${entry.suffix} | ${uri}}`;
                    markers.push(marker);
                    convertedCount++;
                }

                if (markers.length > 0) {
                    citations.push({
                        startIdx,
                        endIdx,
                        startRun: charMap[startIdx].runIdx,
                        startChar: charMap[startIdx].charIdx,
                        endRun: charMap[endIdx].runIdx,
                        endChar: charMap[endIdx].charIdx,
                        replacement: markers.join('')
                    });
                }
            }

            if (citations.length === 0) return paraXml;

            // Rebuild paragraph XML, replacing citation spans
            // Process citations in reverse order so indices remain valid
            citations.reverse();

            for (const cite of citations) {
                // Modify the runs array: replace text in the affected runs
                // For the start run: keep text before the citation start
                // For the end run: keep text after the citation end
                // Remove any runs in between entirely

                const startRun = cite.startRun;
                const endRun = cite.endRun;

                if (startRun === endRun) {
                    // Citation is within a single run
                    const run = runs[startRun];
                    const before = run.text.substring(0, cite.startChar);
                    const after = run.text.substring(cite.endChar + 1);
                    run.text = before + cite.replacement + after;
                } else {
                    // Citation spans multiple runs
                    // Truncate start run, clear middle runs, truncate end run
                    const beforeText = runs[startRun].text.substring(0, cite.startChar);
                    const afterText = runs[endRun].text.substring(cite.endChar + 1);

                    runs[startRun].text = beforeText + cite.replacement + afterText;

                    // Mark middle and end runs for removal
                    for (let i = startRun + 1; i <= endRun; i++) {
                        runs[i].remove = true;
                    }
                }
            }

            // Rebuild paragraph XML from modified runs
            return this.rebuildParagraph(paraXml, runs);
        });

        if (notFoundKeys.length > 0) {
            this.log(`Warning: ${notFoundKeys.length} citation keys not found: ${notFoundKeys.join(', ')}`);
        }
        this.log(`Converted ${convertedCount} pandoc citations to markers`);
        return processedContent;
    },

    /**
     * Extract text runs from a paragraph's XML.
     * Returns array of { xml: full <w:r>...</w:r>, text: extracted text, textStart, textEnd }
     */
    extractTextRuns(paraXml) {
        const runs = [];
        // Match each w:r element (non-greedy, handles nested elements)
        const runRegex = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
        let match;

        while ((match = runRegex.exec(paraXml)) !== null) {
            const runXml = match[0];
            const runStart = match.index;

            // Extract text from <w:t> elements within this run
            const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
            let textMatch;
            let text = '';

            while ((textMatch = textRegex.exec(runXml)) !== null) {
                text += textMatch[1];
            }

            runs.push({
                xml: runXml,
                text: text,
                originalText: text,
                xmlStart: runStart,
                remove: false
            });
        }

        return runs;
    },

    /**
     * Rebuild a paragraph's XML with modified text runs.
     * Replaces text content in <w:t> elements and removes marked runs.
     */
    rebuildParagraph(paraXml, runs) {
        // Work backwards through runs to preserve offsets
        let result = paraXml;

        for (let i = runs.length - 1; i >= 0; i--) {
            const run = runs[i];

            if (run.remove) {
                // Remove entire run from XML
                result = result.substring(0, run.xmlStart) +
                         result.substring(run.xmlStart + run.xml.length);
            } else if (run.text !== run.originalText) {
                // Replace the run's XML with updated text
                let newRunXml = run.xml;

                // Replace text in <w:t> elements - put all text in first <w:t>
                let firstReplace = true;
                newRunXml = newRunXml.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, () => {
                    if (firstReplace) {
                        firstReplace = false;
                        // Preserve xml:space="preserve" or add it if text has leading/trailing spaces
                        const escapedText = this.escapeXml(run.text);
                        return `<w:t xml:space="preserve">${escapedText}</w:t>`;
                    }
                    return ''; // Remove additional w:t elements
                });

                result = result.substring(0, run.xmlStart) +
                         newRunXml +
                         result.substring(run.xmlStart + run.xml.length);
            }
        }

        return result;
    },

    /**
     * Async version of String.replace for use with async replacement functions
     */
    async replaceAsync(str, regex, asyncFn) {
        const matches = [];
        let match;
        // Reset regex
        regex.lastIndex = 0;
        while ((match = regex.exec(str)) !== null) {
            matches.push({ match: match[0], index: match.index });
        }

        // Process all matches and collect replacements
        let result = str;
        // Process in reverse order to preserve indices
        for (let i = matches.length - 1; i >= 0; i--) {
            const m = matches[i];
            const replacement = await asyncFn(m.match);
            result = result.substring(0, m.index) + replacement + result.substring(m.index + m.match.length);
        }

        return result;
    },

    /**
     * Parse a pandoc citation group (the text inside [...])
     * Returns array of { citekey, prefix, locator, suffix, suppressAuthor }
     */
    parsePandocCitationGroup(text) {
        const entries = [];

        // Split by semicolons to get individual citations
        const parts = text.split(';');

        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            // Find the @citekey (or -@citekey for suppress-author)
            const citeMatch = trimmed.match(/(-?)@([\w][\w:.#$%&\-+?<>~/]*)/);
            if (!citeMatch) continue;

            const suppressAuthor = citeMatch[1] === '-';
            const citekey = citeMatch[2];

            // Text before @ is the prefix (excluding the - for suppress-author)
            let prefix = trimmed.substring(0, citeMatch.index).trim();

            // Text after the citekey is suffix/locator info
            const afterKey = trimmed.substring(citeMatch.index + citeMatch[0].length).trim();

            let locator = '';
            let suffix = '';

            if (afterKey.startsWith(',')) {
                // Parse locator and suffix from after the comma
                const afterComma = afterKey.substring(1).trim();
                const locatorInfo = this.parsePandocLocator(afterComma);
                locator = locatorInfo.locator;
                suffix = locatorInfo.suffix;
            }

            entries.push({ citekey, prefix, locator, suffix, suppressAuthor });
        }

        return entries;
    },

    /**
     * Parse a pandoc locator string (text after citekey comma)
     * Recognizes: p., pp., ch., sec., vol., etc.
     */
    parsePandocLocator(text) {
        // Pandoc locator labels
        const locatorPrefixes = [
            { pattern: /^pp?\.\s*/i, label: 'p.' },
            { pattern: /^pages?\s+/i, label: 'p.' },
            { pattern: /^ch(?:apter)?s?\.?\s*/i, label: 'ch.' },
            { pattern: /^sec(?:tion)?s?\.?\s*/i, label: 'sec.' },
            { pattern: /^vol(?:ume)?s?\.?\s*/i, label: 'vol.' },
            { pattern: /^(?:no|nr)\.?\s*/i, label: 'no.' },
            { pattern: /^para(?:graph)?s?\.?\s*/i, label: 'para.' },
            { pattern: /^fig(?:ure)?s?\.?\s*/i, label: 'fig.' },
            { pattern: /^(?:l|ll)\.?\s*/i, label: 'l.' },
            { pattern: /^n(?:ote)?s?\.?\s*/i, label: 'n.' },
            { pattern: /^art(?:icle)?s?\.?\s*/i, label: 'art.' },
        ];

        for (const lp of locatorPrefixes) {
            const m = text.match(lp.pattern);
            if (m) {
                const rest = text.substring(m[0].length);
                // The locator value is digits/ranges, rest is suffix
                const valueMatch = rest.match(/^([\d\-–—,\s]+)(.*)/);
                if (valueMatch) {
                    return {
                        locator: lp.label + ' ' + valueMatch[1].trim(),
                        suffix: valueMatch[2].trim()
                    };
                }
                return { locator: lp.label + ' ' + rest.trim(), suffix: '' };
            }
        }

        // No recognized locator prefix - if starts with digit, assume page
        const digitMatch = text.match(/^([\d\-–—,\s]+)(.*)/);
        if (digitMatch) {
            return {
                locator: 'p. ' + digitMatch[1].trim(),
                suffix: digitMatch[2].trim()
            };
        }

        // No locator found, treat everything as suffix
        return { locator: '', suffix: text.trim() };
    },

    /**
     * Search Zotero for an item by its citationKey field
     */
    async findItemByCitationKey(citationKey) {
        try {
            this.log("Searching for citationKey: " + citationKey);

            const s = new Zotero.Search();
            s.libraryID = Zotero.Libraries.userLibraryID;
            s.addCondition('citationKey', 'is', citationKey);
            const ids = await s.search();

            if (ids.length === 0) {
                this.log("No item found for citationKey: " + citationKey);
                return null;
            }

            if (ids.length > 1) {
                this.log(`Warning: Multiple items found for citationKey: ${citationKey}, using first`);
            }

            const item = await Zotero.Items.getAsync(ids[0]);
            this.log(`Found item: ${item.getField('title')} (key: ${item.key})`);
            return item;

        } catch (e) {
            this.log("Error searching for citationKey: " + e);
            return null;
        }
    },

    /**
     * Build the Zotero URI for an item (shared helper)
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

if (typeof module !== 'undefined') module.exports = DOCXScanConvert;
