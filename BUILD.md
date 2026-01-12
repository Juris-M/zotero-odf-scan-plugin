# Building ODF Scan Plugin

## Quick Start

### Option 1: Python Build Script (Recommended)

```bash
python build.py
```

This will:
- Create `zotero-odf-scan-v2.0.48.xpi`
- Include only necessary files (no node_modules, etc.)
- Sync version from package.json to manifest.json

**For beta builds:**
```bash
python build.py --beta
```

**For releases (updates updates.json):**
```bash
python build.py --release
```

### Option 2: Shell Script (Linux/Mac)

```bash
./build.sh
```

Simple alternative without version management features.

### Option 3: Manual (any platform)

```bash
# Windows PowerShell
Compress-Archive -Path manifest.json,chrome.manifest,bootstrap.js,chrome,resource -DestinationPath odf-scan.xpi -Force

# Linux/Mac
zip -r odf-scan.xpi manifest.json chrome.manifest bootstrap.js chrome resource
```

## What Gets Included

The build includes:
- ✅ `manifest.json` (with synced version)
- ✅ `chrome.manifest`
- ✅ `bootstrap.js`
- ✅ `chrome/` directory (UI, localization)
- ✅ `resource/` directory (translator)

**Excluded:**
- ❌ `node_modules/`
- ❌ `.git/`
- ❌ `*.md` documentation
- ❌ `*.py` build scripts
- ❌ Development files

## Build Output

After building, you'll get a file like:
```
zotero-odf-scan-v2.0.48.xpi
```

This is a standard ZIP file containing your plugin.

## Installing the Built Plugin

1. Open Zotero 7 or 8
2. Go to **Tools → Add-ons**
3. Click the gear icon ⚙️
4. Select **Install Add-on From File...**
5. Choose the `.xpi` file
6. Restart Zotero if prompted

## Version Management

Version is stored in two places:
- `package.json` - Source of truth
- `manifest.json` - Synced during build

To bump version:
```bash
npm version patch    # 2.0.48 → 2.0.49
npm version minor    # 2.0.48 → 2.1.0
npm version major    # 2.0.48 → 3.0.0
```

Then rebuild:
```bash
python build.py
```

## Troubleshooting

### "No such file or directory" error
Make sure you're in the plugin root directory:
```bash
cd /path/to/zotero-odf-scan-plugin
```

### Python script fails
Check you have Python 3:
```bash
python --version  # Should be 3.x
```

### Missing files in XPI
Verify files exist before building:
```bash
ls -la manifest.json chrome.manifest bootstrap.js
ls -R chrome resource
```

### XPI won't install in Zotero
1. Check Zotero version (must be 7.0+)
2. Verify manifest.json is valid JSON
3. Check Error Console in Zotero for details

## Development Workflow

1. Make code changes
2. Test locally (see TESTING_GUIDE.md)
3. Bump version: `npm version patch`
4. Build: `python build.py`
5. Test installation
6. Commit changes
7. Create release: `python build.py --release`
8. Push to GitHub
9. Create GitHub release with XPI attached

## Continuous Integration

The build process is simple enough to run in CI/CD:

```yaml
# Example GitHub Actions
- name: Build plugin
  run: python build.py

- name: Upload artifact
  uses: actions/upload-artifact@v3
  with:
    name: plugin-xpi
    path: "*.xpi"
```
