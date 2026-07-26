#!/usr/bin/env bash
# Story 2.1 (Task 5) — CI-enforced arm of the additive-only migration rule
# (AD-15 / AR-12), documented as team convention in supabase/README.md.
#
# Migrations are individually-immutable, append-only files, so a static text
# scan for forbidden DDL is the simplest correct guard -- there is no
# baseline snapshot to keep in sync, unlike a schema-diff approach.
#
# Scanning is statement-aware and lexically aware of SQL comments and string
# literals: `--` line comments and `/* ... */` block comments are stripped
# before matching, and single-quoted string literal contents are blanked out
# (so a `--` inside a DEFAULT expression's string can't hide a real statement
# after it, and a comment or string mentioning "why we don't drop a column
# here" doesn't trip the guard). Each `;`-terminated statement is joined onto
# one line before matching, so a statement wrapped across several lines --
# ordinary SQL formatting, or one prefixed with `ALTER TABLE IF EXISTS`, or
# combined with another clause via a comma -- is still caught. Column-level
# DROP/RENAME/TYPE-change patterns tolerate Postgres's optional `COLUMN`
# keyword and the `SET DATA TYPE` spelling, explicitly exclude `DROP
# CONSTRAINT` (never one of this guard's forbidden forms), and are anchored
# to an `ALTER TABLE` prefix so they don't misfire on dropping/renaming other
# object kinds (triggers, functions, indexes, tablespaces, ...). The escape
# marker only excuses the statement whose own terminating `;` shares a
# physical line with the marker comment -- it does not leak onto an earlier
# statement sharing that line, or onto a later statement completed on a
# different line.
#
# Usage: check-additive-only-migrations.sh [migrations-dir]
set -euo pipefail

MIGRATIONS_DIR="${1:-supabase/migrations}"
ESCAPE_MARKER="additive-only: allow"

# label|regex pairs, matched case-insensitively against a whole (joined,
# comment-stripped, string-blanked) statement. Order matters: more specific
# whole-object patterns are listed before the broader column-level ones so a
# `DROP TABLE` is reported once, under the right label, instead of also
# matching the generic column-drop pattern.
FORBIDDEN_PATTERNS=(
  "DROP TABLE|drop[[:space:]]+table([[:space:]]|\$|;)"
  "RENAME TO|^alter[[:space:]]+table[[:space:]]+(if[[:space:]]+exists[[:space:]]+)?[^[:space:];]+.*rename[[:space:]]+to[[:space:]]+[^[:space:];]+"
  "DROP COLUMN|^alter[[:space:]]+table[[:space:]]+(if[[:space:]]+exists[[:space:]]+)?[^[:space:];]+.*drop[[:space:]]+(column[[:space:]]+)?[^[:space:];]+"
  "RENAME COLUMN|^alter[[:space:]]+table[[:space:]]+(if[[:space:]]+exists[[:space:]]+)?[^[:space:];]+.*rename[[:space:]]+(column[[:space:]]+)?[^[:space:];]+[[:space:]]+to[[:space:]]+[^[:space:];]+"
  "ALTER COLUMN ... TYPE|^alter[[:space:]]+table[[:space:]]+(if[[:space:]]+exists[[:space:]]+)?[^[:space:];]+.*alter[[:space:]]+(column[[:space:]]+)?[^[:space:];]+[[:space:]]+(set[[:space:]]+data[[:space:]]+)?type([[:space:]]|\$|;)"
)

# Not a forbidden action (never one of this guard's five named DDL forms) --
# checked before DROP COLUMN so a constraint drop isn't mislabeled as one.
CONSTRAINT_DROP_PATTERN='^alter[[:space:]]+table[[:space:]]+(if[[:space:]]+exists[[:space:]]+)?[^[:space:];]+.*drop[[:space:]]+constraint([[:space:]]|$|;)'

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "No migrations directory at $MIGRATIONS_DIR -- nothing to check."
  exit 0
fi

shopt -s nullglob nocaseglob
migration_files=("$MIGRATIONS_DIR"/*.sql)
shopt -u nocaseglob

violations=0

for file in "${migration_files[@]+"${migration_files[@]}"}"; do
  [ -f "$file" ] || continue

  # Emit one record per `;`-terminated statement: the lexically-scrubbed
  # (comments stripped, string literals blanked), whitespace-normalized,
  # line-joined statement text, a tab, then 1 if the physical line carrying
  # that statement's own terminating `;` also carried a `--` comment with
  # the escape marker.
  while IFS=$'\t' read -r stmt_text escaped; do
    [ -z "$stmt_text" ] && continue
    [ "$escaped" = "1" ] && continue

    if grep -qiE "$CONSTRAINT_DROP_PATTERN" <<<"$stmt_text"; then
      continue
    fi

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
  done < <(awk -v marker="$ESCAPE_MARKER" -v sq="'" '
    BEGIN { stmt = ""; in_block_comment = 0 }
    {
      raw = $0
      n = length(raw)
      code = ""
      comment = ""
      in_string = 0
      i = 1
      while (i <= n) {
        c = substr(raw, i, 1)
        if (in_block_comment) {
          if (c == "*" && substr(raw, i + 1, 1) == "/") { in_block_comment = 0; i += 2 }
          else { i++ }
          continue
        }
        if (in_string) {
          if (c == sq) {
            if (substr(raw, i + 1, 1) == sq) { code = code "  "; i += 2 }
            else { in_string = 0; code = code " "; i++ }
          } else { code = code " "; i++ }
          continue
        }
        if (c == sq) { in_string = 1; code = code c; i++; continue }
        if (c == "/" && substr(raw, i + 1, 1) == "*") { in_block_comment = 1; i += 2; continue }
        if (c == "-" && substr(raw, i + 1, 1) == "-") { comment = substr(raw, i + 2); i = n + 1; continue }
        code = code c
        i++
      }
      line_esc = (index(tolower(comment), tolower(marker)) > 0) ? 1 : 0
      stmt = stmt " " code
      nfrag = 0
      while ((p = index(stmt, ";")) > 0) {
        out = substr(stmt, 1, p - 1)
        gsub(/^[ \t]+|[ \t]+$/, "", out)
        gsub(/[ \t]+/, " ", out)
        nfrag++
        frag[nfrag] = out
        stmt = substr(stmt, p + 1)
      }
      for (k = 1; k <= nfrag; k++) {
        e = (k == nfrag) ? line_esc : 0
        print frag[k] "\t" e
        delete frag[k]
      }
    }
    END {
      gsub(/^[ \t]+|[ \t]+$/, "", stmt)
      gsub(/[ \t]+/, " ", stmt)
      if (stmt != "") print stmt "\t" 0
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
