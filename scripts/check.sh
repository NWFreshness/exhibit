#!/usr/bin/env bash
# Verify command for Exhibit phase 1. Fails fast; prints status per gate.
set -u
cd "$(dirname "$0")/.."

pass=0; fail=0
gate() { if "$@" >/tmp/exhibit-check.log 2>&1; then echo "PASS: $*"; pass=$((pass+1)); else echo "FAIL: $*"; tail -n 20 /tmp/exhibit-check.log; fail=$((fail+1)); fi; }

[ -f .env ] || cp .env.example .env 2>/dev/null || true

gate npx prisma validate
gate npx prisma generate
gate npx tsc --noEmit
gate npx vitest run

echo "----"
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
