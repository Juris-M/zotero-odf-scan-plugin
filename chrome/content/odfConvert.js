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
 * @fileOverview ODF conversion module - extracted from rtfScan.js
 * This module provides the core ODF conversion functionality
 * It expects global variables: inputFile and outputFile
 */

var ODFScanConvert = {
    scanODF: function(outputMode) {
        Zotero.debug("ODFScanConvert: Starting ODF conversion");
        Zotero.debug(`ODFScanConvert: inputFile = ${window.inputFile}`);
        Zotero.debug(`ODFScanConvert: outputFile = ${window.outputFile}`);
        Zotero.debug(`ODFScanConvert: outputMode = ${outputMode}`);

        // Load the full rtfScan.js which contains all the conversion logic
        // The rtfScan.js file uses global inputFile and outputFile variables
        if (typeof Zotero_ODFScan === 'undefined') {
            Zotero.debug("ODFScanConvert: Loading rtfScan.js");
            Services.scriptloader.loadSubScript("chrome://odf-scan/content/rtfScan.js", window);
        }

        // Call the exposed runODFScan function which wraps the private _scanODF
        Zotero.debug("ODFScanConvert: Calling Zotero_ODFScan.runODFScan");
        return Zotero_ODFScan.runODFScan(outputMode);
    },

    /**
     * Pre-process an ODF file to convert pandoc citations to scannable cite markers,
     * then run the normal ODF scan to convert markers to Zotero citations.
     */
    pandocToODF: async function() {
        Zotero.debug("ODFScanConvert: Starting pandoc-to-ODF conversion");

        // Load DOCX scan module for shared pandoc parsing functions
        if (typeof window.DOCXScanConvert === 'undefined') {
            Services.scriptloader.loadSubScript("chrome://odf-scan/content/docxScan.js", window);
        }

        const inputPath = window.inputFile;
        const outputPath = window.outputFile;
        const inputFile = Zotero.File.pathToFile(inputPath);
        const fileName = inputFile.leafName.toLowerCase();

        // Determine if this is a flat ODF (.fodt) or packaged ODF (.odt)
        const isFlat = fileName.endsWith('.fodt');

        let content;

        if (isFlat) {
            // Flat ODF: read directly
            content = await Zotero.File.getContentsAsync(inputPath);
        } else {
            // Packaged ODF (.odt): extract content.xml from ZIP
            const zipReader = Components.classes["@mozilla.org/libjar/zip-reader;1"]
                .createInstance(Components.interfaces.nsIZipReader);
            zipReader.open(inputFile);
            try {
                const stream = zipReader.getInputStream("content.xml");
                const converterStream = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
                    .createInstance(Components.interfaces.nsIConverterInputStream);
                converterStream.init(stream, "UTF-8", 0, 0);
                content = "";
                let str = {};
                while (converterStream.readString(4096, str) !== 0) {
                    content += str.value;
                }
                converterStream.close();
                stream.close();
            } finally {
                zipReader.close();
            }
        }

        Zotero.debug("ODFScanConvert: Loaded ODF content, length: " + content.length);

        // Convert pandoc citations to scannable cite markers
        content = await window.DOCXScanConvert.pandocToMarkers(content);

        if (isFlat) {
            // Write modified content to a temp file and use it as input for ODF scan
            const tempFlatFile = Zotero.getTempDirectory();
            tempFlatFile.append("odf-pandoc-flat.fodt");
            Zotero.File.putContents(tempFlatFile, content);
            window.inputFile = tempFlatFile.path;
        } else {
            // Write modified content.xml back into the ODF ZIP
            // Copy original to output first, then modify
            const outputFile = Zotero.File.pathToFile(outputPath);

            // Copy input to output
            if (outputFile.exists()) outputFile.remove(false);
            inputFile.copyTo(outputFile.parent, outputFile.leafName);

            // Write modified content.xml to temp file
            const tempFile = Zotero.getTempDirectory();
            tempFile.append("odf-pandoc-content.xml");
            Zotero.File.putContents(tempFile, content);

            // Replace content.xml in the output ZIP
            const zipWriter = Components.classes["@mozilla.org/zipwriter;1"]
                .createInstance(Components.interfaces.nsIZipWriter);
            zipWriter.open(outputFile, 0x04); // RDWR
            try {
                zipWriter.removeEntry("content.xml", false);
                zipWriter.addEntryFile("content.xml", 9, tempFile, false);
            } finally {
                zipWriter.close();
            }

            if (tempFile.exists()) tempFile.remove(false);

            // Now point inputFile to the output (which has markers) for the ODF scan
            window.inputFile = outputPath;
        }

        Zotero.debug("ODFScanConvert: Pandoc markers inserted, running ODF scan");

        // Now run normal ODF scan to convert markers to citations
        return this.scanODF("tocitations");
    },

    /**
     * Convert Zotero citations in an ODF file to pandoc citation syntax.
     * Two-step: first convert citations to scannable cite markers (via rtfScan.js),
     * then convert those markers to pandoc [@citekey] syntax.
     */
    citationsToPandocODF: async function() {
        Zotero.debug("ODFScanConvert: Starting citations-to-pandoc conversion");

        // Load DOCX scan module for markersToPandoc()
        if (typeof window.DOCXScanConvert === 'undefined') {
            Services.scriptloader.loadSubScript("chrome://odf-scan/content/docxScan.js", window);
        }

        // Step 1: Run ODF scan in tomarkers mode to convert citations to markers
        // We need to save the original output path and use a temp file
        const originalOutputPath = window.outputFile;
        const inputPath = window.inputFile;
        const inputFile = Zotero.File.pathToFile(inputPath);
        const fileName = inputFile.leafName.toLowerCase();
        const isFlat = fileName.endsWith('.fodt');

        // Run the tomarkers conversion - this writes to window.outputFile
        this.scanODF("tomarkers");

        // Wait for the conversion to complete
        await new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (document.documentElement.canAdvance || document.documentElement.canRewind) {
                    clearInterval(checkInterval);
                    if (document.documentElement.canRewind) {
                        reject(new Error("ODF tomarkers conversion failed"));
                    } else {
                        resolve();
                    }
                }
            }, 100);
            // Timeout after 30 seconds
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve(); // Try to continue anyway
            }, 30000);
        });

        // Step 2: Read the output file (which now has markers) and convert markers to pandoc
        const outputFile = Zotero.File.pathToFile(originalOutputPath);

        let content;
        if (isFlat) {
            content = await Zotero.File.getContentsAsync(originalOutputPath);
        } else {
            // Extract content.xml from the output ODF ZIP
            const zipReader = Components.classes["@mozilla.org/libjar/zip-reader;1"]
                .createInstance(Components.interfaces.nsIZipReader);
            zipReader.open(outputFile);
            try {
                const stream = zipReader.getInputStream("content.xml");
                const converterStream = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
                    .createInstance(Components.interfaces.nsIConverterInputStream);
                converterStream.init(stream, "UTF-8", 0, 0);
                content = "";
                let str = {};
                while (converterStream.readString(4096, str) !== 0) {
                    content += str.value;
                }
                converterStream.close();
                stream.close();
            } finally {
                zipReader.close();
            }
        }

        // Convert markers to pandoc syntax
        content = await window.DOCXScanConvert.markersToPandoc(content);

        // Write back
        if (isFlat) {
            Zotero.File.putContents(outputFile, content);
        } else {
            // Write modified content.xml back into the ODF ZIP
            const tempFile = Zotero.getTempDirectory();
            tempFile.append("odf-pandoc-content.xml");
            Zotero.File.putContents(tempFile, content);

            const zipWriter = Components.classes["@mozilla.org/zipwriter;1"]
                .createInstance(Components.interfaces.nsIZipWriter);
            zipWriter.open(outputFile, 0x04); // RDWR
            try {
                zipWriter.removeEntry("content.xml", false);
                zipWriter.addEntryFile("content.xml", 9, tempFile, false);
            } finally {
                zipWriter.close();
            }

            if (tempFile.exists()) tempFile.remove(false);
        }

        Zotero.debug("ODFScanConvert: Citations converted to pandoc syntax");
    }
};
