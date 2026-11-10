# How compare.mjs ranks (for manual comparison or when you doubt a score)

Score 80+ is HIGH, 50-79 MEDIUM, 30-49 LOW, below 30 hidden unless `--all`.

| Score | Finding | Facts |
|---|---|---|
| 100 | Different commit | `git.head` |
| 95 | Uncommitted / untracked changes on the WORKING side | `git.dirty`, `git.untracked`, `git.changed_files` |
| 92 | Broken side violates a version pin the working side meets | `pin.*` vs `tool.<t>.version` (`py.version` for python) |
| 90 / 82 | Packages installed on works, missing on broken (more than 3 → 90) | `npm.*`, `pip.*` |
| 88 | A runtime or package manager the project uses is not installed | `tool.*` vs lockfiles and pins |
| 86 | Windows Store python stub | `tool.python.version = store-stub` |
| 85 | Lockfile content differs (CR stripped before hashing) | `lock.*` |
| 85 / 82 | Git LFS missing / pointers not pulled | `git.lfs_*` |
| 84 | Native package versions differ | `npm.native.*` |
| 80 / 74 | Package versions differ (more than 5 → 80) | `npm.*`, `pip.*` |
| 80 | Submodule at a different commit | `git.submodule.*` |
| 79 | Broken side not using the project virtualenv | `py.interpreter` |
| 78 / 46 / 12 | Unpinned runtime differs: major / minor / patch | `tool.<t>.version` |
| 76 | Env var the code reads is set only on works (env or `.env*`) | `env.*`, `dotenv.*` + repo scan |
| 72 | Gitignored local config files only on works | `local.*` |
| 70 | Shell scripts with CRLF on broken only | `git.crlf_scripts` |
| 68 | Local changes on the broken side | `git.dirty` |
| 62 | Native packages + different OS/arch/libc | `npm.native.*`, `os.*` |
| 55 | Works ignores filename case, broken does not | `git.core.ignorecase` |
| 44 | Several copies of a used tool on broken's PATH | `tool.<t>.all` |
| 40 | Package manager major differs (14 if node major differs too) | `tool.npm/pnpm/yarn.version` |
| 38 | Env var the code reads has a different value hash | `env.*` |
| 34 | Registry / index differs | `cfg.*` |
| 30 | Windows console not UTF-8 | `os.locale` |
| 24 | Time zone differs | `os.tz` |
| 20 | Different OS or arch | `os.*` |
