#!/bin/sh
set -eu

node dist/db/migrate.js
exec node --import ./dist/instrumentation.js dist/index.js
