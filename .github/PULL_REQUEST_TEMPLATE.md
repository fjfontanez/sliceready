<!-- ⚠️ READ BEFORE SUBMITTING
  Every PR must be linked to an issue that has the "status:approved" label.
  PRs without a linked approved issue are automatically rejected by CI.
  See CONTRIBUTING.md for the full workflow.
-->

## 🔗 Linked Issue

Closes #

<!-- Replace with the issue number, e.g.: Closes #42 -->

---

## 🏷️ PR Type

Add exactly one `type:*` label to this PR:

- [ ] `type:bug` — Bug fix (non-breaking)
- [ ] `type:feature` — New feature (non-breaking)
- [ ] `type:docs` — Documentation only
- [ ] `type:refactor` — Code refactoring (no behavior change)
- [ ] `type:chore` — Build, CI, dependencies, or tooling
- [ ] `type:breaking-change` — Changes existing behavior

---

## 📝 Summary

<!-- What does this PR do, and why? -->

---

## 📂 Changes

| File / Area | What changed |
|-------------|--------------|
| `path/to/file` | Brief description |

---

## 🧪 Test Plan

Run every gate — the same script CI runs:

```bash
.claude/skills/pre-pr-checks/assets/pre-pr.sh
```

- [ ] `pre-pr.sh` exits `0` (unit tests, typecheck + build, e2e smoke)
- [ ] Manually tested locally (describe below if relevant)

---

## ✅ Contributor Checklist

- [ ] Linked to an issue with `status:approved`
- [ ] Exactly one `type:*` label applied
- [ ] Stays within 400 changed lines, or a maintainer applied `size:exception` with rationale
- [ ] Honors the honest-reporting rule: the tool never claims a repair it did not make
- [ ] New behavior has a test
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) with no `Co-Authored-By` trailers

---

## 💬 Notes for Reviewers

<!-- Optional: anything reviewers should pay special attention to. -->
