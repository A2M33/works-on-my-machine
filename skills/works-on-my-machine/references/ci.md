# CI as the other machine

## Add the fingerprint step (GitHub Actions)

Put it near the top of the failing job, after `actions/checkout` and after any setup
step (setup-node, setup-python, dependency install), so it sees what the job sees.
`if: always()` keeps it running when an earlier step fails.

Linux and macOS runners:

```yaml
      - name: works-on-my-machine fingerprint
        if: always()
        run: curl -fsSL https://raw.githubusercontent.com/A2M33/works-on-my-machine/v1.0.0/skills/works-on-my-machine/scripts/fingerprint.sh | sh -s -- --label ci
```

Windows runners:

```yaml
      - name: works-on-my-machine fingerprint
        if: always()
        shell: pwsh
        run: $env:WOMM_LABEL = 'ci'; irm https://raw.githubusercontent.com/A2M33/works-on-my-machine/v1.0.0/skills/works-on-my-machine/scripts/fingerprint.ps1 | iex
```

The step prints only the WOMM1: line to the log. Secret-looking env values are not read;
GitHub masks registered secrets in logs anyway.

If the repo vendors this skill, use the local copy instead of curl:
`sh .claude/skills/works-on-my-machine/scripts/fingerprint.sh --label ci`.

Adding the step means editing a workflow file and pushing. Show the diff and ask first.
Then re-run the failing workflow: `gh run rerun <id>` re-runs the old commit, which does
not have the step, so push the change and let CI run on the new commit (or
`gh workflow run <workflow>` if it has `workflow_dispatch`).

## Pull it and compare

```
node "$SKILL/scripts/compare.mjs" <local fingerprint> --gh-run <run id or URL> --repo .
```

- `--job <part of the job name>` picks one job when a matrix produced several fingerprints
  (the error lists the jobs that have one).
- `--gh-repo owner/name` when the current folder is not that repo.
- Needs the GitHub CLI logged in (`gh auth status`).

Direction: "passes locally, fails in CI" → local is WORKS, CI is BROKEN (the default).
"Green in CI, fails locally" → add `--ci-works`, which makes CI the WORKS side and the
local file the BROKEN side.

## CI-specific causes to check against the error

- `setup-node` / `setup-python` version differs from `.nvmrc` / `.python-version`: the
  runtime finding shows it. Fix: `node-version-file: .nvmrc` / `python-version-file`.
- Secrets missing in CI (forks, Dependabot PRs and `pull_request` from forks get no
  secrets): an env var the code reads shows as set locally, missing in CI.
- Case-sensitive filesystem on Linux runners: the "ignores filename case" finding.
- Lockfile out of date: CI uses `npm ci` / `--frozen-lockfile` and fails where a local
  `npm install` quietly updated the lockfile. Shows as a lockfile difference or local
  uncommitted changes.
- Time zone: runners use UTC.
