#!/bin/bash

if [ -n "$(git status --untracked-files=no --porcelain)" ]; then 
  echo Uncommitted changes in tracked files
  exit
fi

if [[ "$(git rev-parse --abbrev-ref HEAD)" != "master" ]]; then
  echo 'Not on master'
  exit
fi

github-release release --user $npm_package_repository_organisation --repo $npm_package_repository_repo --tag v$npm_package_version --name "$npm_package_description"
github-release upload --user $npm_package_repository_organisation --repo $npm_package_repository_repo --tag v$npm_package_version --name zotero-odf-scan-v$npm_package_version.xpi --file zotero-odf-scan-v$npm_package_version.xpi

