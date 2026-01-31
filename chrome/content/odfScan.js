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
 * @fileOverview ODF Scan dialog
 */

var { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');

var Zotero_ODFScanDialog = {
    inputFile: null,
    outputFile: null,

    async init() {
        Zotero.debug("ODF Scan Dialog: Initializing");

        // Create stub methods that rtfScan.js expects on document.documentElement
        document.documentElement.canAdvance = false;
        document.documentElement.canRewind = false;
        document.documentElement.advance = () => {
            Zotero.debug("ODF Scan Dialog: Conversion complete (advance called)");
            this.conversionComplete = true;
        };
        document.documentElement.rewind = () => {
            Zotero.debug("ODF Scan Dialog: Conversion failed (rewind called)");
            this.conversionFailed = true;
        };

        // Attach file picker button event listeners
        document.getElementById("choose-input-file")
            .addEventListener('click', this.onChooseInputFile.bind(this));
        document.getElementById("choose-output-file")
            .addEventListener('click', this.onChooseOutputFile.bind(this));
        document.getElementById("process-button")
            .addEventListener('click', this.processDocument.bind(this));

        // Restore last used paths
        try {
            let lastInputFile = Zotero.Prefs.get("ODFScan.odf.lastInputFile");
            if (lastInputFile) {
                this.inputFile = Zotero.File.pathToFile(lastInputFile);
            }
            let lastOutputFile = Zotero.Prefs.get("ODFScan.odf.lastOutputFile");
            if (lastOutputFile) {
                this.outputFile = Zotero.File.pathToFile(lastOutputFile);
            }
        } catch (e) {
            Zotero.debug("ODF Scan Dialog: Error loading prefs: " + e);
        }

        await this.updateUI();

        Zotero.debug("ODF Scan Dialog: Initialized");
    },

    async onChooseInputFile(ev) {
        Zotero.debug("ODF Scan: Choosing input file");

        if (ev.type === 'keydown' && ev.key !== ' ') {
            return;
        }
        ev.stopPropagation();

        try {
            const fp = new FilePicker();
            fp.init(window, "Select input file", fp.modeOpen);
            fp.appendFilter("Supported Documents", "*.odt;*.fodt;*.docx");
            fp.appendFilter("ODF Documents", "*.odt;*.fodt");
            fp.appendFilter("DOCX Documents", "*.docx");
            fp.appendFilters(fp.filterAll);

            const rv = await fp.show();
            if (rv == fp.returnOK || rv == fp.returnReplace) {
                this.inputFile = Zotero.File.pathToFile(fp.file);
                Zotero.Prefs.set("ODFScan.odf.lastInputFile", fp.file);
                await this.updateUI();
            }
        } catch (e) {
            Zotero.debug("ODF Scan: Error choosing input file: " + e);
            this.showError("Error selecting file: " + e);
        }
    },

    async onChooseOutputFile(ev) {
        Zotero.debug("ODF Scan: Choosing output file");

        if (ev.type === 'keydown' && ev.key !== ' ') {
            return;
        }
        ev.stopPropagation();

        try {
            const fp = new FilePicker();
            fp.init(window, "Select output file", fp.modeSave);
            fp.appendFilter("Supported Documents", "*.odt;*.fodt;*.docx");
            fp.appendFilter("ODF Documents", "*.odt;*.fodt");
            fp.appendFilter("DOCX Documents", "*.docx");

            // Suggest a default name based on input file
            if (this.inputFile) {
                let leafName = this.inputFile.leafName;
                let dotIndex = leafName.lastIndexOf(".");
                let extension = dotIndex !== -1 ? leafName.substr(dotIndex) : ".odt";
                let baseName = dotIndex !== -1 ? leafName.substr(0, dotIndex) : leafName;
                fp.defaultString = baseName + " (converted)" + extension;
            } else {
                fp.defaultString = "Untitled.odt";
            }

            const rv = await fp.show();
            if (rv == fp.returnOK || rv == fp.returnReplace) {
                this.outputFile = Zotero.File.pathToFile(fp.file);
                Zotero.Prefs.set("ODFScan.odf.lastOutputFile", fp.file);
                await this.updateUI();
            }
        } catch (e) {
            Zotero.debug("ODF Scan: Error choosing output file: " + e);
            this.showError("Error selecting file: " + e);
        }
    },

    async updateUI() {
        let inputBox = document.getElementById('input-path');
        let outputBox = document.getElementById('output-path');
        let processButton = document.getElementById('process-button');

        if (inputBox) {
            inputBox.value = this.inputFile ? this.inputFile.path : "No file selected";
        }
        if (outputBox) {
            outputBox.value = this.outputFile ? this.outputFile.path : "No file selected";
        }
        if (processButton) {
            processButton.disabled = !(this.inputFile && this.outputFile);
        }

        // Hide status box when files change
        this.hideStatus();
    },

    async processDocument() {
        Zotero.debug("ODF Scan: Starting document processing");

        try {
            this.showStatus("Processing...", "Scanning document for citations...", false);

            // Disable the process button during processing
            let processButton = document.getElementById('process-button');
            processButton.disabled = true;

            // Get conversion direction and detect file type
            let outputMode = this.getConversionDirection();
            let fileType = this.getFileType();
            Zotero.debug(`ODF Scan: File type: ${fileType}, direction: ${outputMode}`);

            // Set up globals that the conversion code expects
            window.inputFile = this.inputFile.path;
            window.outputFile = this.outputFile.path;

            // Reset completion flags
            window.DOCXScanComplete = false;
            window.DOCXScanFailed = false;
            this.conversionComplete = false;
            this.conversionFailed = false;

            // Route to appropriate converter
            if (fileType === 'docx') {
                await this.processDOCX(outputMode);
            } else {
                await this.processODF(outputMode);
            }

        } catch (e) {
            Zotero.debug("ODF Scan: Error during processing: " + e);
            this.showError("Error processing document: " + e);
            let processButton = document.getElementById('process-button');
            processButton.disabled = false;
        }
    },

    getConversionDirection() {
        const radioGroup = document.getElementById('conversion-direction');
        const selectedRadio = radioGroup.selectedItem;
        return selectedRadio ? selectedRadio.value : 'tocitations';
    },

    getFileType() {
        // Detect file type from input file extension
        if (!this.inputFile) return 'odf';
        const fileName = this.inputFile.leafName.toLowerCase();
        if (fileName.endsWith('.docx')) {
            return 'docx';
        }
        return 'odf'; // Default to ODF for .odt, .fodt, etc.
    },

    async processDOCX(outputMode) {
        try {
            // Load the DOCX conversion module
            if (typeof window.DOCXScanConvert === 'undefined') {
                Services.scriptloader.loadSubScript("chrome://odf-scan/content/docxScan.js", window);
            }

            Zotero.debug(`ODF Scan: Starting DOCX conversion (${outputMode})`);
            await window.DOCXScanConvert.scanDOCX(outputMode);

            // Check completion status
            if (window.DOCXScanComplete) {
                this.showStatus("Success!",
                    `Document processed successfully.\nOutput saved to: ${window.outputFile}`,
                    true);
            } else if (window.DOCXScanFailed) {
                this.showError("Conversion failed. Please check the debug log for details.");
            } else {
                this.showStatus("Processing complete",
                    `Output saved to: ${window.outputFile}`,
                    true);
            }

            let processButton = document.getElementById('process-button');
            processButton.disabled = false;

        } catch (e) {
            Zotero.debug("ODF Scan: Error during DOCX conversion: " + e);
            this.showError("Error processing DOCX document: " + e);
            let processButton = document.getElementById('process-button');
            processButton.disabled = false;
        }
    },

    async processODF(outputMode) {
        try {
            // Load the ODF conversion module
            if (typeof window.ODFScanConvert === 'undefined') {
                Services.scriptloader.loadSubScript("chrome://odf-scan/content/odfConvert.js", window);
            }

            if (outputMode === 'pandoctocitations') {
                // Pandoc mode: async pre-processing, then ODF scan
                try {
                    await window.ODFScanConvert.pandocToODF();

                    // Wait for the ODF scan completion flags
                    setTimeout(() => {
                        if (this.conversionComplete) {
                            this.showStatus("Success!",
                                `Document processed successfully.\nOutput saved to: ${window.outputFile}`,
                                true);
                        } else if (this.conversionFailed) {
                            this.showError("Conversion failed. Please check the debug log for details.");
                        } else {
                            this.showStatus("Processing complete",
                                `Output saved to: ${window.outputFile}`,
                                true);
                        }

                        let processButton = document.getElementById('process-button');
                        processButton.disabled = false;
                    }, 200);

                } catch (e) {
                    Zotero.debug("ODF Scan: Error during pandoc-to-ODF conversion: " + e);
                    this.showError("Error processing pandoc citations: " + e);
                    let processButton = document.getElementById('process-button');
                    processButton.disabled = false;
                }
                return;
            }

            if (outputMode === 'topandoc') {
                // Two-step: ODF citations → markers → pandoc syntax
                try {
                    await window.ODFScanConvert.citationsToPandocODF();

                    // Wait for the ODF scan completion flags (tomarkers step)
                    setTimeout(() => {
                        if (this.conversionComplete) {
                            this.showStatus("Success!",
                                `Document processed successfully.\nOutput saved to: ${window.outputFile}`,
                                true);
                        } else if (this.conversionFailed) {
                            this.showError("Conversion failed. Please check the debug log for details.");
                        } else {
                            this.showStatus("Processing complete",
                                `Output saved to: ${window.outputFile}`,
                                true);
                        }

                        let processButton = document.getElementById('process-button');
                        processButton.disabled = false;
                    }, 200);

                } catch (e) {
                    Zotero.debug("ODF Scan: Error during citations-to-pandoc conversion: " + e);
                    this.showError("Error converting to pandoc citations: " + e);
                    let processButton = document.getElementById('process-button');
                    processButton.disabled = false;
                }
                return;
            }

            // Run conversion asynchronously (ODF conversion is synchronous but uses setTimeout)
            setTimeout(() => {
                try {
                    window.ODFScanConvert.scanODF(outputMode);

                    // Wait a moment for the conversion to set the completion flags
                    setTimeout(() => {
                        if (this.conversionComplete) {
                            this.showStatus("Success!",
                                `Document processed successfully.\nOutput saved to: ${window.outputFile}`,
                                true);
                        } else if (this.conversionFailed) {
                            this.showError("Conversion failed. Please check the debug log for details.");
                        } else {
                            this.showStatus("Processing complete",
                                `Output saved to: ${window.outputFile}`,
                                true);
                        }

                        let processButton = document.getElementById('process-button');
                        processButton.disabled = false;
                    }, 200);

                } catch (e) {
                    Zotero.debug("ODF Scan: Error during ODF conversion: " + e);
                    this.showError("Error processing document: " + e);
                    let processButton = document.getElementById('process-button');
                    processButton.disabled = false;
                }
            }, 100);

        } catch (e) {
            Zotero.debug("ODF Scan: Error loading ODF converter: " + e);
            this.showError("Error loading ODF converter: " + e);
            let processButton = document.getElementById('process-button');
            processButton.disabled = false;
        }
    },

    showStatus(message, details, isSuccess) {
        let statusBox = document.getElementById('status-box');
        let statusMessage = document.getElementById('status-message');
        let statusDetails = document.getElementById('status-details');

        if (statusBox && statusMessage && statusDetails) {
            statusBox.hidden = false;
            statusMessage.value = message;
            statusDetails.textContent = details;

            // Style based on success/error
            if (isSuccess) {
                statusBox.style.backgroundColor = "#e8f5e9";
                statusBox.style.borderColor = "#4caf50";
                statusMessage.style.color = "#2e7d32";
            } else {
                statusBox.style.backgroundColor = "#fff3e0";
                statusBox.style.borderColor = "#ff9800";
                statusMessage.style.color = "#e65100";
            }
        }
    },

    showError(message) {
        let statusBox = document.getElementById('status-box');
        let statusMessage = document.getElementById('status-message');
        let statusDetails = document.getElementById('status-details');

        if (statusBox && statusMessage && statusDetails) {
            statusBox.hidden = false;
            statusBox.style.backgroundColor = "#ffebee";
            statusBox.style.borderColor = "#f44336";
            statusMessage.style.color = "#c62828";
            statusMessage.value = "Error";
            statusDetails.textContent = message;
        }
    },

    hideStatus() {
        let statusBox = document.getElementById('status-box');
        if (statusBox) {
            statusBox.hidden = true;
        }
    }
};
