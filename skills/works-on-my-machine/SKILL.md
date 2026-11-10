---
name: works-on-my-machine
description: Find out why a project works on one machine and fails on another. Fingerprints both environments (the other person runs one script, no Claude or install needed), diffs runtimes, pins, installed packages, env var names, PATH, git checkout state and local config, and ranks the likely causes with a fix for each. Use when the user says "works on my machine", "works for me but not for <name>", "it breaks on my teammate's / new laptop", "passes locally but fails in CI", "CI is green but it fails locally", or a project that ran yesterday fails on a different computer.
---

# works-on-my-machine

Two machines, same repo, different result. Guessing wastes hours; a fingerprint of each
side settles it in one exchange. The scripts collect facts, `compare.mjs` ranks them, and
you connect the ranking to the actual error.

Scripts live next to this file: `scripts/fingerprint.sh` (macOS, Linux, WSL, Git Bash),
`scripts/fingerprint.ps1` (Windows PowerShell 5.1+, pwsh anywhere), `scripts/compare.mjs`
(Node 18+). Below, `$SKILL` means this skill's folder.

## 1. Pin down the two sides

Establish which machine WORKS and which is BROKEN, and get the exact error text from the
broken side (message, stack trace, failing command). If the user did not give the error,
ask for it in the same message where you hand over the script (step 3). The error is the
strongest signal you will get; the fingerprint explains it.

Kinds of "other side":
- a person (teammate, client, the user's second laptop) → step 3a
- a CI run → step 3b, then read `references/ci.md`
- a Docker container or VM → run the script inside it yourself (`docker exec <c> sh -c "$(cat $SKILL/scripts/fingerprint.sh)"`)

## 2. Fingerprint the local machine

Run it from the project root. Save the output in a temp file, NOT inside the repo.

- macOS / Linux / Git Bash: `sh "$SKILL/scripts/fingerprint.sh" --label <name> > "$TMPDIR/womm-<name>.txt"`
- Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File "$SKILL\scripts\fingerprint.ps1" -Label <name> > "$env:TEMP\womm-<name>.txt"`

Use short, real labels (`ali`, `sara`, `ci`); they appear in the report.

## 3a. Get the other machine's fingerprint

Write the user a ready-to-forward message. Keep it short and friendly; the recipient may
not be a developer. Include both one-liners and the file option:

```
Can you run this in the project folder and send me the line it prints (starts with WOMM1:)?
It only reads versions and settings. Secret values are never read or sent.

Mac / Linux:   curl -fsSL https://raw.githubusercontent.com/A2M33/works-on-my-machine/v1.0.0/skills/works-on-my-machine/scripts/fingerprint.sh | sh
Windows:       irm https://raw.githubusercontent.com/A2M33/works-on-my-machine/v1.0.0/skills/works-on-my-machine/scripts/fingerprint.ps1 | iex

Prefer not to pipe from the internet? I'm attaching the script: run `sh fingerprint.sh`
or `powershell -ExecutionPolicy Bypass -File fingerprint.ps1`. Add `--show` / `-Show`
first if you want to see exactly what it collects.
```

If the user prefers no download at all, point them at the script file to attach
(`$SKILL/scripts/fingerprint.sh` or `.ps1`). Then wait for the paste.

When it arrives, save the whole pasted text to a temp file as-is. `compare.mjs` finds the
WOMM1: line inside surrounding chat text and survives line wrapping.

## 3b. CI as the other side

Read `references/ci.md`. In short: `node compare.mjs <local> --gh-run <run id or URL>`
pulls the fingerprint from the run's log. If the workflow has no fingerprint step yet,
propose adding it (show the diff, get a yes before committing or pushing).

## 4. Compare

```
node "$SKILL/scripts/compare.mjs" <works-file> <broken-file> --repo <project root>
```

Order matters: WORKS first, BROKEN second. `--repo` lets it see which env vars the code
actually reads, so unrelated variables stay out of the report. Add `--json` to read every
finding with its score, `--all` to include the low ones. `--decode <file>` prints one
fingerprint's raw facts if you need to check something by hand.

No Node on this machine? Decode with `base64 -d | gunzip` (or .NET GZipStream on
Windows), then compare the facts yourself using the ranking in `references/ranking.md`.

## 5. Connect it to the error, then report

The ranking is generic; the error is specific. Read `references/error-patterns.md` and
move the finding that explains the actual error to the top, even if it scored lower.
A finding that cannot produce this error goes down, however high it scored.

Report as a short card:
- one line: what differs and which finding explains the error
- the top 3 causes, each with its fix written as the exact command for the BROKEN
  machine's OS (`compare.mjs` already writes them; adjust for the error)
- one line on how to prevent it next time (pin file, `.gitattributes`, `.env.example`)

Do not apply fixes to the other person's machine; you cannot reach it. Repo-side fixes
(adding `.nvmrc`, `engines`, `.gitattributes`, `.env.example` entries, the CI step) you
may draft, but ask before committing.

If nothing meaningful differs, say so plainly: the cause is outside what a fingerprint
sees (data, network, firewall, permissions, hardware, a service that is down). Suggest
the next check based on the error.

## Privacy, in one paragraph (repeat it if the user or recipient asks)

The fingerprint holds tool versions and install paths, OS details, version pin values,
hashes of lockfiles, installed package versions, git commit/branch/settings, names of
changed files, names of gitignored config files, names of env vars and of keys inside
`.env` files. Values of env vars whose name looks secret (TOKEN, KEY, SECRET, PASS, AUTH,
URL, ...) are never read. Other env values become an 8-character hash, so "same or
different" is all anyone can tell. `.env` values are never read. Nothing is uploaded; the
person sends the line themselves. `--no-env` / `-NoEnv` skips env vars entirely.
