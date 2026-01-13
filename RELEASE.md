# Release Process

This document describes how to create a new release of the ODF Scan plugin.

## Prerequisites

1. **GitHub CLI (`gh`)** must be installed
   - Download from: https://cli.github.com/
   - Authenticate with: `gh auth login`

2. **Git** must be configured with your credentials

3. **Clean working directory** - all changes must be committed

## Creating a Release

### Standard Release (Public)

To create a public release:

```bash
./release.sh 2.1.0
```

This will:
1. Update version in `package.json` and `manifest.json`
2. Update `updates.json` with the new version and download URL
3. Build the XPI file
4. Calculate SHA256 hash and add to `updates.json`
5. Commit the version changes
6. Create and push a git tag `v2.1.0`
7. Create a GitHub release with the XPI attached
8. Display the release URL

### Draft Release (for Testing)

To create a draft release that you can review before publishing:

```bash
./release.sh 2.1.0 --draft
```

This creates the release in draft mode. You can:
- Review the release notes
- Test the XPI download
- Edit the description
- Publish when ready

Visit https://github.com/Juris-M/zotero-odf-scan-plugin/releases to manage draft releases.

## What the Script Does

### Step 1: Version Update
Updates the version number in:
- `package.json`
- `manifest.json`

### Step 2: Update updates.json
Rewrites `updates.json` with:
- New version number
- Download URL pointing to the GitHub release
- Zotero 7.0 - 8.0.* compatibility

### Step 3: Build XPI
Runs `build.sh` to create `zotero-odf-scan-v<version>.xpi`

### Step 4: Calculate Hash
Generates SHA256 hash of the XPI for verification

### Step 5: Commit Changes
Creates a commit with message: `Release v<version>`

### Step 6: Create Git Tag
Creates an annotated tag: `v<version>`

### Step 7: Push to GitHub
Asks for confirmation, then pushes:
- The commit to your current branch
- The tag to GitHub

### Step 8: Create GitHub Release
Uses `gh` CLI to:
- Create a release for the tag
- Upload the XPI file
- Add release notes with installation instructions
- Include SHA256 hash for verification

## Manual Release (if script fails)

If the automated script fails, you can create a release manually:

1. Update version numbers:
   ```bash
   # Edit package.json and manifest.json manually
   # Update updates.json manually
   ```

2. Build XPI:
   ```bash
   bash build.sh
   ```

3. Calculate hash:
   ```bash
   sha256sum zotero-odf-scan-v2.1.0.xpi
   ```

4. Commit and tag:
   ```bash
   git add package.json manifest.json updates.json
   git commit -m "Release v2.1.0"
   git tag -a v2.1.0 -m "Release v2.1.0"
   git push origin master
   git push origin v2.1.0
   ```

5. Create GitHub release:
   ```bash
   gh release create v2.1.0 zotero-odf-scan-v2.1.0.xpi \
     --title "v2.1.0" \
     --notes "See commit history for changes"
   ```

## Troubleshooting

### "gh: command not found"
Install GitHub CLI from https://cli.github.com/

### "Error: Uncommitted changes"
Commit or stash your changes before releasing:
```bash
git status
git add .
git commit -m "Your changes"
```

### "Permission denied"
Make the script executable:
```bash
chmod +x release.sh
```

### "Not on master/main branch"
The script will warn you. Either:
- Switch to master: `git checkout master`
- Continue anyway when prompted (for hotfix branches)

## Version Numbering

Follow semantic versioning (MAJOR.MINOR.PATCH):
- **MAJOR** (2.x.x): Breaking changes, incompatible API changes
- **MINOR** (x.1.x): New features, backward-compatible
- **PATCH** (x.x.1): Bug fixes, backward-compatible

Examples:
- `2.0.48` → `2.0.49` (bug fix)
- `2.0.48` → `2.1.0` (new feature)
- `2.0.48` → `3.0.0` (breaking change, e.g., Zotero 9 support)
