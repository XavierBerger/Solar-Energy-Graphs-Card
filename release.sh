#!/bin/sh
# Release X.Y.Z: bump package.json and package-lock.json through a pull
# request into main, then tag the merge commit. Pushing the tag triggers
# .github/workflows/release.yml, which builds, tests and publishes.
set -eu

cd -- "$(dirname -- "$0")"

version=${1:-}
case "$version" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *)
    printf 'Usage: %s X.Y.Z (without the leading v)\n' "$0" >&2
    exit 2
    ;;
esac
tag=v$version
branch=release/$tag

git fetch --tags origin
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  printf 'Tag %s already exists.\n' "$tag" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  printf 'Working tree is not clean.\n' >&2
  exit 1
fi

git switch -c "$branch" origin/main

# jq writes 2-space indented JSON, the format npm writes.
jq --arg v "$version" '.version = $v' package.json > package.json.tmp
mv package.json.tmp package.json
jq --arg v "$version" '.version = $v | .packages[""].version = $v' \
  package-lock.json > package-lock.json.tmp
mv package-lock.json.tmp package-lock.json

git add package.json package-lock.json
git commit -m "chore(release): $version"
git push -u origin "$branch"

# The main ruleset requires a pull request and allows merge commits only.
pr_url=$(gh pr create --base main --head "$branch" \
  --title "chore(release): $version" --body "")
# Deletes the local and remote branch, then switches to main and pulls it.
gh pr merge --merge --delete-branch

merge_sha=$(gh pr view "$pr_url" --json mergeCommit --jq .mergeCommit.oid)
git fetch origin
git tag -a "$tag" -m "$tag" "$merge_sha"
git push origin "$tag"
