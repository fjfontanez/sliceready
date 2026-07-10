---
name: pre-pr-checks
description: "Trigger: open a PR, pre-PR, before pushing, ready to merge, finishing a branch. Run every mesh-repair gate and read the exit codes, not the summaries."
license: Apache-2.0
metadata:
  author: "fjfontanez"
  version: "1.0"
---

## Activation Contract

Load before opening, pushing to, or marking ready any pull request in this repo. Also load when a
task claims work is finished and a merge is the next step.

Do not load for a docs-only change that touches no file matched by `.gga`'s `FILE_PATTERNS`.

## Hard Rules

- Read the EXIT CODE of every command. Never conclude from a summary line. A Vitest suite reports
  `Tests 41 passed` and exits `1` when a promise rejected in a fake timer had no handler attached.
- Never weaken an assertion, extend a timeout, or set an opt-out to reach green. A failing gate is
  the gate working.
- Never run the e2e against the dev server. It must exercise the production build.
- Wipe `apps/web/node_modules/.vite` before the e2e. A warm cache hides the cold-start reload that
  a fresh clone hits.
- If a gate fails, STOP and report. Do not open the PR.

## Decision Gates

| Condition | Action |
|---|---|
| Diff touches `packages/engine/` or `apps/web/src/` | Run every gate |
| Diff is docs, spec, or plan only | Run `hygiene` only |
| `packages/engine/test/fixtures/tripo-broken.3mf` absent | The e2e FAILS. Do not set `MESH_REPAIR_SKIP_E2E=1` to hide it — restore the fixture, or state plainly in the PR that the e2e did not run |
| `gga` is not installed | Report `gga: skipped (not installed)`. Do not silently omit it |

## Execution Steps

1. Run `.claude/skills/pre-pr-checks/assets/pre-pr.sh` from the repo root.
2. Read its final table. Every row must be `PASS`.
3. For any `FAIL`, fix the cause — never the check — and rerun the whole script.
4. Report the table verbatim in the PR body or to the user. Name any gate that was skipped and why.

Env overrides, for stating limits honestly, never for reaching green:
`SKIP_E2E=1` (no fixture on this machine), `SKIP_GGA=1` (no AI review budget this run).

## Output Contract

Return the script's result table, the exit code of the script itself, and one line per skipped gate
explaining why. If any gate failed, return the failing command's output and stop.

## References

- `.claude/skills/pre-pr-checks/assets/pre-pr.sh` — the gates.
- `AGENTS.md` — the review contract `gga run --pr-mode` enforces.
