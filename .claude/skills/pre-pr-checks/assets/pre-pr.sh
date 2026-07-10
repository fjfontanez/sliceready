#!/usr/bin/env bash
# Every gate that must pass before a mesh-repair pull request is opened.
#
# The point of this script is the exit codes. `npm test` prints "41 passed" and
# exits 1 when a promise rejected inside a fake timer with no handler attached;
# `vitest` strips types with esbuild and never type-checks, so a green test run
# says nothing about whether the app compiles. Read $?, not the summary.
#
# Usage: .claude/skills/pre-pr-checks/assets/pre-pr.sh
# Honest opt-outs (state them in the PR; never use them to reach green):
#   SKIP_E2E=1   the 30 MB gitignored fixture is not on this machine
#   SKIP_GGA=1   no AI review budget for this run

set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2

BASE_BRANCH="${BASE_BRANCH:-main}"
RESULTS=()
FAILED=0

record() { # name status detail
  RESULTS+=("$(printf '%-22s %-7s %s' "$1" "$2" "${3:-}")")
  [ "$2" = "FAIL" ] && FAILED=1
  return 0
}

run() { # name command...
  local name="$1"; shift
  echo "── $name"
  local out ec
  out=$("$@" 2>&1); ec=$?
  if [ $ec -eq 0 ]; then
    record "$name" "PASS" "exit 0"
  else
    record "$name" "FAIL" "exit $ec"
    echo "$out" | tail -25
  fi
  return 0
}

echo "═══ pre-pr-checks · base=$BASE_BRANCH ═══"

# 1. Working tree. A dirty tree means the gates below test something that is not
#    what you are about to push.
if [ -z "$(git status --porcelain)" ]; then
  record "clean tree" "PASS"
else
  record "clean tree" "FAIL" "uncommitted changes"
  git status --short
fi

# 2. Nothing that must never be committed.
FORBIDDEN=$(git ls-files | grep -E '(^|/)(dist|test-results|playwright-report)/|\.(stl|3mf)$' | grep -v 'admesh\.wasm' || true)
if [ -z "$FORBIDDEN" ]; then
  record "no build artifacts" "PASS"
else
  record "no build artifacts" "FAIL" "tracked: $(echo "$FORBIDDEN" | tr '\n' ' ')"
fi

# 3. Commit hygiene on this branch only.
#
#    Resolve the base explicitly. On a CI runner the local `main` branch does not
#    exist — only `origin/main` does — and a swallowed `git merge-base` error
#    would leave RANGE as "..HEAD", quietly passing both gates below without
#    reading a single commit. A silent pass is the failure mode this whole script
#    exists to prevent, so it is a hard error here.
BASE_REF=""
for candidate in "$BASE_BRANCH" "origin/$BASE_BRANCH"; do
  if git rev-parse --verify --quiet "$candidate" >/dev/null; then BASE_REF="$candidate"; break; fi
done
MERGE_BASE=""
[ -n "$BASE_REF" ] && MERGE_BASE=$(git merge-base "$BASE_REF" HEAD 2>/dev/null)

if [ -z "$MERGE_BASE" ]; then
  record "commit range" "FAIL" "cannot resolve a merge base against '$BASE_BRANCH' — commit gates would pass vacuously"
  RANGE=""
elif [ "$MERGE_BASE" = "$(git rev-parse HEAD)" ]; then
  record "commit range" "PASS" "no commits ahead of $BASE_REF"
  RANGE=""
else
  record "commit range" "PASS" "$(git rev-list --count "$MERGE_BASE..HEAD") commit(s) vs $BASE_REF"
  RANGE="$MERGE_BASE..HEAD"
fi

# --no-merges throughout: on a `pull_request` event GitHub checks out a synthetic
# "Merge <sha> into <sha>" commit. Nobody wrote that subject, and judging it as a
# conventional commit fails every PR.
if [ -z "$RANGE" ]; then
  record "no AI attribution" "SKIP" "no commit range"
  record "conventional commits" "SKIP" "no commit range"
elif git log --no-merges --format='%b' "$RANGE" | grep -Eiq 'co-authored-by|generated with|🤖'; then
  record "no AI attribution" "FAIL" "found in a commit body"
else
  record "no AI attribution" "PASS"
fi

if [ -n "$RANGE" ]; then
  BAD_SUBJECTS=$(git log --no-merges --format='%s' "$RANGE" \
    | grep -vE '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9/-]+\))?!?: .+' || true)
  if [ -z "$BAD_SUBJECTS" ]; then
    record "conventional commits" "PASS"
  else
    record "conventional commits" "FAIL" "$(echo "$BAD_SUBJECTS" | head -3 | tr '\n' '; ')"
  fi
fi

# 4. Tests. Both workspaces. Exit code, not the summary line.
run "unit tests" npm test

# 5. Typecheck + bundle. Vitest never type-checks; this is the only check on
#    main.ts and viewer.ts, which cannot be unit-tested (they build a WebGLRenderer).
run "typecheck + build" npm run build -w @mesh-repair/web

# 6. End to end, cold cache, against the production build. The only exercise the
#    wiring in main.ts and viewer.ts ever gets.
#
#    Two specs run: smoke.e2e.ts builds a 10-triangle holed cube in memory and
#    always runs; repair.e2e.ts needs the 30 MB gitignored Tripo fixture and
#    fails loudly without it. MESH_REPAIR_SKIP_E2E=1 opts out of the big one —
#    that is what CI sets, because the browser measures the wiring and the
#    triangle count only measures performance.
rm -rf apps/web/node_modules/.vite
if [ "${SKIP_E2E:-0}" = "1" ]; then
  record "e2e (cold, prod)" "SKIP" "SKIP_E2E=1 — say so in the PR"
elif [ "${MESH_REPAIR_SKIP_E2E:-0}" = "1" ]; then
  run "e2e (smoke only)" npm run test:e2e -w @mesh-repair/web
elif [ ! -f packages/engine/test/fixtures/tripo-broken.3mf ]; then
  record "e2e (cold, prod)" "FAIL" "Tripo fixture missing. Restore it, or set MESH_REPAIR_SKIP_E2E=1 to run the smoke spec alone and say so in the PR"
else
  run "e2e (cold, prod)" npm run test:e2e -w @mesh-repair/web
fi

# 7. The review contract in AGENTS.md.
if [ "${SKIP_GGA:-0}" = "1" ]; then
  record "gga --pr-mode" "SKIP" "SKIP_GGA=1"
elif ! command -v gga >/dev/null 2>&1; then
  record "gga --pr-mode" "SKIP" "gga not installed"
else
  run "gga --pr-mode" gga run --pr-mode
fi

echo
echo "═══ result ═══"
printf '%s\n' "${RESULTS[@]}"
echo

if [ $FAILED -ne 0 ]; then
  echo "A gate failed. Fix the cause, not the check, then rerun."
  exit 1
fi
echo "All gates passed. Safe to open the PR."
