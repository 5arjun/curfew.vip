#!/usr/bin/env bash
# Test harness for check-additive-only-migrations.sh (Story 2.1, Task 5).
# Exercises the guard against fixture migration files in a scratch directory
# so it never touches the real supabase/migrations/ tree.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$SCRIPT_DIR/check-additive-only-migrations.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

pass_count=0
fail_count=0

assert_exit() {
  local description="$1"
  local expected_code="$2"
  local sql="$3"

  rm -rf "$tmp_dir"/*
  echo "$sql" >"$tmp_dir/20260101000000_fixture.sql"

  set +e
  "$GUARD" "$tmp_dir" >/tmp/additive-only-test-output.txt 2>&1
  local actual_code=$?
  set -e

  if [ "$actual_code" -eq "$expected_code" ]; then
    echo "ok - $description"
    pass_count=$((pass_count + 1))
  else
    echo "not ok - $description (expected exit $expected_code, got $actual_code)"
    cat /tmp/additive-only-test-output.txt
    fail_count=$((fail_count + 1))
  fi
}

assert_exit "pure CREATE TABLE passes" 0 \
  "create table public.djs (id uuid primary key, created_at timestamptz not null default now());"

assert_exit "ADD COLUMN passes" 0 \
  "alter table public.djs add column nickname text;"

assert_exit "DROP COLUMN is rejected" 1 \
  "alter table public.djs drop column nickname;"

assert_exit "DROP TABLE is rejected" 1 \
  "drop table public.djs;"

assert_exit "RENAME COLUMN is rejected" 1 \
  "alter table public.djs rename column nickname to handle;"

assert_exit "RENAME TO is rejected" 1 \
  "alter table public.djs rename to dj_profiles;"

assert_exit "ALTER COLUMN ... TYPE is rejected" 1 \
  "alter table public.djs alter column created_at type date;"

assert_exit "ALTER COLUMN ... SET DEFAULT is not a false positive" 0 \
  "alter table public.djs alter column created_at set default now();"

assert_exit "escape-marker comment allows an otherwise-forbidden line" 0 \
  "alter table public.djs drop column nickname; -- additive-only: allow"

assert_exit "empty migrations dir passes" 0 ""

rm -rf "$tmp_dir"/*
rmdir "$tmp_dir" 2>/dev/null || true
set +e
"$GUARD" "$tmp_dir/does-not-exist" >/tmp/additive-only-test-output.txt 2>&1
missing_dir_code=$?
set -e
if [ "$missing_dir_code" -eq 0 ]; then
  echo "ok - missing migrations dir is a no-op pass"
  pass_count=$((pass_count + 1))
else
  echo "not ok - missing migrations dir is a no-op pass (got exit $missing_dir_code)"
  cat /tmp/additive-only-test-output.txt
  fail_count=$((fail_count + 1))
fi
mkdir -p "$tmp_dir"

echo ""
echo "$pass_count passed, $fail_count failed"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
