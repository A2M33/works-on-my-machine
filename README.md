# works-on-my-machine

A Claude Code skill for the oldest bug report in software: it runs for you and breaks for
someone else.

Tell Claude "works on my machine, not on Sara's". Claude fingerprints your machine and
writes Sara a two-line message. She runs one command (she needs no Claude and no install)
and pastes back a single line. Claude diffs both machines and hands you the likely causes
in order, each with the command that fixes it.

```
## Works on ali, fails on sara

ali: Windows x64  |  sara: Windows x64  |  same commit

1. [HIGH] node 20.18.1 on sara, but .nvmrc asks for 24
   ali has node 24.22.1, which matches.
   Fix: Install Node 24: nvm install 24; nvm use 24 (or fnm / volta)

2. [MEDIUM] 1 environment variable(s) the code reads are set on ali only
   Missing on sara: STRIPE_KEY
   Fix: Put them in sara's .env (ask the owner for the values; they were not shared).

3. [MEDIUM] Local files on ali that sara does not have: .env.local

4. [MEDIUM] 1 script(s) on sara have Windows line endings (CRLF)
   Fix: Add "*.sh text eol=lf" to .gitattributes, commit, then on sara: git rm --cached -r . && git reset --hard
```

The same flow covers "passes locally, fails in CI": Claude reads the fingerprint
straight from the GitHub Actions log.

## Install

As a plugin:

```
/plugin marketplace add A2M33/works-on-my-machine
/plugin install works-on-my-machine@a2m33
```

Or copy `skills/works-on-my-machine` into `~/.claude/skills/` (all projects) or
`.claude/skills/` (one project).

Then say it the way you would to a colleague: "this works for me but crashes on Jonas's
laptop", "CI fails and I can't reproduce it".

## What it compares

| Layer | Examples of what it catches |
|---|---|
| Code | different commit, uncommitted files that only you have |
| Runtimes | Node, Python, Java, Go, Rust, Ruby, .NET versions against `.nvmrc`, `.python-version`, `engines`, `.tool-versions`, `go.mod`, `global.json` |
| Packages | lockfile drift, packages missing or at other versions in `node_modules` or the virtualenv, native modules built for another platform |
| Environment | env vars your code reads (`process.env.X`, `os.environ`, `getenv`...) that one side lacks, gitignored `.env.local` files |
| PATH | the Microsoft Store python stub, a stale second copy of a tool that wins |
| Git checkout | CRLF in shell scripts, filename case sensitivity, submodules, Git LFS files never pulled |
| Config | npm registry, pip index, time zone, console code page |

Claude then lines the ranking up against the actual error message, so a `bad interpreter`
error puts the CRLF finding first even when a version also differs.

## What the other person shares

You can read the facts before sending: add `--show` (or `-Show` on Windows).

- Collected: tool versions and paths, OS and CPU type, values from version pin files,
  lockfile hashes, installed package versions, git commit, branch and settings, names of
  changed files, names of gitignored config files, env var names, key names inside `.env`
  files.
- Never read: values of env vars that look secret (`TOKEN`, `KEY`, `SECRET`, `PASS`,
  `AUTH`, `*_URL`...) and anything inside `.env` files. Other env values turn into an
  8-character hash, enough to tell "same" from "different".
- Nothing gets uploaded. The person copies the line and sends it however they like.
- `--no-env` / `-NoEnv` leaves env vars out.

The one-liners pull a tagged release (`v1.0.0`), so the script you read on GitHub is the
script that runs.

## Run it without Claude

```
# on each machine, in the project folder
sh skills/works-on-my-machine/scripts/fingerprint.sh --label ali > ali.txt      # macOS / Linux / Git Bash
powershell -ExecutionPolicy Bypass -File skills\works-on-my-machine\scripts\fingerprint.ps1 -Label sara > sara.txt

# anywhere with Node 18+
node skills/works-on-my-machine/scripts/compare.mjs ali.txt sara.txt --repo .
```

## License

MIT
