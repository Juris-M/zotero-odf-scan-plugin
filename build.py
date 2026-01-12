#!/usr/bin/env python3

import zipfile
import glob
import argparse
import os
import json

class Builder:
    def __init__(self):
        parser = argparse.ArgumentParser()
        parser.add_argument("--beta", action='store_true', help="build beta XPI")
        parser.add_argument("--release", action='store_true', help="update updates.json")
        args = parser.parse_args()
        self.beta = args.beta
        self.release = args.release

        if self.beta and self.release:
            raise ValueError('Cannot release a beta')

        # Load version from package.json
        with open('package.json') as f:
            self.package = json.load(f)

        # Load and update manifest.json
        with open('manifest.json') as f:
            self.manifest = json.load(f)

        self.version = self.package['version']
        if self.beta:
            self.version += '-beta'

        # Update manifest version to match package.json
        self.manifest['version'] = self.version

        self.xpi = 'zotero-odf-scan-v' + self.version + '.xpi'

        self.build()
        if self.release:
            self.update_manifest()

    def update_manifest(self):
        """Update updates.json for auto-update"""
        updates_file = 'updates.json'

        if not os.path.exists(updates_file):
            print(f"Warning: {updates_file} not found, skipping update")
            return

        with open(updates_file) as f:
            updates = json.load(f)

        # Update version in updates.json
        plugin_id = self.manifest['applications']['zotero']['id']
        if 'addons' in updates and plugin_id in updates['addons']:
            addon = updates['addons'][plugin_id]
            if 'updates' in addon and len(addon['updates']) > 0:
                addon['updates'][0]['version'] = self.version
                addon['updates'][0]['update_link'] = (
                    f"https://github.com/Juris-M/zotero-odf-scan-plugin/releases/download/"
                    f"v{self.version}/{self.xpi}"
                )

        with open(updates_file, 'w') as f:
            json.dump(updates, f, indent=2)

        print(f"Updated {updates_file}")

    def build(self):
        # Remove old XPI files
        for xpi in glob.glob('*.xpi'):
            os.remove(xpi)
            print(f"Removed old {xpi}")

        # Files and directories to include
        include_patterns = [
            'chrome.manifest',
            'bootstrap.js',
            'chrome/**/*',
            'resource/**/*',
        ]

        # Files and patterns to exclude
        exclude_patterns = [
            '**/__pycache__',
            '**/*.pyc',
            '**/.DS_Store',
            '**/Thumbs.db',
        ]

        with zipfile.ZipFile(self.xpi, 'w', zipfile.ZIP_DEFLATED) as xpi:
            # Add manifest.json with updated version
            xpi.writestr('manifest.json', json.dumps(self.manifest, indent=4))
            print("Added manifest.json")

            # Add all matching files
            file_count = 0
            for pattern in include_patterns:
                for file in glob.glob(pattern, recursive=True):
                    # Skip directories
                    if os.path.isdir(file):
                        continue

                    # Check exclusions
                    if any(self._matches_pattern(file, excl) for excl in exclude_patterns):
                        continue

                    xpi.write(file)
                    file_count += 1

            print(f"Built {self.xpi} with {file_count} files")

    def _matches_pattern(self, path, pattern):
        """Simple pattern matching for exclusions"""
        if '**/' in pattern:
            suffix = pattern.replace('**/', '')
            return path.endswith(suffix) or ('/' + suffix) in path
        return path == pattern

if __name__ == '__main__':
    try:
        Builder()
    except Exception as e:
        print(f"Error: {e}")
        exit(1)
