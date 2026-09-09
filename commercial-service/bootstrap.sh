#!/usr/bin/env bash
set -euo pipefail

# Vercel install bootstrap.
# The Vercel project currently invokes `bash bootstrap.sh && npm ci`.
# Keep this script intentionally side-effect free; dependency installation is
# performed by the following `npm ci` command.

if [[ ! -f package.json ]]; then
  echo "ANPOS commercial-service bootstrap: package.json not found in current directory" >&2
  exit 1
fi

echo "ANPOS commercial-service bootstrap ready"
