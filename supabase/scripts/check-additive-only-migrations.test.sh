#!/usr/bin/env bash
# Test harness for check-additive-only-migrations.sh (Story 2.1, Task 5).
# Exercises the guard against fixture migration files in a scratch directory
# so it never touches the real supabase/migrations/ tree.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$SCRIPT_DIR/check-additive-only-migrations.sh"

tmp_dir="$(mktemp -d)"
out_file="$(mktemp)"
trap 'rm -rf "$tmp_dir"; rm -f "$out_file"' EXIT

pass_count=0
fail_count=0

assert_exit() {
  local description="$1"
  local expected_code="$2"
  local sql="$3"

  rm -rf "$tmp_dir"/*
  echo "$sql" >"$tmp_dir/20260101000000_fixture.sql"

  set +e
  "$GUARD" "$tmp_dir" >"$out_file" 2>&1
  local actual_code=$?
  set -e

  if [ "$actual_code" -eq "$expected_code" ]; then
    echo "ok - $description"
    pass_count=$((pass_count + 1))
  else
    echo "not ok - $description (expected exit $expected_code, got $actual_code)"
    cat "$out_file"
    fail_count=$((fail_count + 1))
  fi
}

assert_exit "pure CREATE TABLE passes" 0 \
  "create table public.djs (id uuid primary key, created_at timestamptz not null default now());"

assert_exit "ADD COLUMN passes" 0 \
  "alter table public.djs add column nickname text;"

assert_exit "DROP COLUMN is rejected" 1 \
  "alter table public.djs drop column nickname;"

assert_exit "DROP COLUMN with the optional COLUMN keyword omitted is rejected" 1 \
  "alter table public.djs drop nickname;"

assert_exit "DROP TABLE is rejected" 1 \
  "drop table public.djs;"

assert_exit "RENAME COLUMN is rejected" 1 \
  "alter table public.djs rename column nickname to handle;"

assert_exit "RENAME COLUMN with the optional COLUMN keyword omitted is rejected" 1 \
  "alter table public.djs rename nickname to handle;"

assert_exit "RENAME TO is rejected" 1 \
  "alter table public.djs rename to dj_profiles;"

assert_exit "ALTER COLUMN ... TYPE is rejected" 1 \
  "alter table public.djs alter column created_at type date;"

assert_exit "ALTER ... TYPE with the optional COLUMN keyword omitted is rejected" 1 \
  "alter table public.djs alter created_at type date;"

assert_exit "ALTER COLUMN ... SET DATA TYPE spelling is rejected" 1 \
  "alter table public.djs alter column created_at set data type date;"

assert_exit "ALTER COLUMN ... SET DEFAULT is not a false positive" 0 \
  "alter table public.djs alter column created_at set default now();"

assert_exit "escape-marker comment allows an otherwise-forbidden line" 0 \
  "alter table public.djs drop column nickname; -- additive-only: allow"

assert_exit "escape-marker text outside an actual comment does not suppress detection" 1 \
  "alter table public.djs drop column \"additive-only: allow\";"

assert_exit "escape marker does not leak onto an earlier unmarked statement sharing the same line" 1 \
  "alter table public.djs drop column a; alter table public.djs drop column b; -- additive-only: allow"

assert_exit "escape marker on its own line, several statements earlier, does not leak forward" 1 \
  "-- additive-only: allow
alter table public.djs
  drop column nickname;"

assert_exit "DROP COLUMN split across multiple lines is rejected" 1 \
  "alter table public.djs
  drop
  column nickname;"

assert_exit "ALTER COLUMN ... TYPE split across multiple lines is rejected" 1 \
  "alter table public.djs
  alter column created_at
  type date;"

assert_exit "ALTER TABLE IF EXISTS ... DROP COLUMN is still rejected" 1 \
  "alter table if exists public.djs drop column secret;"

assert_exit "a -- inside a string literal does not hide a later forbidden statement on the same line" 1 \
  "alter table public.djs alter column created_at set default 'a--z'; alter table public.djs drop column created_at;"

assert_exit "a comment mentioning a forbidden phrase is not a false positive" 0 \
  "-- we intentionally do not drop column id here
create table public.djs (id uuid primary key);"

assert_exit "a block comment mentioning a forbidden phrase is not a false positive" 0 \
  "/* we should never drop table djs by accident */
create table public.djs (id uuid primary key);"

assert_exit "DROP TRIGGER (not a column drop) is not a false positive" 0 \
  "drop trigger if exists on_auth_user_created on auth.users;"

assert_exit "DROP FUNCTION (not a column drop) is not a false positive" 0 \
  "drop function if exists public.handle_new_dj();"

assert_exit "DROP CONSTRAINT is not mislabeled as DROP COLUMN" 0 \
  "alter table public.djs drop constraint djs_pkey;"

assert_exit "DROP TABLESPACE is not a false positive" 0 \
  "drop tablespace old_ts;"

assert_exit "DROP TABLE phrase inside a DML string literal is not a false positive" 0 \
  "insert into public.help_articles (title, body) values ('faq', 'why we never drop table rows in prod');"

assert_exit "empty migrations dir passes" 0 ""

# Uppercase/mixed-case .SQL extension must still be scanned, not silently skipped.
rm -rf "$tmp_dir"/*
echo "alter table public.djs drop column nickname;" >"$tmp_dir/20260101000000_fixture.SQL"
set +e
"$GUARD" "$tmp_dir" >"$out_file" 2>&1
uppercase_ext_code=$?
set -e
if [ "$uppercase_ext_code" -eq 1 ]; then
  echo "ok - uppercase .SQL extension is still scanned"
  pass_count=$((pass_count + 1))
else
  echo "not ok - uppercase .SQL extension is still scanned (expected exit 1, got $uppercase_ext_code)"
  cat "$out_file"
  fail_count=$((fail_count + 1))
fi

# A subdirectory under the migrations dir (not a *.sql file) must not crash the
# script under set -euo pipefail.
rm -rf "$tmp_dir"/*
mkdir -p "$tmp_dir/20260101000000_not_a_file.sql"
echo "create table public.djs (id uuid primary key);" >"$tmp_dir/20260102000000_fixture.sql"
set +e
"$GUARD" "$tmp_dir" >"$out_file" 2>&1
subdir_code=$?
set -e
if [ "$subdir_code" -eq 0 ]; then
  echo "ok - a directory matching *.sql does not crash the guard"
  pass_count=$((pass_count + 1))
else
  echo "not ok - a directory matching *.sql does not crash the guard (expected exit 0, got $subdir_code)"
  cat "$out_file"
  fail_count=$((fail_count + 1))
fi

# An existing migrations dir with zero .sql files (distinct from a single
# empty-content .sql file, tested above) must not crash under `set -u` on
# bash <4.4, where "${arr[@]}" on a zero-element array is an unbound
# variable unless guarded with the "${arr[@]+"${arr[@]}"}" idiom.
rm -rf "$tmp_dir"/*
set +e
"$GUARD" "$tmp_dir" >"$out_file" 2>&1
zero_files_code=$?
set -e
if [ "$zero_files_code" -eq 0 ]; then
  echo "ok - an existing dir with zero .sql files does not crash the guard"
  pass_count=$((pass_count + 1))
else
  echo "not ok - an existing dir with zero .sql files does not crash the guard (expected exit 0, got $zero_files_code)"
  cat "$out_file"
  fail_count=$((fail_count + 1))
fi

rm -rf "$tmp_dir"/*
rmdir "$tmp_dir" 2>/dev/null || true
set +e
"$GUARD" "$tmp_dir/does-not-exist" >"$out_file" 2>&1
missing_dir_code=$?
set -e
if [ "$missing_dir_code" -eq 0 ]; then
  echo "ok - missing migrations dir is a no-op pass"
  pass_count=$((pass_count + 1))
else
  echo "not ok - missing migrations dir is a no-op pass (got exit $missing_dir_code)"
  cat "$out_file"
  fail_count=$((fail_count + 1))
fi
mkdir -p "$tmp_dir"

echo ""
echo "$pass_count passed, $fail_count failed"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
