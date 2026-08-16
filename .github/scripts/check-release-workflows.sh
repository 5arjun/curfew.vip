#!/usr/bin/env bash
# Static invariants for release-*.yml. Those workflows only ever run on a tag
# push, so nothing in ordinary CI executes them and breakage accumulates
# silently — both checks below correspond to a bug that sat on main undetected
# and failed a real release run on 2026-08-16.
set -euo pipefail
fail=0

# 1. The version anchor the "Sync app version from git tag" step greps for must
#    exist verbatim. Broken once already by an unrelated web story (a1e42ce).
if ! grep -q '^version = "0.0.0"$' agent/src-tauri/Cargo.toml; then
  echo "::error::agent/src-tauri/Cargo.toml lost its 0.0.0 version anchor; release-*.yml fails at 'Sync app version from git tag'"
  fail=1
fi

# 2. tauri-action runs the CLI with cwd=projectPath (agent/), so --config on the
#    `args:` line resolves from there. Reading only that line, not the whole
#    file, so prose mentioning --config in a comment can't be mistaken for config.
for wf in .github/workflows/release-macos.yml .github/workflows/release-windows.yml; do
  line=$(grep -E '^[[:space:]]*args:' "$wf" || true)
  if [ -z "$line" ]; then
    echo "::error::$wf has no args: line"; fail=1; continue
  fi
  cfg=$(sed -nE 's/.*--config[[:space:]]+([^[:space:]]+).*/\1/p' <<<"$line")
  if [ -z "$cfg" ]; then
    echo "::error::$wf args: line has no --config"; fail=1; continue
  fi
  if [ ! -f "agent/$cfg" ]; then
    echo "::error::$wf --config '$cfg' does not resolve to agent/$cfg (tauri-action runs with cwd=agent/)"
    fail=1
  fi
done

[ "$fail" -eq 0 ] && echo "release workflow invariants OK"
exit $fail
