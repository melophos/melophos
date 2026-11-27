#!/bin/sh
# The release gate. Run by the first job of publish-images.yml and nothing publishes unless it passes. It checks, with
# the GitHub API, that the tag was made on purpose and is the code CI tested:
#   - the tag is annotated and its signature is verified by GitHub
#   - the tag points at exactly the commit that started this run
#   - that commit is on main
#   - CI passed on that commit
#   - the version in the tag is the version in the package file
# The workflow file itself cannot be defended from inside: whoever can edit it at the tagged commit can remove this
# job. That is what the tag ruleset and the protected release environment in the repository settings are for.
#
# Needs: REPO (owner/name), TAG, SHA (the commit of the run) and GH_TOKEN. gh and jq.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
: "${REPO:?}" "${TAG:?}" "${SHA:?}"
fail() { printf 'release gate: %s\n' "$*" >&2; exit 1; }

printf '%s' "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail "the tag $TAG is not of the form v1.2.3"
printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{40}$' || fail "the commit $SHA is not a full commit id"

ref="$(gh api "repos/$REPO/git/ref/tags/$TAG")" || fail "cannot read the tag $TAG"
[ "$(printf '%s' "$ref" | jq -r '.object.type')" = "tag" ] || fail "the tag $TAG is not annotated (a lightweight tag has no signature)"
tag_sha="$(printf '%s' "$ref" | jq -r '.object.sha')"
tag="$(gh api "repos/$REPO/git/tags/$tag_sha")" || fail "cannot read the tag object"
[ "$(printf '%s' "$tag" | jq -r '.verification.verified')" = "true" ] || fail "the tag $TAG is not signed or GitHub cannot verify its signature (reason: $(printf '%s' "$tag" | jq -r '.verification.reason'))"
[ "$(printf '%s' "$tag" | jq -r '.object.type')" = "commit" ] || fail "the tag $TAG does not point at a commit"
[ "$(printf '%s' "$tag" | jq -r '.object.sha')" = "$SHA" ] || fail "the tag points at $(printf '%s' "$tag" | jq -r '.object.sha'), not at the commit of this run ($SHA)"

status="$(gh api "repos/$REPO/compare/main...$SHA" --jq '.status')" || fail "cannot compare the commit with main"
case "$status" in
    identical | behind) ;;
    *) fail "the commit $SHA is not on main (it is $status of main)" ;;
esac

passed="$(gh api -X GET "repos/$REPO/actions/workflows/ci.yml/runs" -f head_sha="$SHA" -f status=success --jq '.total_count')" || fail "cannot read the CI runs"
[ "${passed:-0}" -ge 1 ] || fail "CI has no successful run on $SHA"

package="$(sed -n 's/^version = "\(.*\)"$/\1/p' "$root/server/pyproject.toml" | head -n 1)"
[ "v$package" = "$TAG" ] || fail "the tag is $TAG but server/pyproject.toml says version $package"

echo "release gate passed for $TAG at $SHA"
