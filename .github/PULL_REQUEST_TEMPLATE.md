## Target and scope

<!-- Normal contributions target dev. Use feature/<area>/<description>, change/<area>/<description>
or fix/<area>/<description>. Maintainer release/<version> PRs target main; synchronization PRs
return releases to dev. See BRANCHING.md. For a release, record the selected full dev commit SHA. -->

## What and why

<!-- What this changes, and why. Link the issue: "Closes #123". -->

## How it was tested

<!-- The tests you added or changed, and anything you checked by hand (demo mode is fine). -->

## Completion report (AGENTS.md §9)

1. Summary:
2. Files changed:
3. Commands run and actual results (format:check / lint / typecheck / test / build):
4. Acceptance criteria — met / not met (evidence):
5. Assumptions (and where documented):
6. Contract or shared-file changes proposed:
7. Known gaps / follow-ups:
8. Next recommended task:

## Checklist

- [ ] Correct PR base (`dev` for normal work; `main` for a maintainer release)
- [ ] One purpose; shared files (AGENTS.md §5) isolated and explained
- [ ] Validation results recorded honestly; explain any local checks deferred to CI
- [ ] Tests added for every new behaviour; fixtures synthetic or sanitized; no real `claude` in tests
- [ ] Docs updated; nothing planned is described as implemented; `CHANGELOG.md` updated if users
      would notice
- [ ] No conversation content, credentials, real transcripts or personal paths committed
- [ ] Written with a coding agent? Say which, and confirm you reviewed the diff yourself
