#!/usr/bin/env bash
# Story 2.1 (Task 5) — CI-enforced arm of the additive-only migration rule
# (AD-15 / AR-12), documented as team convention in supabase/README.md.
#
# Migrations are individually-immutable, append-only files, so a static text
# scan for forbidden DDL is the simplest correct guard -- there is no
# baseline snapshot to keep in sync, unlike a schema-diff approach.
#
# Usage: check-additive-only-migrations.sh [migrations-dir]
set -euo pipefail

MIGRATIONS_DIR="${1:-supabase/migrations}"
ESCAPE_MARKER="additive-only: allow"

# Each entry: "label|regex". Regex is matched case-insensitively per line.
FORBIDDEN_PATTERNS=(
  "DROP COLUMN|drop[[:space:]]+column"
  "DROP TABLE|drop[[:space:]]+table"
  "RENAME COLUMN|rename[[:space:]]+column"
  "RENAME TO|rename[[:space:]]+to"
  "ALTER COLUMN ... TYPE|alter[[:space:]]+column[[:space:]]+[^[:space:]]+[[:space:]]+type([[:space:]]|$)"
)

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "No migrations directory at $MIGRATIONS_DIR -- nothing to check."
  exit 0
fi

shopt -s nullglob
migration_files=("$MIGRATIONS_DIR"/*.sql)

violations=0

for file in "${migration_files[@]}"; do
  while IFS=: read -r line_num line_text; do
    if grep -qiF "$ESCAPE_MARKER" <<<"$line_text"; then
      continue
    fi

    for entry in "${FORBIDDEN_PATTERNS[@]}"; do
      label="${entry%%|*}"
      pattern="${entry#*|}"
      if grep -qiE "$pattern" <<<"$line_text"; then
        echo "Forbidden DDL ($label) in $file:$line_num"
        echo "  $line_text"
        violations=$((violations + 1))
      fi
    done
  done < <(grep -n '' "$file")
done

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "$violations forbidden DDL statement(s) found under $MIGRATIONS_DIR/*.sql."
  echo "Migrations must be additive-only (AD-15 / AR-12) -- see supabase/README.md."
  echo "A rare, deliberate exception can be marked with an inline"
  echo "'-- $ESCAPE_MARKER' comment on the offending line."
  exit 1
fi

echo "All migrations under $MIGRATIONS_DIR are additive-only."
