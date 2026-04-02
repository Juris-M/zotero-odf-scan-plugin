/* DOCX Converter - Convert between Word markers/pandoc and Zotero citations in DOCX files.
 * DOCX-specific logic only. Format-agnostic utilities live in citationUtils.js.
 * Requires CitationUtils to be loaded first (window.CitationUtils).
 */

var DOCXConverter = {

    log(msg) {
        Zotero.debug("DOCX Scan: " + msg);
    },

    /**
     * Main entry point for DOCX scanning
     * @param {string} outputMode - "tocitations", "tomarkers", "pandoctocitations", or "topandoc"
     */
    async scanDOCX(outputMode) {
        this.log(`Starting DOCX scan in ${outputMode} mode`);

        const tempFiles = []; // track temp files for cleanup

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

            // Build substitutions map: zip entry path → temp nsIFile with modified content
            // Keys use forward slashes (DOCX/ZIP convention).
            const substitutions = new Map();

            // Files to process: document.xml is mandatory; footnotes/endnotes are optional.
            const xmlParts = [
                { zipPath: 'word/document.xml',  required: true  },
                { zipPath: 'word/footnotes.xml',  required: false },
                { zipPath: 'word/endnotes.xml',   required: false },
            ];

            for (const part of xmlParts) {
                const srcFile = tempDir.clone();
                for (const seg of part.zipPath.split('/')) srcFile.append(seg);

                if (!srcFile.exists()) {
                    if (part.required) throw new Error(`Required file not found: ${part.zipPath}`);
                    continue;
                }

                let content = this.readFileContents(srcFile);
                this.log(`Loaded ${part.zipPath}, length: ${content.length}`);

                content = await this.processContent(content, outputMode);

                // Write to a uniquely-named temp file
                const tempName = 'docx-scan-' + part.zipPath.replace(/\//g, '-');
                const tempFile = Zotero.getTempDirectory();
                tempFile.append(tempName);
                Zotero.File.putContents(tempFile, content);
                tempFiles.push(tempFile);

                substitutions.set(part.zipPath, tempFile);
            }

            // Repackage DOCX, substituting all modified files
            await this.packageDocx(tempDir, outputPath, substitutions);

            // Clean up temp files and extracted directory
            for (const f of tempFiles) {
                try { if (f.exists()) f.remove(false); } catch(e) {}
            }
            await this.cleanupTempDir(tempDir);

            this.log("DOCX scan completed successfully");
            window.DOCXScanComplete = true;
            return true;

        } catch (e) {
            this.log("Error during DOCX scan: " + e);
            this.log(e.stack);
            for (const f of tempFiles) {
                try { if (f.exists()) f.remove(false); } catch(e2) {}
            }
            window.DOCXScanFailed = true;
            throw e;
        }
    },

    /**
     * Route content through the appropriate conversion for outputMode.
     * Shared by document.xml, footnotes.xml, and endnotes.xml.
     */
    async processContent(content, outputMode) {
        if (outputMode === "tomarkers") {
            return await this.citationsToMarkers(content);
        } else if (outputMode === "topandoc") {
            return await this.citationsToPandoc(content);
        } else if (outputMode === "pandoctocitations") {
            return await this.pandocToCitationsDirect(content);
        } else {
            return await this.markersToCitations(content);
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
     * @param {Map<string, nsIFile>} substitutions - Map of zip entry path → replacement nsIFile
     */
    async packageDocx(sourceDir, outputPath, substitutions) {
        this.log("Packaging DOCX to: " + outputPath);

        const outputFile = Zotero.File.pathToFile(outputPath);
        try {
            if (outputFile.exists()) {
                outputFile.remove(false);
            }
        } catch (e) {
            if (e.result === 0x8052000e /* NS_ERROR_FILE_IS_LOCKED */) {
                throw new Error(
                    `The output file is locked or open in another application. ` +
                    `Please close "${outputFile.leafName}" and try again.`
                );
            }
            throw e;
        }

        const zipWriter = Components.classes["@mozilla.org/zipwriter;1"]
            .createInstance(Components.interfaces.nsIZipWriter);
        try {
            zipWriter.open(outputFile, 0x04 | 0x08 | 0x20);
        } catch (e) {
            if (e.result === 0x8052000e /* NS_ERROR_FILE_IS_LOCKED */) {
                throw new Error(
                    `The output file is locked or open in another application. ` +
                    `Please close "${outputFile.leafName}" and try again.`
                );
            }
            throw e;
        }

        try {
            await this.addDirectoryToZip(zipWriter, sourceDir, null, substitutions);
            zipWriter.close();
        } catch (e) {
            this.log("Error packaging DOCX: " + e);
            throw e;
        }
    },

    /**
     * Recursively add directory contents to ZIP
     * @param {Map<string, nsIFile>} substitutions - zip entry paths to replace with modified files
     */
    async addDirectoryToZip(zipWriter, baseDir, relativePath, substitutions) {
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
                await this.addDirectoryToZip(zipWriter, baseDir, entryRelPath, substitutions);
            } else {
                // Add file - use forward slashes in ZIP entries (DOCX standard)
                const zipPath = entryRelPath.replace(/\\/g, '/');

                const substitute = substitutions && substitutions.get(zipPath);
                if (substitute) {
                    this.log(`Substituting modified ${zipPath}`);
                    zipWriter.addEntryFile(zipPath, 9, substitute, false);
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
     * Convert markers to citations in DOCX content.
     *
     * Two issues require a position-based approach rather than simple string replacement:
     *
     * 1. Grouping: citationsToMarkers() writes one <w:r><w:t>{ marker}</w:t></w:r> per
     *    citation item. To round-trip correctly, adjacent markers (only XML markup between
     *    them, no text) must become a single Word field with multiple citationItems.
     *
     * 2. Spaces: buildWordField() starts with </w:t></w:r> to close the current text run.
     *    If the w:t being split lacks xml:space="preserve" and has a trailing space before
     *    the marker, OOXML processors trim that space. We fix this with a post-processing
     *    pass that adds xml:space="preserve" to any w:t ending with whitespace.
     */
    async markersToCitations(content) {
        this.log("Converting markers to citations");

        const markerRegex = /\{\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|}]*?)\s*\}/g;

        // First pass: collect all markers with their byte positions in content.
        // Store the raw regex groups so parseMarkerToCitationItem can be called once per marker
        // in the resolution pass (calling it here just to extract cite for formattedCitation).
        const allMatches = [];
        let match;
        while ((match = markerRegex.exec(content)) !== null) {
            const [fullMatch, prefix, citeRaw, locator, suffix, uri] = match;
            const { cite, suppressAuthor } = CitationUtils.parseMarkerToCitationItem(
                prefix, citeRaw, locator, suffix, uri
            );
            allMatches.push({
                fullMatch,
                start: match.index,
                end: match.index + fullMatch.length,
                // raw fields for the definitive parseMarkerToCitationItem call below
                prefix, citeRaw, locator, suffix, uri,
                // derived fields used for grouping and formattedCitation
                cite, suppressAuthor
            });
        }

        if (allMatches.length === 0) return content;

        // Group adjacent markers: two markers are adjacent when only XML markup (no text)
        // lies between them. citationsToMarkers() produces adjacent markers for multi-item
        // citations, and they must become a single Word field with multiple citationItems.
        const groups = [];
        let i = 0;
        while (i < allMatches.length) {
            const group = [allMatches[i]];
            let j = i + 1;
            while (j < allMatches.length) {
                const between = content.substring(group[group.length - 1].end, allMatches[j].start);
                if (between.replace(/<[^>]*>/g, '').trim() === '') {
                    group.push(allMatches[j]);
                    j++;
                } else {
                    break;
                }
            }
            groups.push({ markers: group, spanStart: group[0].start, spanEnd: group[group.length - 1].end });
            i = j;
        }

        // Resolve items and build one citationData per group
        const resolvedGroups = [];
        for (const group of groups) {
            const citationItems = [];
            for (const m of group.markers) {
                // Build base citationItem from the raw marker fields
                const { citationItem } = CitationUtils.parseMarkerToCitationItem(
                    m.prefix, m.citeRaw, m.locator, m.suffix, m.uri
                );
                // Replace the raw marker URI with the canonical Zotero URI if item is in library
                const item = await CitationUtils.getItemByURI(m.uri.trim());
                if (item) {
                    citationItem.uris = [await CitationUtils.buildItemURI(item)];
                } else {
                    this.log(`Warning: Item not found for URI: ${m.uri.trim()}, using URI directly`);
                }
                citationItems.push(citationItem);
            }

            const formattedCitation = group.markers[0].cite || "Citation";
            const citationData = {
                citationID: this.generateCitationID(),
                properties: { formattedCitation, plainCitation: formattedCitation },
                citationItems,
                schema: "https://github.com/citation-style-language/schema/raw/master/csl-citation.json"
            };
            resolvedGroups.push({ spanStart: group.spanStart, spanEnd: group.spanEnd, citationData, formattedCitation });
        }

        // Second pass: replace spans right-to-left so earlier positions stay valid
        let tempContent = content;
        for (let i = resolvedGroups.length - 1; i >= 0; i--) {
            const rg = resolvedGroups[i];
            const wordField = this.buildWordField(rg.citationData, rg.formattedCitation);
            tempContent = tempContent.substring(0, rg.spanStart) + wordField + tempContent.substring(rg.spanEnd);
        }

        // Fix spaces: add xml:space="preserve" to any w:t that ends with whitespace but
        // lacks the attribute, so that spaces before inserted Word fields are not trimmed.
        tempContent = tempContent.replace(/<w:t>([^<]*\s)<\/w:t>/g, '<w:t xml:space="preserve">$1</w:t>');

        this.log(`Converted ${allMatches.length} marker(s) into ${resolvedGroups.length} citation(s)`);
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

                // Extract all citation items
                if (!citationData.citationItems || citationData.citationItems.length === 0) {
                    this.log("Warning: No citation items found");
                    return fullMatch;
                }

                const cite = citationData.properties?.plainCitation || "";

                // Build one marker per citation item
                const markers = [];
                for (const citItem of citationData.citationItems) {
                    const marker = CitationUtils.buildMarkerForItem(citItem, cite);
                    if (marker) markers.push(marker);
                }

                if (markers.length === 0) return fullMatch;

                // Wrap all markers in Word text runs
                const markerXml = markers.map(m => `<w:r><w:t>${CitationUtils.escapeXml(m)}</w:t></w:r>`).join('');

                convertedCount++;
                this.log(`Converted citation to ${markers.length} marker(s)`);

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

                    const item = await CitationUtils.getItemByURI(uri);
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
                        let loc = citItem.locator;
                        // If locator is bare (starts with digit), prepend the label prefix.
                        // If it already contains the prefix (our stored format), use as-is.
                        if (/^\d/.test(loc)) {
                            loc = CitationUtils.labelToPandocLocator(label) + loc;
                        }
                        entry += ', ' + loc;
                    }

                    // Suffix
                    if (citItem.suffix) {
                        entry += ', ' + citItem.suffix;
                    }

                    pandocParts.push(entry);
                }

                if (pandocParts.length === 0) continue;

                const pandocCite = '[' + pandocParts.join('; ') + ']';
                const pandocXml = `<w:r><w:t>${CitationUtils.escapeXml(pandocCite)}</w:t></w:r>`;

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

    // labelToPandocLocator, markersToPandoc, getItemByURI moved to citationUtils.js

    /**
     * Build CSL citation data structure for an item
     * Only includes uri - Zotero will look up metadata when processing
     */
    async buildCitationData(item, cite, locator, suppress) {
        const uri = await CitationUtils.buildItemURI(item);

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
     * Build CSL citation data from a URI string alone (no item lookup).
     * Used as a fallback when the item isn't in the currently loaded library.
     * The Zotero Word plugin will resolve the item from the URI when it next
     * processes the document.
     */
    buildCitationDataFromURI(uri, cite, locator, suppress) {
        const citationItem = { uris: [uri] };
        if (locator) {
            citationItem.locator = locator;
            citationItem.label = "page";
        }
        if (suppress) {
            citationItem["suppress-author"] = true;
        }
        return {
            citationID: this.generateCitationID(),
            properties: {
                formattedCitation: cite,
                plainCitation: cite
            },
            citationItems: [citationItem],
            schema: "https://github.com/citation-style-language/schema/raw/master/csl-citation.json"
        };
    },

    /**
     * Build Word field XML for a citation
     * This creates a complete field structure with proper w:r (run) elements
     */
    buildWordField(citationData, formattedCitation) {
        const jsonStr = JSON.stringify(citationData);

        // Escape XML special characters in the JSON
        const escapedJson = CitationUtils.escapeXml(jsonStr);

        // Build Word field structure - each part must be in its own w:r element
        // The field structure is: begin -> instrText -> separate -> displayText -> end
        const field =
            `</w:t></w:r>` +  // Close the current text run
            `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:r><w:instrText xml:space="preserve"> ADDIN ZOTERO_ITEM CSL_CITATION ${escapedJson} </w:instrText></w:r>` +
            `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
            `<w:r><w:t>${CitationUtils.escapeXml(formattedCitation)}</w:t></w:r>` +
            `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
            `<w:r><w:t xml:space="preserve">`;  // Reopen a text run for any following content

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
                const citeEntries = CitationUtils.parsePandocCitationGroup(innerText);
                const markers = [];

                for (const entry of citeEntries) {
                    const item = await CitationUtils.findItemByCitationKey(entry.citekey);
                    if (!item) {
                        this.log(`Warning: Item not found for citationKey: ${entry.citekey}`);
                        notFoundKeys.push(entry.citekey);
                        continue;
                    }

                    const uri = await CitationUtils.buildItemURI(item);

                    let firstCreator = '';
                    let title = '';
                    let year = '';
                    try { firstCreator = (item.getField('firstCreator') || '').replace(/[\u2068\u2069]/g, ''); } catch(e) {}
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
     * Convert pandoc citations to scannable cite markers in plain text / ODF XML.
     * Unlike pandocToMarkers(), this does not parse Word XML runs — it works
     * directly on the string, suitable for ODF content.xml where citations
     * appear as uninterrupted plain text within <text:p> elements.
     *
     * Also handles author-in-text @key [loc] form.
     */
        /**
     * Convert pandoc citation groups directly to Zotero Word fields.
     * Multi-item groups like [@a; @b] become a single Word field with multiple
     * citationItems, matching how Zotero represents them natively.
     */
    async pandocToCitationsDirect(content) {
        this.log("Converting pandoc citations directly to Word fields");

        const paraRegex = /(<w:p[ >][\s\S]*?<\/w:p>)/g;
        let convertedCount = 0;
        const notFoundKeys = [];
        // Maps placeholder string → { citationData, formattedCitation }
        const groupFields = new Map();

        // First pass: find pandoc groups, resolve items, embed unique placeholders
        const withPlaceholders = await this.replaceAsync(content, paraRegex, async (paraXml) => {
            const runs = this.extractTextRuns(paraXml);
            if (runs.length === 0) return paraXml;

            let plainText = '';
            const charMap = [];
            for (let ri = 0; ri < runs.length; ri++) {
                for (let ci = 0; ci < runs[ri].text.length; ci++) {
                    charMap.push({ runIdx: ri, charIdx: ci });
                    plainText += runs[ri].text[ci];
                }
            }

            const pandocCiteRegex = /\[([^\[\]]*@[^\[\]]*)\]/g;
            let match;
            const citations = [];
            // Track all [..@..] ranges so author-in-text pass can skip them
            const bracketRanges = [];

            // Pass 1: bracket citation groups [see @key, p. 3; @key2]
            while ((match = pandocCiteRegex.exec(plainText)) !== null) {
                const innerText = match[1];
                const startIdx = match.index;
                const endIdx = match.index + match[0].length - 1;
                bracketRanges.push({ startIdx, endIdx });

                this.log(`Found pandoc citation group: ${match[0]}`);

                const citeEntries = CitationUtils.parsePandocCitationGroup(innerText);
                const citationItems = [];
                const formattedParts = [];

                for (const entry of citeEntries) {
                    const item = await CitationUtils.findItemByCitationKey(entry.citekey);
                    if (!item) {
                        this.log(`Warning: Item not found for citationKey: ${entry.citekey}`);
                        notFoundKeys.push(entry.citekey);
                        continue;
                    }

                    const uri = await CitationUtils.buildItemURI(item);
                    const citationItem = { uris: [uri] };
                    if (entry.locator) {
                        citationItem.locator = entry.locator;
                        citationItem.label = entry.label || "page";
                    }
                    if (entry.prefix) citationItem.prefix = entry.prefix;
                    if (entry.suffix) citationItem.suffix = entry.suffix;
                    if (entry.suppressAuthor) citationItem["suppress-author"] = true;
                    citationItems.push(citationItem);

                    let firstCreator = '';
                    let title = '';
                    let year = '';
                    try { firstCreator = (item.getField('firstCreator') || '').replace(/[\u2068\u2069]/g, ''); } catch(e) {}
                    try { title = item.getField('title') || ''; } catch(e) {}
                    try { year = item.getField('year') || ''; } catch(e) {
                        try { year = (item.getField('date') || '').match(/\d{4}/)?.[0] || ''; } catch(e2) {}
                    }
                    let readable = firstCreator;
                    if (title) readable += (readable ? ', ' : '') + title;
                    if (year) readable += ` (${year})`;
                    formattedParts.push(readable);
                    convertedCount++;
                }

                if (citationItems.length === 0) continue;

                const formattedCitation = formattedParts.join('; ');
                const citationData = {
                    citationID: this.generateCitationID(),
                    properties: { formattedCitation, plainCitation: formattedCitation },
                    citationItems,
                    schema: "https://github.com/citation-style-language/schema/raw/master/csl-citation.json"
                };

                const placeholder = `ZOTERO_PANDOC_${this.generateCitationID()}`;
                groupFields.set(placeholder, { citationData, formattedCitation });
                citations.push({
                    startIdx, endIdx,
                    startRun: charMap[startIdx].runIdx,
                    startChar: charMap[startIdx].charIdx,
                    endRun: charMap[endIdx].runIdx,
                    endChar: charMap[endIdx].charIdx,
                    replacement: placeholder
                });
            }

            // Pass 2: author-in-text  @key [locator]  or  @key
            // These appear outside brackets, e.g. "@smith [p. 3] argues"
            // Replace with: author-name plain text + suppress-author Word field
            const aitRegex = /@([\w][\w:.#$%&\-+?<>~/]*)(?:\s*\[([^\]]*)\])?/g;
            let aitMatch;
            while ((aitMatch = aitRegex.exec(plainText)) !== null) {
                const pos = aitMatch.index;
                // Skip @key inside any [..@..] bracket group
                if (bracketRanges.some(r => pos >= r.startIdx && pos <= r.endIdx)) continue;

                const citekey = aitMatch[1];
                const locatorText = aitMatch[2] || '';
                const startIdx = aitMatch.index;
                const endIdx = aitMatch.index + aitMatch[0].length - 1;

                const item = await CitationUtils.findItemByCitationKey(citekey);
                if (!item) {
                    this.log(`Warning: Item not found for author-in-text key: ${citekey}`);
                    notFoundKeys.push(citekey);
                    continue;
                }

                const uri = await CitationUtils.buildItemURI(item);
                let firstCreator = '';
                let year = '';
                try { firstCreator = (item.getField('firstCreator') || '').replace(/[\u2068\u2069]/g, ''); } catch(e) {}
                try { year = item.getField('year') || ''; } catch(e) {
                    try { year = (item.getField('date') || '').match(/\d{4}/)?.[0] || ''; } catch(e2) {}
                }

                const citationItem = { uris: [uri], "suppress-author": true };
                let locator = '';
                if (locatorText.trim()) {
                    const locatorInfo = CitationUtils.parsePandocLocator(locatorText.trim());
                    if (locatorInfo.locator) {
                        citationItem.locator = locatorInfo.locator;
                        citationItem.label = locatorInfo.label;
                        locator = locatorInfo.locator;
                    }
                }

                const formattedCitation = year
                    ? `(${year}${locator ? ', ' + locator : ''})`
                    : '';
                const citationData = {
                    citationID: this.generateCitationID(),
                    properties: { formattedCitation, plainCitation: formattedCitation },
                    citationItems: [citationItem],
                    schema: "https://github.com/citation-style-language/schema/raw/master/csl-citation.json"
                };

                const placeholder = `ZOTERO_PANDOC_${this.generateCitationID()}`;
                groupFields.set(placeholder, {
                    type: 'authorInText',
                    authorName: firstCreator,
                    citationData,
                    formattedCitation
                });
                citations.push({
                    startIdx, endIdx,
                    startRun: charMap[startIdx].runIdx,
                    startChar: charMap[startIdx].charIdx,
                    endRun: charMap[endIdx].runIdx,
                    endChar: charMap[endIdx].charIdx,
                    replacement: placeholder
                });
                convertedCount++;
            }

            if (citations.length === 0) return paraXml;

            citations.reverse();
            for (const cite of citations) {
                const startRun = cite.startRun;
                const endRun = cite.endRun;

                if (startRun === endRun) {
                    const run = runs[startRun];
                    const before = run.text.substring(0, cite.startChar);
                    const after = run.text.substring(cite.endChar + 1);
                    run.text = before + cite.replacement + after;
                } else {
                    const beforeText = runs[startRun].text.substring(0, cite.startChar);
                    const afterText = runs[endRun].text.substring(cite.endChar + 1);
                    runs[startRun].text = beforeText + cite.replacement + afterText;
                    for (let i = startRun + 1; i <= endRun; i++) {
                        runs[i].remove = true;
                    }
                }
            }

            return this.rebuildParagraph(paraXml, runs);
        });

        // Second pass: replace placeholders with Word fields
        let result = withPlaceholders;
        for (const [placeholder, group] of groupFields) {
            let wordField;
            if (group.type === 'authorInText') {
                // Author name goes as plain text, with a space before the suppress-author field
                wordField = group.authorName + ' ' + this.buildWordField(group.citationData, group.formattedCitation);
            } else {
                wordField = this.buildWordField(group.citationData, group.formattedCitation);
            }
            result = result.replace(placeholder, wordField);
        }

        if (notFoundKeys.length > 0) {
            this.log(`Warning: ${notFoundKeys.length} citation keys not found: ${notFoundKeys.join(', ')}`);
        }
        this.log(`Converted ${convertedCount} pandoc citations to Word fields`);
        return result;
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
                        const escapedText = CitationUtils.escapeXml(run.text);
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
        /**
     * Parse a pandoc locator string (text after citekey comma)
     * Recognizes: p., pp., ch., chap., chapter, sec., vol., etc.
     * Returns { locator, label, suffix } where label is the CSL term
     * (e.g. "chapter") and locator is the display string (e.g. "ch. 3").
     */
        /**
     * Search Zotero for an item by its citationKey field
     */
        /**
     * Convert a full HTTP Zotero URI to the short zu:/zg: form that rtfScan.js
     * markers require, without needing a live item lookup.
     */
        /**
     * Build the short-form URI for an item as expected by rtfScan.js markers.
     * Format: zu:LIB:KEY (user library) or zg:LIB:KEY (group library)
     * where LIB is 0 for the local user library, the numeric userID for synced,
     * or the numeric groupID for group libraries.
     */
        /**
     * Build the Zotero URI for an item (shared helper)
     */
        /**
     * Escape XML special characters
     */
    };

if (typeof module !== 'undefined') module.exports = DOCXConverter;
