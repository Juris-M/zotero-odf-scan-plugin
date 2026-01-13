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
    }
};
