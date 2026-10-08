#!/bin/bash
set -euo pipefail
umask 077

if [ "$(uname -s)" != "Darwin" ]; then
  echo 'This launcher is for macOS. Use npm ci and npm run dev on Windows.' >&2
  exit 1
fi
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
check_only=0
force_runtime=0
no_browser=0
for option in "$@"; do
  case "$option" in
    --check) check_only=1 ;;
    --bundled-node) force_runtime=1 ;;
    --no-browser) no_browser=1 ;;
    *) echo "Unknown option: $option" >&2; exit 1 ;;
  esac
done

if [ "$force_runtime" = 1 ] || ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1; then
  version='v24.21.0'
  case "$(uname -m)" in
    arm64) arch='arm64'; expected='bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057' ;;
    x86_64) arch='x64'; expected='1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097' ;;
    *) echo 'Unsupported Mac architecture.' >&2; exit 1 ;;
  esac
  runtime_base="${TKC_RUNTIME_DIR:-$HOME/Library/Application Support/TKC GMO Preview/runtime}"
  runtime_dir="$runtime_base/node-$version-darwin-$arch"
  if [ ! -x "$runtime_dir/bin/node" ] || [ ! -f "$runtime_dir/bin/npm" ]; then
    if [ -e "$runtime_dir" ]; then
      echo "Incomplete runtime cache: $runtime_dir. Move it aside and retry." >&2
      exit 1
    fi
    mkdir -p "$runtime_base"
    stage="$(mktemp -d "$runtime_base/.install-XXXXXXXX")"
    archive="$stage/node.tar.gz"
    echo "Downloading Node.js $version ($arch) from nodejs.org; checking SHA-256."
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
      "https://nodejs.org/dist/$version/node-$version-darwin-$arch.tar.gz" --output "$archive"
    actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
    if [ "$actual" != "$expected" ]; then
      rm -f "$archive"
      echo 'Node.js checksum mismatch. No downloaded code has been executed.' >&2
      exit 1
    fi
    mkdir "$stage/unpacked"
    tar -xzf "$archive" -C "$stage/unpacked" --strip-components 1
    rm -f "$archive"
    mv "$stage/unpacked" "$runtime_dir"
    rmdir "$stage"
  fi
  export PATH="$runtime_dir/bin:$PATH"
  if [ "$(node --version)" != "$version" ]; then
    echo 'Unexpected cached Node.js version.' >&2
    exit 1
  fi
fi

export DATA_DIR="${DATA_DIR:-$HOME/Library/Application Support/TKC GMO Preview/data}"
if [ -f '.mac-preview-bundle' ]; then
  # The ZIP includes compiled JavaScript, so no compiler or Python is needed on the Mac.
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
else
  npm ci --ignore-scripts --no-audit --no-fund
  npm run build
fi

if [ "$check_only" = 1 ]; then
  exec node dist/src/doctor.js --json
fi
node dist/src/doctor.js
echo 'P1 preview only. TKC registration and posting are not enabled.'
echo 'Keep this Terminal open. Press Control+C to stop; saved work remains.'
if [ "$no_browser" = 1 ]; then
  exec node dist/src/mac-launch.js --no-browser
fi
exec node dist/src/mac-launch.js
