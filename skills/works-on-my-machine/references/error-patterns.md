# Error text → the difference that usually explains it

Use this to re-rank `compare.mjs` findings against the error the broken machine shows.

| Error contains | Look first at |
|---|---|
| `SyntaxError: Unexpected token`, `is not a function` on a built-in (`Object.groupBy`, `Array.prototype.findLast`, `structuredClone`, `fetch is not defined`) | Node major version |
| `ERR_REQUIRE_ESM`, `Cannot use import statement outside a module`, `ERR_UNKNOWN_FILE_EXTENSION` | Node version, then package versions |
| `Cannot find module 'x'`, `Module not found`, `ModuleNotFoundError: No module named 'x'` | Missing packages, wrong virtualenv, then filename case (Linux) |
| `was compiled against a different Node.js version`, `NODE_MODULE_VERSION`, `invalid ELF header`, `not a valid Win32 application`, `Could not load the "sharp" module` | Native packages + platform / Node ABI: delete node_modules, reinstall |
| `GLIBC_2.xx not found`, `musl` | `os.libc` (Alpine vs Debian images, old distros) |
| `bad interpreter`, `\r: command not found`, `$'\r'`, `/usr/bin/env: 'bash\r'` | CRLF scripts |
| `version 'x' of 'y' required`, `engine "node" is incompatible`, `Unsupported engine` | Pin violation |
| `ERR_PNPM_OUTDATED_LOCKFILE`, `npm ci can only install packages when your package.json and package-lock.json are in sync`, `poetry.lock is not consistent` | Lockfile difference or uncommitted lockfile |
| `undefined` / `KeyError` / `is not set` / `Missing required environment variable` / auth `401` against a service | Env var the code reads, missing on one side; local `.env*` files |
| `ENOENT` / `FileNotFoundError` on a path with `\` or `/`, `C:\` in a Linux error | Platform: hard-coded paths |
| File exists but `ENOENT` / import fails only on Linux or CI | Filename case (`core.ignorecase`) |
| `version https://git-lfs.github.com/spec/v1` inside a file, image or model "corrupt" | Git LFS pointers |
| `Python was not found; run without arguments to install from the Microsoft Store` | Store stub on PATH |
| `UnicodeDecodeError`, `charmap codec can't encode` | Windows console code page (not UTF-8) |
| A date/time test off by hours or one day | Time zone |
| `unable to get local issuer certificate`, `SELF_SIGNED_CERT_IN_CHAIN`, `ETIMEDOUT` to a registry | Registry / index config, proxy (outside the fingerprint: ask about VPN/proxy) |
| `EACCES`, `Permission denied`, `Operation not permitted` | Outside the fingerprint: file ownership, antivirus, `sudo npm install` history |
| Different behaviour, no error | Uncommitted changes on the working side, different commit, package versions |
