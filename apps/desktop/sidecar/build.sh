#!/bin/sh
# Builds the talos-ai helper for both Mac architectures and joins them with lipo.
set -eu
cd "$(dirname "$0")"
out=../src-tauri/binaries
mkdir -p "$out"
built=""
for triple in arm64-apple-macos26.0:aarch64-apple-darwin x86_64-apple-macos26.0:x86_64-apple-darwin; do
  target="${triple%%:*}"
  suffix="${triple##*:}"
  if xcrun swiftc -O -target "$target" \
    -framework Foundation -framework FoundationModels \
    talos-ai/Sources/*.swift -o "$out/talos-ai-$suffix"; then
    built="$built $suffix"
  elif [ "$suffix" = "x86_64-apple-darwin" ]; then
    echo "build.sh: x86_64 slice failed; the universal binary will not be produced" >&2
  else
    echo "build.sh: arm64 slice failed" >&2
    exit 1
  fi
done
case "$built" in
  *aarch64-apple-darwin*x86_64-apple-darwin*)
    lipo -create "$out/talos-ai-aarch64-apple-darwin" "$out/talos-ai-x86_64-apple-darwin" \
      -output "$out/talos-ai-universal-apple-darwin"
    echo "build.sh: wrote$built universal" ;;
  *)
    echo "build.sh: wrote$built" ;;
esac
