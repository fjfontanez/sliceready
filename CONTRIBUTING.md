# Contributing to SliceReady

Thanks for helping. A few things keep the project healthy.

## Before you open a PR

Run every gate — the same script CI runs:

```bash
.claude/skills/pre-pr-checks/assets/pre-pr.sh
```

It must exit `0`. Read the exit code, not the summary line.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `chore:`, `test:`, `ci:`, `refactor:`, `perf:`, `build:`, `revert:`.
No AI-attribution trailers.

## Pull requests

- Branch from `main`; keep one focused change per PR.
- Honor the honest-reporting rule: the tool never claims a repair it did not make.
- New behavior needs a test.

## License

By contributing, you agree your contributions are licensed under
**GPL-2.0-or-later** — the same license as the project and as
[ADMesh](https://github.com/admesh/admesh), which the engine links. See
[`LICENSE`](LICENSE).
