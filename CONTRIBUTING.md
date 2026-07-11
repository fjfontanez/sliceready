# Contributing to SliceReady

Thanks for helping. SliceReady uses an **issue-first** workflow — approved issues
come before pull requests. This keeps work aligned and reviews small.

## The workflow

1. **Open an issue** (bug report or feature request). It starts as `status:needs-review`.
2. **Wait for approval.** A maintainer adds `status:approved` once the work is agreed.
   Don't open a PR before this — CI will reject a PR whose linked issue isn't approved.
3. **Open a PR** that:
   - references the issue in its body: `Closes #<number>`,
   - carries **exactly one** `type:*` label,
   - stays within **400 changed lines** (or a maintainer applies `size:exception`).

## Before you open a PR

Run every gate — the same script CI runs:

```bash
.claude/skills/pre-pr-checks/assets/pre-pr.sh
```

It must exit `0`. Read the exit code, not the summary line.

## Automated PR checks

Every PR is validated by CI (`.github/workflows/pr-check.yml` + `ci.yml`):

| Check | Requirement |
|-------|-------------|
| Check Issue Reference | PR body has `Closes/Fixes/Resolves #N` |
| Check Issue Has `status:approved` | the linked issue was approved first |
| Check PR Has `type:*` Label | exactly one `type:*` label |
| Check PR Cognitive Load | ≤ 400 changed lines, or `size:exception` |
| gates | `pre-pr.sh` passes (tests, typecheck + build, e2e smoke) |

## Labels

- `status:*` — issue lifecycle: `needs-review` → `needs-design` / `needs-info` → `approved`.
- `type:*` — PR kind: `bug`, `feature`, `docs`, `refactor`, `chore`, `breaking-change`.
- `priority:*` — `high` / `medium` / `low`.
- `size:exception` — maintainer-granted waiver for an oversized PR.
- `no-merge` — blocked; do not merge yet.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `chore:`, `test:`, `ci:`, `refactor:`, `perf:`, `build:`, `revert:`.
No `Co-Authored-By` or AI-attribution trailers.

## Pull requests

- Branch from `main`; one focused change per PR.
- Honor the honest-reporting rule: the tool never claims a repair it did not make.
- New behavior needs a test.

## License

By contributing, you agree your contributions are licensed under
**GPL-2.0-or-later** — the same license as the project and as
[ADMesh](https://github.com/admesh/admesh), which the engine links. See
[`LICENSE`](LICENSE).
