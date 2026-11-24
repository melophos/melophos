#!/bin/sh
# Joins the per-platform images of this run into one image and prints the digest of the image it made. Run by the merge
# job of publish-images.yml and the digest it prints is the one that is signed and pinned.
#
# The digest comes from the creation of the index itself (the metadata file docker writes), never from reading a tag
# back afterwards: anything with package write could move a tag in that gap. Before it prints anything it checks
#   - the run built exactly EXPECTED platform images (the digest files in DIGEST_DIR)
#   - the index that was made lists exactly the images those platform builds contain, nothing more
#   - every tag now points at that very index
# Needs: IMAGE (registry/name), TAGS (space separated full references), DIGEST_DIR, optional EXPECTED (default 2).
set -eu
: "${IMAGE:?}" "${TAGS:?}" "${DIGEST_DIR:?}"
expected="${EXPECTED:-2}"
fail() { printf 'merge: %s\n' "$*" >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

count=0
sources=""
for f in "$DIGEST_DIR"/*; do
    [ -f "$f" ] || continue
    name="$(basename "$f")"
    printf '%s' "$name" | grep -Eq '^[0-9a-f]{64}$' || fail "$name is not a digest"
    sources="$sources $IMAGE@sha256:$name"
    count=$((count + 1))
done
[ "$count" -eq "$expected" ] || fail "this run built $count platform images, expected $expected"

tag_args=""
for t in $TAGS; do tag_args="$tag_args -t $t"; done
# shellcheck disable=SC2086
docker buildx imagetools create $tag_args --metadata-file "$work/meta.json" $sources > /dev/null || fail "could not create the index"
index="$(jq -r '."containerimage.digest" // ."containerimage.descriptor".digest // empty' "$work/meta.json")"
printf '%s' "$index" | grep -Eq '^sha256:[0-9a-f]{64}$' || fail "docker did not report the digest of the index it made"

children() { # a reference: the digests of the images an index lists, sorted
    docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' | jq -r '.manifests[]?.digest' | sort
}
for s in $sources; do children "$s"; done | sort -u > "$work/wanted"
children "$IMAGE@$index" > "$work/made"
[ -s "$work/wanted" ] || fail "the platform images list nothing"
cmp -s "$work/wanted" "$work/made" || fail "the index lists other images than the platform builds contain"

for t in $TAGS; do
    now="$(docker buildx imagetools inspect "$t" --format '{{json .Manifest}}' | jq -r '.digest')"
    [ "$now" = "$index" ] || fail "the tag $t points at $now, not at the index this run made ($index): not signing"
done

echo "$index"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "digest=$index" >> "$GITHUB_OUTPUT"; fi
