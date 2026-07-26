#!/usr/bin/env bash
# Story 2.1 (Task 5) — CI-enforced arm of the additive-only migration rule
# (AD-15 / AR-12), documented as team convention in supabase/README.md.
#
# Migrations are individually-immutable, append-only files, so a static text
# scan for forbidden DDL is the simplest correct guard -- there is no
# baseline snapshot to keep in sync, unlike a schema-diff approach.
#
# Scanning is statement-aware, not line-aware: `--` comments are stripped
# before matching (so a comment describing "why we don't drop a column
# here" doesn't trip the guard), and each `;`-terminated statement is joined
# onto one line before matching (so a statement wrapped across several
# lines -- ordinary SQL formatting -- is still caught). Column-level
# DROP/RENAME/TYPE-change patterns tolerate Postgres's optional `COLUMN`
# keyword and the `SET DATA TYPE` spelling, and are anchored to an
# `ALTER TABLE ... ALTER/DROP/RENAME` prefix so they don't misfire on
# dropping/renaming other object kinds (triggers, functions, indexes, ...).
# The escape marker only counts when it appears inside an actual `--`
# comment attached to the statement it excuses, not as a bare substring
# anywhere on the line.
#
# Usage: check-additive-only-migrations.sh [migrations-dir]
set -euo pipefail

MIGRATIONS_DIR="${1:-supabase/migrations}"
ESCAPE_MARKER="additive-only: allow"

# label|regex pairs, matched case-insensitively against a whole (joined,
# comment-stripped) statement. Order matters: more specific whole-object
# patterns are listed before the broader column-level ones so a `DROP TABLE`
# is reported once, under the right label, instead of also matching the
# generic column-drop pattern.
FORBIDDEN_PATTERNS=(
  "DROP TABLE|drop[[:space:]]+table"
  "RENAME TO|alter[[:space:]]+table[[:space:]]+[^[:space:];]+[[:space:]]+rename[[:space:]]+to"
  "DROP COLUMN|alter[[:space:]]+table[[:space:]]+[^[:space:];]+[[:space:]]+drop[[:space:]]+(column[[:space:]]+)?[^[:space:];]+"
  "RENAME COLUMN|alter[[:space:]]+table[[:space:]]+[^[:space:];]+[[:space:]]+rename[[:space:]]+(column[[:space:]]+)?[^[:space:];]+[[:space:]]+to[[:space:]]+[^[:space:];]+"
  "ALTER COLUMN ... TYPE|alter[[:space:]]+(column[[:space:]]+)?[^[:space:];]+[[:space:]]+(set[[:space:]]+data[[:space:]]+)?type([[:space:]]|$|;)"
)

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "No migrations directory at $MIGRATIONS_DIR -- nothing to check."
  exit 0
fi

shopt -s nullglob nocaseglob
migration_files=("$MIGRATIONS_DIR"/*.sql)
shopt -u nocaseglob

violations=0

for file in "${migration_files[@]}"; do
  [ -f "$file" ] || continue

  # Emit one record per `;`-terminated statement: the comment-stripped,
  # whitespace-normalized, line-joined statement text, a tab, then 1 if a
  # `--` comment anywhere in the statement carried the escape marker.
  while IFS=$'\t' read -r stmt_text escaped; do
    [ -z "$stmt_text" ] && continue
    [ "$escaped" = "1" ] && continue

    for entry in "${FORBIDDEN_PATTERNS[@]}"; do
      label="${entry%%|*}"
      pattern="${entry#*|}"
      if grep -qiE "$pattern" <<<"$stmt_text"; then
        echo "Forbidden DDL ($label) in $file:"
        echo "  $stmt_text"
        violations=$((violations + 1))
        break
      fi
    done
  done < <(awk -v marker="$ESCAPE_MARKER" '
    BEGIN { IGNORECASE = 1; stmt = ""; esc = 0 }
    {
      line = $0
      comment = ""
      idx = index(line, "--")
      if (idx > 0) {
        comment = substr(line, idx + 2)
        line = substr(line, 1, idx - 1)
      }
      if (index(tolower(comment), tolower(marker)) > 0) { esc = 1 }
      stmt = stmt " " line
      while ((p = index(stmt, ";")) > 0) {
        out = substr(stmt, 1, p - 1)
        gsub(/^[ \t]+|[ \t]+$/, "", out)
        gsub(/[ \t]+/, " ", out)
        print out "\t" esc
        stmt = substr(stmt, p + 1)
        esc = 0
      }
    }
    END {
      gsub(/^[ \t]+|[ \t]+$/, "", stmt)
      gsub(/[ \t]+/, " ", stmt)
      if (stmt != "") print stmt "\t" esc
    }
  ' "$file")
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
