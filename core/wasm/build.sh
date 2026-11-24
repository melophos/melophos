#!/bin/sh
# Builds the WebAssembly package into package/pkg and the wrapper into package/dist.
#
# Reproducible on purpose: the compiler is the one rust-toolchain.toml pins, the
# dependencies come from Cargo.lock (--locked), the
# command line tool must match the wasm-bindgen crate version exactly, build paths
# are remapped so the result does not depend on where the repository is checked out
# and the name and producers sections are dropped. Run it twice or in two
# directories and the sha256 printed at the end is the same.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
core=$(cd "$here/.." && pwd)
pkg="$here/package"
target=wasm32-unknown-unknown

# the compiler must be the one rust-toolchain.toml pins: another version gives other bytes
pinned=$(sed -n 's/^channel = "\(.*\)"$/\1/p' "$core/rust-toolchain.toml")
running=$(rustc --version | cut -d' ' -f2)
if [ "$running" != "$pinned" ]; then
  echo "rustc $pinned is pinned in rust-toolchain.toml and $running is first on PATH." >&2
  echo "With rustup this is chosen for you. Otherwise run: rustup toolchain install $pinned" >&2
  exit 1
fi

# the wasm target must belong to the compiler that cargo will run
if ! ls "$(rustc --print target-libdir --target $target)"/libcore-*.rlib >/dev/null 2>&1; then
  echo "The $target target is not installed for $(command -v rustc)." >&2
  echo "Run: rustup target add $target" >&2
  echo "If rustup is installed but another rustc comes first on PATH, put rustup's toolchain first:" >&2
  echo "  PATH=\"\$(rustup run stable rustc --print sysroot)/bin:\$PATH\" $0" >&2
  exit 1
fi

want=$(sed -n '/^name = "wasm-bindgen"$/{n;s/^version = "\(.*\)"$/\1/p;}' "$core/Cargo.lock")
bindgen=$(command -v wasm-bindgen || true)
[ -n "$bindgen" ] || bindgen="$HOME/.cargo/bin/wasm-bindgen"
have=$("$bindgen" --version 2>/dev/null | cut -d' ' -f2 || true)
if [ "$have" != "$want" ]; then
  echo "wasm-bindgen $want is needed and found '${have:-nothing}'." >&2
  echo "Run: cargo install wasm-bindgen-cli --version $want --locked" >&2
  exit 1
fi

cd "$core"
sysroot=$(rustc --print sysroot)
cargo_home=${CARGO_HOME:-$HOME/.cargo}
export RUSTFLAGS="--remap-path-prefix=$core=/melophos/core --remap-path-prefix=$cargo_home=/cargo --remap-path-prefix=$sysroot=/rustc"
cargo build --locked --profile wasm --target $target -p melophos-core-wasm

rm -rf "$pkg/pkg"
"$bindgen" --target web --remove-name-section --remove-producers-section \
  --out-dir "$pkg/pkg" --out-name melophos_core_wasm \
  "target/$target/wasm/melophos_core_wasm.wasm"

# optional size pass, off by default: set WASM_OPT=1 to run it. A different
# wasm-opt version can give different bytes, so the version is printed
if [ "${WASM_OPT:-}" = "1" ]; then
  command -v wasm-opt >/dev/null 2>&1 || { echo "WASM_OPT=1 needs wasm-opt on PATH (binaryen)." >&2; exit 1; }
  echo "wasm-opt: $(wasm-opt --version)"
  wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals \
    -o "$pkg/pkg/melophos_core_wasm_bg.wasm.opt" "$pkg/pkg/melophos_core_wasm_bg.wasm"
  mv "$pkg/pkg/melophos_core_wasm_bg.wasm.opt" "$pkg/pkg/melophos_core_wasm_bg.wasm"
fi

if [ -d "$pkg/node_modules" ]; then
  (cd "$pkg" && npx --no-install tsc -p tsconfig.build.json)
else
  echo "Skipping the wrapper build: run npm ci in $pkg first." >&2
fi

echo "rustc: $(rustc --version)"
echo "wasm-bindgen: $have"
ls -l "$pkg/pkg/melophos_core_wasm_bg.wasm" | awk '{print "size: " $5 " bytes"}'
shasum -a 256 "$pkg/pkg/melophos_core_wasm_bg.wasm"
