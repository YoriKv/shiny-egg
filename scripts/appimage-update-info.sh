#!/usr/bin/env bash
# Embed AppImage update information into an electron-builder AppImage and write
# the matching .zsync next to it, so AppImageUpdate (and similar tools) can
# delta-update from GitHub Releases. electron-builder has no option for either,
# so this unpacks its AppImage and repacks the same AppDir with
# `appimagetool -u`, which embeds the update info and generates the .zsync.
# The repack also swaps in appimagetool's own static type-2 runtime.
#
# The update info always points at the public releases repo, whatever repo the
# build runs in, and its glob must match the artifact name in
# electron-builder.yml (linux.artifactName → shiny-egg-<ver>-x86_64.AppImage).
#
# Usage:
#   bash scripts/appimage-update-info.sh <path/to/shiny-egg-<ver>-x86_64.AppImage>
# Env:
#   APPIMAGETOOL   path to an appimagetool executable (default: download the
#                  pinned release below into a temp dir + verify its SHA-256)
#
# Output: the AppImage is replaced in place; <AppImage>.zsync is written beside it.
# Runs without FUSE (APPIMAGE_EXTRACT_AND_RUN), as on GitHub's Ubuntu runners.
set -euo pipefail

UPDATE_INFO='gh-releases-zsync|YoriKv|shiny-egg|latest|shiny-egg-*-x86_64.AppImage.zsync'
APPIMAGETOOL_VERSION='1.9.1'
APPIMAGETOOL_SHA256='ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0'

appimage="$(realpath "${1:?usage: $0 <AppImage>}")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export APPIMAGE_EXTRACT_AND_RUN=1
# Extract-and-run unpacks appimagetool under $TMPDIR and leaves it there; keep
# that inside $work so the trap cleans it up.
export TMPDIR="$work"

tool="${APPIMAGETOOL:-}"
if [ -z "$tool" ]; then
  tool="$work/appimagetool"
  curl -fsSL -o "$tool" \
    "https://github.com/AppImage/appimagetool/releases/download/${APPIMAGETOOL_VERSION}/appimagetool-x86_64.AppImage"
  echo "${APPIMAGETOOL_SHA256}  $tool" | sha256sum -c -
  chmod +x "$tool"
fi

# --appimage-extract always writes ./squashfs-root, so run it from $work.
mv "$appimage" "$work/original.AppImage"
(cd "$work" && ./original.AppImage --appimage-extract > /dev/null)

# Write to the final path: the .zsync records the AppImage's filename as its
# download URL, so it must be generated against the published name. appimagetool
# writes the .zsync into its cwd (not beside the output), hence the cd.
rm -f "$appimage.zsync"
(cd "$(dirname "$appimage")" &&
  ARCH=x86_64 "$tool" --no-appstream -u "$UPDATE_INFO" "$work/squashfs-root" "$appimage")

[ -s "$appimage.zsync" ] || { echo "appimagetool did not write $appimage.zsync" >&2; exit 1; }
echo "Embedded update info: $UPDATE_INFO"
