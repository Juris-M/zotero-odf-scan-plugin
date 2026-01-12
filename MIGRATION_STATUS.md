# Zotero 7/8 Migration Status

## Completed Tasks

### 1. Updated manifest.json
- ✅ Set `manifest_version: 2`
- ✅ Updated version to 2.0.48 (matching package.json)
- ✅ Added `homepage_url`
- ✅ Removed deprecated Juris-M application section
- ✅ Updated version compatibility: `strict_min_version: "7.0"` and `strict_max_version: "8.0.*"`
- **File**: [manifest.json](manifest.json)

### 2. Modernized bootstrap.js
- ✅ Removed deprecated `Components.classes/interfaces/utils` (XPCOM) imports
- ✅ Implemented new Zotero 7/8 lifecycle hooks:
  - `async install()` - handles translator installation
  - `async startup({ id, version, rootURI })` - main initialization
  - `onMainWindowLoad({ window })` - adds UI to new windows
  - `onMainWindowUnload({ window })` - cleanup on window close
  - `shutdown()` - cleanup on plugin disable
  - `uninstall()` - final cleanup
- ✅ Used modern `Zotero.debug()` for logging
- ✅ Updated preference API to handle both old and new methods
- **File**: [bootstrap.js](bootstrap.js)

### 3. Created Modern Plugin Initialization (odfScan.js)
- ✅ Created singleton pattern following make-it-red example
- ✅ Implemented `addToWindow()`/`removeFromWindow()` pattern
- ✅ Menu integration using `createXULElement()` and event listeners
- ✅ Proper tracking of added DOM elements for cleanup
- ✅ Opens dialog with modern API
- **File**: [chrome/content/odfScan.js](chrome/content/odfScan.js)

### 4. Updated rtfScan.js File I/O APIs
- ✅ Updated FilePicker usage for Zotero 7/8
- ✅ Replaced `Zotero.File.pathToFile()` usage with string paths where appropriate
- ✅ Updated file path handling to support both string and object formats
- ✅ Kept nsIZipReader/Writer (still functional in Zotero 7/8)
- ✅ Replaced deprecated stringbundle XPCOM with `Services.strings`
- ✅ Updated `DOMParser` to use native constructor instead of XPCOM
- ✅ Updated path handling in file selection dialogs
- **File**: [chrome/content/rtfScan.js](chrome/content/rtfScan.js)

**Note**: While nsIZipReader/Writer uses XPCOM, these are still the standard APIs in Zotero 7/8 for ZIP operations. The code now properly wraps them with try/finally for cleanup.

## Remaining Tasks

### 5. Update XUL Dialog (rtfScan.xul) - MEDIUM PRIORITY
**Current Status**: The XUL file uses deprecated DTD entities and old XUL namespace.

**What Needs to Be Done**:
- Convert `<!DOCTYPE window SYSTEM>` DTD references to Fluent
- Update namespace to use modern XHTML with XUL elements
- Replace entity references (`&zotero.rtfScan.title;`) with Fluent data-l10n-id
- Update `<wizard>` element (check if still supported in Zotero 7/8)
- Consider converting to `<dialog>` if wizard is deprecated

**Files Affected**:
- [chrome/content/rtfScan.xul](chrome/content/rtfScan.xul)
- [chrome/content/about.xul](chrome/content/about.xul) (if used)
- [chrome/content/options.xul](chrome/content/options.xul) (if used)

### 6. Migrate Localization to Fluent - MEDIUM PRIORITY
**Current Status**: Using deprecated .dtd and .properties files

**What Needs to Be Done**:
- Create `locale/en-US/odf-scan.ftl` file
- Convert all DTD entities from [chrome/locale/en-US/zotero.dtd](chrome/locale/en-US/zotero.dtd)
- Convert all .properties strings from [chrome/locale/en-US/zotero.properties](chrome/locale/en-US/zotero.properties)
- Load FTL in XUL files using `MozXULElement.insertFTLIfNeeded()`
- Update all UI references to use `data-l10n-id` attributes

**Files to Create**:
- `locale/en-US/odf-scan.ftl`

**Files to Update**:
- All XUL files to reference Fluent strings

### 7. Update chrome.manifest - LOW PRIORITY
**Current Status**: Standard chrome manifest, but should verify compatibility

**What Needs to Be Done**:
- Verify that chrome:// protocol registration still works in Zotero 7/8
- Check if resource:// registration is correct
- Update locale references if migrating to Fluent

**File**: [chrome.manifest](chrome.manifest)

### 8. Test and Debug - REQUIRED BEFORE RELEASE
**After completing above tasks**:
- Install in Zotero 7/8 beta
- Test menu item appears in Tools menu
- Test ODF scan dialog opens
- Test file selection dialogs
- Test ODF to citations conversion
- Test ODF to markers conversion
- Test translator installation
- Check for console errors

## Key API Changes Reference

### Deprecated → Modern
- `Components.*` → Zotero native APIs
- `Cu.import()` → ES6 imports or Services.*
- `nsIFile` → `PathUtils` / `IOUtils`
- `nsIZipReader/Writer` → Modern async ZIP APIs
- DTD/Properties → Fluent (.ftl)
- `watchWindows()` → `onMainWindowLoad()`
- Legacy XPCOM → Native Zotero APIs

## Reference Documentation
- Make-it-red plugin: `../make-it-red/src-2.0/`
- Plugin dev docs: `../zotero-plugin-dev/`
- Zotero 7 plugin guide: https://www.zotero.org/support/dev/zotero_7_for_developers

## Next Steps

1. **Priority 1**: ✅ COMPLETED - Update file I/O in rtfScan.js
2. **Priority 2**: OPTIONAL - Convert localization to Fluent (old format still works)
3. **Priority 3**: OPTIONAL - Update XUL dialog markup (current format still works)
4. **Priority 4**: **READY FOR TESTING** - Test thoroughly in Zotero 7/8

## Notes
- The core scanning logic in rtfScan.js is sound and should work once APIs are updated
- The translator file may need updates if Zotero's translator API changed
- Consider adding a build script (currently uses Python build.py)
