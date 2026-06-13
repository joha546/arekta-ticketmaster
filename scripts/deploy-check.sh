#!/usr/bin/env bash
set -euo pipefail

pnpm lint
pnpm typecheck
INTEGRATION_TEST=0 pnpm test
pnpm build

echo "Deploy check passed."
