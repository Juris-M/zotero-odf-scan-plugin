# Testing Guide for Zotero 7/8 ODF Scan Plugin

## Build the Plugin

1. **Run the build script**:
   ```bash
   python build.py
   ```
   This should create an XPI file.

2. **If build.py doesn't work with the new structure**, manually create the XPI:
   ```bash
   # On Linux/Mac:
   zip -r odf-scan.xpi * -x "*.git*" -x "node_modules/*" -x "*.md"

   # On Windows (PowerShell):
   Compress-Archive -Path * -DestinationPath odf-scan.xpi -Exclude .git*,node_modules,*.md
   ```

## Install in Zotero 7/8

1. Open Zotero 7 or 8 beta
2. Go to **Tools → Add-ons**
3. Click the gear icon ⚙️
4. Select **Install Add-on From File...**
5. Choose the `odf-scan.xpi` file
6. Restart Zotero if prompted

## Testing Checklist

### Basic Functionality

- [ ] **Plugin Loads**: No errors in Error Console (Tools → Developer → Error Console)
- [ ] **Menu Item Appears**: Check Tools menu for "ODF Scan" menu item
- [ ] **Dialog Opens**: Click ODF Scan menu item, dialog should open
- [ ] **Translator Installed**: Check for "Scannable Cite" in translators list

### File Selection (ODF to Citations Mode)

- [ ] **Select Input File**:
  - Click "Choose File..." for input
  - Select an ODT file
  - Path should display correctly

- [ ] **Select Output File**:
  - Click "Choose File..." for output
  - Specify output ODT file name
  - Path should display correctly

### ODF to Citations Conversion

1. **Prepare Test Document**:
   Create a test ODT file with citation markers like:
   ```
   { | Smith, A Title (2003) | p. 33 | | zotero://select/items/0_ITEMKEY }
   ```
   (Replace ITEMKEY with an actual item key from your library)

2. **Run Conversion**:
   - [ ] Select test file as input
   - [ ] Specify output file
   - [ ] Click through wizard
   - [ ] Conversion completes without errors
   - [ ] Output file created successfully

3. **Verify Output**:
   - [ ] Open output ODT in LibreOffice/Word
   - [ ] Citation markers converted to Zotero citations
   - [ ] Citations are active (can refresh in Zotero)

### ODF to Markers Conversion (Reverse)

1. **Prepare Test Document**:
   Create an ODT with existing Zotero citations

2. **Run Reverse Conversion**:
   - [ ] Switch to "ODF (to markers)" mode
   - [ ] Select file with Zotero citations
   - [ ] Specify output file
   - [ ] Conversion completes
   - [ ] Output file has scannable cite markers

3. **Verify Output**:
   - [ ] Citations converted back to marker format
   - [ ] Markers are correctly formatted
   - [ ] Can re-convert markers back to citations

### Error Handling

- [ ] **Invalid File**: Select non-ODT file, should show error
- [ ] **Missing Item**: Citation with invalid key, check error handling
- [ ] **Corrupt ODT**: Test with malformed ODT, should fail gracefully

### Preferences

- [ ] **Last File Paths**: Close and reopen dialog, paths should persist
- [ ] **Mode Selection**: Switch modes, preferences should save
- [ ] **Translator Preferences**: Check Zotero preferences for ODFScan settings

## Common Issues & Solutions

### Plugin Doesn't Load

**Check Error Console** (Tools → Developer → Error Console):
- Look for JavaScript errors
- Note: Some XPCOM deprecation warnings are expected but shouldn't break functionality

**Common Errors**:
- `FilePicker is not defined`: FilePicker API may have changed
- `Services is not defined`: Missing Services import
- ZIP-related errors: nsIZipReader/Writer compatibility issue

### Menu Item Not Appearing

1. Check if "RTF Scan" menu item exists (plugin looks for it)
2. Verify bootstrap.js is loading (check console)
3. Try restarting Zotero with console open

### Dialog Opens But Doesn't Function

1. Check for XUL compatibility issues
2. Verify file picker shows properly
3. Check if Zotero.File APIs are available

### Conversion Fails

1. Check file format (must be ODT)
2. Verify Zotero items exist for cited keys
3. Check ZIP operations in console
4. Ensure write permissions on output location

## Debug Mode

Enable detailed logging:

1. Open Zotero Config Editor (Settings → Advanced → Config Editor)
2. Set `extensions.zotero.debug.log` to `true`
3. Restart Zotero
4. Check Debug Output (Help → Debug Output Logging)

## Reporting Issues

If you encounter problems, please report:

1. **Environment**:
   - Zotero version (7.x or 8.x)
   - Operating System
   - Plugin version

2. **Error Details**:
   - Error console output
   - Debug log (if enabled)
   - Steps to reproduce

3. **Test Files**:
   - Sample ODT file (if possible)
   - Citation format used

## Expected Behavior

### What Should Work

✅ Plugin loads without critical errors
✅ Menu item appears and dialog opens
✅ File selection works (both input/output)
✅ ODF → Citations conversion
✅ Citations → Markers (reverse) conversion
✅ Translator installation
✅ Preference persistence

### Known Limitations

⚠️ Some XPCOM deprecation warnings (cosmetic, doesn't affect function)
⚠️ XUL wizard uses legacy format (still supported)
⚠️ Localization uses .properties/.dtd (still supported)
⚠️ nsIZipReader/Writer XPCOM (no modern alternative available)

### What Requires Further Work

🔄 Fluent localization migration (optional improvement)
🔄 XUL → XHTML conversion (optional improvement)
🔄 Modern ZIP API (if Zotero provides one in future)

## Success Criteria

The plugin is considered functional if:
1. ✅ Loads without breaking Zotero
2. ✅ Menu item accessible
3. ✅ Dialog functional
4. ✅ File I/O works correctly
5. ✅ Conversion completes successfully
6. ✅ Output files are valid ODT documents
7. ✅ Citations work properly in Zotero

Minor warnings or cosmetic issues are acceptable for initial testing.
