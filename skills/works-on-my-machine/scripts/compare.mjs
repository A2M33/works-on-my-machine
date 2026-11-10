#!/usr/bin/env node
// works-on-my-machine: compare two fingerprints and rank the likely causes.
//
//   node compare.mjs <works> <broken> [--json] [--all] [--repo <dir>]
//   node compare.mjs <local> --gh-run <run id or URL> [--job <name>] [--ci-works] [--json]
//   node compare.mjs --decode <fingerprint>         print the readable facts
//
// <works>/<broken> is a file holding a WOMM1: line (anywhere in it, e.g. a pasted
// chat message), a file of --show output, or the WOMM1: string itself.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

// ---------- input ----------
export function decode(text) {
  const i = text.indexOf("WOMM1:");
  let body;
  if (i >= 0) {
    // Chat apps may wrap the line, and words after it can look like base64 too.
    // gzip carries a checksum, so the longest run of tokens that decodes is the blob.
    const m = text.slice(i + 6).match(/^[A-Za-z0-9+/=\s]+/);
    const tokens = (m ? m[0] : "").split(/\s+/).filter(Boolean);
    for (let k = tokens.length; k > 0 && body === undefined; k--) {
      try { body = zlib.gunzipSync(Buffer.from(tokens.slice(0, k).join(""), "base64")).toString("utf8"); } catch {}
    }
    if (body === undefined) throw new Error("the WOMM1: line is damaged or cut off; ask for it again");
  } else if (/meta\.format\twomm1/.test(text)) body = text;
  else throw new Error("no WOMM1: fingerprint found in the input");
  const facts = new Map();
  for (const line of body.split(/\r?\n/)) {
    const t = line.indexOf("\t");
    if (t > 0) facts.set(line.slice(0, t), line.slice(t + 1).trim());
  }
  return facts;
}

function load(arg) {
  const text = fs.existsSync(arg) && fs.statSync(arg).isFile() ? fs.readFileSync(arg, "utf8") : arg;
  return decode(text);
}

function fromGhRun(run, job, repo) {
  const id = String(run).match(/(\d{5,})/)?.[1] || run;
  const args = ["run", "view", id, "--log"];
  if (repo) args.push("--repo", repo);
  const log = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256e6 });
  const found = [];
  for (const line of log.split("\n")) {
    const m = line.match(/WOMM1:[A-Za-z0-9+/=]+/);
    if (m) found.push({ job: line.split("\t")[0], blob: m[0] });
  }
  if (!found.length) throw new Error(`run ${id} has no WOMM1: line. Add the fingerprint step to the workflow (see references/ci.md) and re-run it.`);
  const pick = job ? found.find((f) => f.job.includes(job)) : found[found.length - 1];
  if (!pick) throw new Error(`no fingerprint from a job matching "${job}". Jobs with one: ${found.map((f) => f.job).join(", ")}`);
  const facts = decode(pick.blob);
  facts.set("meta.label", `CI (${pick.job})`);
  return { facts, jobs: found.map((f) => f.job) };
}

// ---------- versions ----------
const num = (v) => { const m = String(v || "").match(/\d+(\.\d+)*/); return m ? m[0].split(".").map(Number) : []; };
function cmp(a, b) {
  for (let i = 0; i < 3; i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; }
  return 0;
}
// Enough of semver ranges for pin files and engines: 22, v22.1, 3.12, 20.x, ^20.10, ~1.2, >=18 <21, a || b.
export function satisfies(version, spec) {
  const v = num(version);
  if (!v.length) return null;
  spec = String(spec).trim().replace(/^v/, "");
  if (!/\d/.test(spec)) return null; // lts/iron, latest, system
  return spec.split("||").some((part) => part.trim().split(/\s+/).every((c) => {
    const m = c.match(/^(>=|<=|>|<|=|\^|~)?v?([\d.]+[x*]?(?:\.[x*])?)/);
    if (!m) return true;
    const op = m[1] || "", raw = m[2].replace(/\.?[x*]$/, ""), w = num(raw), n = raw.split(".").filter(Boolean).length;
    const c0 = cmp(v, w);
    if (op === ">=") return c0 >= 0;
    if (op === ">") return c0 > 0;
    if (op === "<=") return c0 <= 0;
    if (op === "<") return c0 < 0;
    if (op === "^") return v[0] === w[0] && c0 >= 0 && (w[0] !== 0 || v[1] === w[1]);
    if (op === "~") return v[0] === w[0] && v[1] === (w[1] || 0) && c0 >= 0;
    return w.slice(0, n).every((x, i) => v[i] === x); // bare or = : prefix match
  }));
}

// ---------- repo context ----------
const ENV_RES = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g, /process\.env\[["']([A-Za-z_][A-Za-z0-9_]*)["']\]/g,
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g, /os\.environ(?:\.get)?[(\[]\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /\bgetenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g, /System\.getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /\bENV(?:\.fetch\(|\[)\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g, /\benv\(\s*["']([A-Z_][A-Z0-9_]*)["']/g,
  /Environment\.GetEnvironmentVariable\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g, /\$\{([A-Z_][A-Z0-9_]*)(?::?-[^}]*)?\}/g,
  /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=/gm,
];
export function envReferences(dir) {
  const keys = new Set();
  let files = [];
  try { files = execFileSync("git", ["ls-files"], { cwd: dir, encoding: "utf8", maxBuffer: 64e6 }).split("\n"); } catch { return keys; }
  const textual = /\.(m?[jt]sx?|cjs|py|rb|go|java|kt|cs|php|rs|ya?ml|toml|json|sh|ps1|ex|exs|vue|svelte|astro)$|(^|\/)(\.env\.(example|sample|template|dist|defaults)|Dockerfile|docker-compose[^/]*|Makefile|Procfile)$/;
  for (const f of files.slice(0, 20000)) {
    if (!f || !textual.test(f) || /(^|\/)(node_modules|vendor|dist|build)\//.test(f) || /lock/.test(path.basename(f))) continue;
    let t; try { const p = path.join(dir, f); if (fs.statSync(p).size > 400e3) continue; t = fs.readFileSync(p, "utf8"); } catch { continue; }
    const isEnvFile = /\.env\./.test(f);
    ENV_RES.forEach((re, i) => {
      if (i === ENV_RES.length - 1 && !isEnvFile) return; // KEY= lines only count in .env.example-type files
      for (const m of t.matchAll(re)) keys.add(m[1]);
    });
  }
  return keys;
}

// ---------- analysis ----------
const PIN_TOOL = { ".nvmrc": "node", ".node-version": "node", ".python-version": "python", ".ruby-version": "ruby",
  ".java-version": "java", ".terraform-version": "terraform", ".bun-version": "bun", "rust-toolchain": "rustc",
  "rust-toolchain.toml": "rustc", "go.mod": "go", "global.json": "dotnet",
  "engines.node": "node", "engines.npm": "npm", "engines.pnpm": "pnpm", "engines.yarn": "yarn", "engines.bun": "bun",
  "tool-versions.nodejs": "node", "tool-versions.node": "node", "tool-versions.python": "python", "tool-versions.ruby": "ruby",
  "tool-versions.golang": "go", "tool-versions.java": "java", "tool-versions.rust": "rustc", "tool-versions.terraform": "terraform" };
const LOCK_PM = { "package-lock.json": "npm", "npm-shrinkwrap.json": "npm", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn",
  "bun.lock": "bun", "bun.lockb": "bun", "poetry.lock": "poetry", "uv.lock": "uv", "Pipfile.lock": "pipenv",
  "Cargo.lock": "cargo", "go.sum": "go", "Gemfile.lock": "bundle", "composer.lock": "composer" };
const INSTALL = { npm: "npm ci", pnpm: "pnpm install --frozen-lockfile", yarn: "yarn install --frozen-lockfile", bun: "bun install --frozen-lockfile",
  poetry: "poetry install --sync", uv: "uv sync --locked", pipenv: "pipenv sync", cargo: "cargo build --locked", go: "go mod download",
  bundle: "bundle install", composer: "composer install" };

function toolVersion(f, tool) {
  if (tool === "python" && f.get("py.version")) return f.get("py.version");
  return f.get(`tool.${tool}.version`) || (tool === "python" ? f.get("tool.python3.version") : undefined);
}
const label = (f, fallback) => f.get("meta.label") || fallback;
const short = (s) => (s || "").slice(0, 8);
const list = (a, n = 5) => a.slice(0, n).join(", ") + (a.length > n ? ` and ${a.length - n} more` : "");

export function analyze(W, B, opts = {}) {
  const out = [];
  const add = (score, layer, title, detail, fix) => out.push({ score, layer, title, detail, fix });
  const wl = label(W, "works"), bl = label(B, "broken");
  const bWin = B.get("os.name") === "Windows";
  const keys = new Set([...W.keys(), ...B.keys()]);
  const pick = (prefix) => [...keys].filter((k) => k.startsWith(prefix));

  const locks = pick("lock.").map((k) => k.slice(5));
  const pms = [...new Set(locks.map((l) => LOCK_PM[l]).filter(Boolean))];
  const install = pms.map((p) => INSTALL[p]).filter(Boolean).join(" && ") || (W.get("npm.declared") ? "npm install" : "reinstall dependencies");
  const used = new Set(pms);
  if (pick("npm.").length || W.get("node.abi")) used.add("node");
  if (W.get("py.version") || B.get("py.version")) used.add("python");
  for (const k of pick("pin.")) { const t = PIN_TOOL[k.slice(4)]; if (t) used.add(t); }
  if (locks.includes("Cargo.lock")) used.add("rustc");
  if (locks.includes("Gemfile.lock")) used.add("ruby");
  if (locks.includes("composer.lock")) used.add("php");

  // 1. same code?
  const wh = W.get("git.head"), bh = B.get("git.head");
  if (wh && bh && wh !== bh) {
    const wb = W.get("git.branch"), bb = B.get("git.branch");
    add(100, "git", "You are not running the same commit",
      `${wl}: ${short(wh)} on ${wb}. ${bl}: ${short(bh)} on ${bb}.`,
      `On ${bl}: git fetch && git checkout ${short(wh)}  (or push your branch first if ${short(wh)} is only local)`);
  }
  const wd = +W.get("git.dirty") || 0, wu = +W.get("git.untracked") || 0;
  if (wd + wu > 0) add(95, "git", `${wl} has ${wd + wu} uncommitted change(s) that ${bl} does not have`,
    `Changed or untracked on ${wl}: ${W.get("git.changed_files") || "?"}. The fix may live in one of them.`,
    `Commit and push them, or check with git stash whether ${wl} still works without them.`);
  const bd = (+B.get("git.dirty") || 0) + (+B.get("git.untracked") || 0);
  if (bd > 0) add(68, "git", `${bl} has ${bd} local change(s)`, `Changed on ${bl}: ${B.get("git.changed_files") || "?"}`,
    `On ${bl}: git stash, then try again on a clean checkout.`);

  // 2. pins
  const pinned = new Set();
  for (const k of pick("pin.")) {
    const tool = PIN_TOOL[k.slice(4)]; if (!tool) continue;
    const spec = W.get(k) ?? B.get(k), file = k.slice(4).startsWith("engines.") ? `package.json engines.${k.slice(12)}` : k.slice(4);
    const wv = toolVersion(W, tool), bv = toolVersion(B, tool);
    const ws = satisfies(wv, spec), bs = bv ? satisfies(bv, spec) : false;
    if (bs === false && ws !== false) {
      pinned.add(tool);
      add(92, "runtime", bv ? `${tool} ${bv} on ${bl}, but ${file} asks for ${spec}` : `${tool} is not installed on ${bl}; ${file} asks for ${spec}`,
        `${wl} has ${tool} ${wv || "?"}, which matches.`, fixRuntime(tool, spec, bWin, file));
    } else if (ws === false && bs === false) {
      add(30, "runtime", `Neither machine matches ${file} (${spec}) for ${tool}`, `${wl}: ${wv || "none"}, ${bl}: ${bv || "none"}`, fixRuntime(tool, spec, bWin, file));
    }
  }

  // 3. tool missing / store stub
  for (const tool of used) {
    if (pinned.has(tool)) continue;
    const wv = toolVersion(W, tool), bv = toolVersion(B, tool);
    if (wv && !bv) add(88, "tool", `${tool} is not installed on ${bl}`, `${wl} has ${tool} ${wv}.`, fixRuntime(tool, num(wv)[0], bWin));
    if (bv === "store-stub") add(86, "tool", `${tool} on ${bl} is the Microsoft Store placeholder, not a real install`,
      `PATH finds ${B.get(`tool.${tool}.path`)} first.`, `Install ${tool} properly, or turn off the "App execution alias" for ${tool} in Windows settings.`);
  }

  // 4. lockfiles
  for (const l of locks) {
    const a = W.get(`lock.${l}`), b = B.get(`lock.${l}`);
    if (a && b && a !== b) add(85, "deps", `${l} differs between the machines`, `Same file, different content: one side changed it without committing.`,
      `Commit the right ${l}, then on ${bl}: ${INSTALL[LOCK_PM[l]] || install}`);
    else if (!!a !== !!b) add(84, "deps", `${l} exists only on ${a ? wl : bl}`, `It is probably untracked or ignored.`, `Commit ${l}, then run ${INSTALL[LOCK_PM[l]] || install}`);
  }

  // 5. installed packages
  for (const [prefix, eco] of [["npm.", "npm"], ["pip.", "pip"]]) {
    const names = pick(prefix).filter((k) => !/^npm\.(declared|native\.)/.test(k)).map((k) => k.slice(prefix.length));
    const missing = [], changed = [], nativeChanged = [];
    for (const n of names) {
      const a = W.get(prefix + n), b = B.get(prefix + n);
      if (!a || a === "missing") continue;
      if (!b || b === "missing") { if (eco === "npm" || W.get("py.venv") === B.get("py.venv")) missing.push(n); continue; }
      if (a !== b) (W.get(`npm.native.${n}`) ? nativeChanged : changed).push(`${n} ${a} vs ${b}`);
    }
    const ecoName = eco === "npm" ? "Node packages" : "Python packages";
    if (missing.length) add(missing.length > 3 ? 90 : 82, "deps", `${missing.length} ${ecoName} installed on ${wl} are missing on ${bl}`,
      `Missing: ${list(missing)}`, `On ${bl}: ${eco === "npm" ? install : pms.some((p) => ["uv", "poetry", "pipenv"].includes(p)) ? install : "pip install -r requirements.txt (inside the project's virtualenv)"}`);
    if (nativeChanged.length) add(84, "deps", `Native ${ecoName} differ`, list(nativeChanged), `On ${bl}: delete node_modules and run ${install}`);
    if (changed.length) add(changed.length > 5 ? 80 : 74, "deps", `${changed.length} ${ecoName} have different versions`,
      `${wl} vs ${bl}: ${list(changed)}`, `On ${bl}: ${install}`);
  }

  // 6. runtime versions (unpinned)
  for (const tool of used) {
    if (pinned.has(tool) || ["npm", "pnpm", "yarn"].includes(tool)) continue;
    const wv = toolVersion(W, tool), bv = toolVersion(B, tool);
    if (!wv || !bv || bv === "store-stub" || wv === bv) continue;
    const a = num(wv), b = num(bv);
    const [score, what] = a[0] !== b[0] ? [78, "major"] : a[1] !== b[1] ? [46, "minor"] : [12, "patch"];
    add(score, "runtime", `${tool} ${wv} on ${wl}, ${bv} on ${bl}`, `Different ${what} version, and nothing in the repo pins it.`,
      `${fixRuntime(tool, a.slice(0, 2).join("."), bWin)}. Then pin it (for example ${pinHint(tool)}) so this cannot drift again.`);
  }
  for (const pm of ["npm", "pnpm", "yarn"]) {
    if (!used.has(pm) || pinned.has(pm)) continue;
    const a = num(W.get(`tool.${pm}.version`)), b = num(B.get(`tool.${pm}.version`));
    // npm ships with node: a node major mismatch already explains it
    const nodeSplit = num(toolVersion(W, "node"))[0] !== num(toolVersion(B, "node"))[0];
    if (a.length && b.length && a[0] !== b[0]) add(pm === "npm" && nodeSplit ? 14 : 40, "tool", `${pm} ${a.join(".")} vs ${b.join(".")}`, `Different major versions can resolve or install dependencies differently.`, `Pin it with "packageManager" in package.json and run corepack enable.`);
  }

  // 7. native packages on another platform
  const natives = pick("npm.native.").map((k) => k.slice(11));
  const plat = (f) => [f.get("os.name"), f.get("os.arch"), f.get("os.libc")].filter(Boolean).join(" ");
  if (natives.length && plat(W) !== plat(B)) add(62, "platform", `Native packages and a different platform: ${list(natives, 4)}`,
    `${wl}: ${plat(W)}. ${bl}: ${plat(B)}. These ship per-platform binaries.`, `Never copy node_modules between machines. On ${bl}: delete node_modules and run ${install}`);

  // 8. env vars and local files
  const refs = opts.envRefs || new Set();
  const hasEnv = (f, k) => f.has(`env.${k}`) || [...f.keys()].some((x) => x.startsWith("dotenv.") && x.endsWith(`.${k}`));
  const missingEnv = [...refs].filter((k) => hasEnv(W, k) && !hasEnv(B, k));
  if (missingEnv.length) add(76, "env", `${missingEnv.length} environment variable(s) the code reads are set on ${wl} only`,
    `Missing on ${bl}: ${list(missingEnv, 8)}`, `Put them in ${bl}'s .env (ask the owner for the values; they were not shared). Then add them to .env.example.`);
  const diffEnv = [...refs].filter((k) => { const a = W.get(`env.${k}`), b = B.get(`env.${k}`); return a && b && a.startsWith("h:") && b.startsWith("h:") && a !== b; });
  if (diffEnv.length) add(38, "env", `${diffEnv.length} environment variable(s) the code reads have different values`, list(diffEnv, 8), `Compare the values of ${list(diffEnv, 3)} on both machines.`);
  const wLocal = pick("local.").filter((k) => W.has(k) && !B.has(k)).map((k) => k.slice(6));
  if (wLocal.length) add(72, "env", `Local files on ${wl} that ${bl} does not have: ${list(wLocal, 4)}`,
    `They are gitignored, so they never reach anyone else.`, `Copy what ${bl} needs (without secrets in chat), or document them in .env.example / the README.`);

  // 9. PATH and interpreters
  if (W.get("py.interpreter") === "project-venv" && B.get("py.interpreter") && B.get("py.interpreter") !== "project-venv")
    add(79, "path", `${bl} runs the system Python, not the project's virtualenv`, `${bl} uses ${B.get("py.interpreter")}.`,
      bWin ? `On ${bl}: python -m venv .venv; .venv\\Scripts\\activate; then ${install === "reinstall dependencies" ? "pip install -r requirements.txt" : install}` : `On ${bl}: python3 -m venv .venv && . .venv/bin/activate, then install the requirements`);
  for (const tool of used) {
    const all = B.get(`tool.${tool}.all`);
    if (!all || W.get(`tool.${tool}.all`)) continue;
    add(44, "path", `${bl} has ${all.split(" | ").length} copies of ${tool} on PATH`, `The first one wins: ${all.split(" | ")[0]}. Others: ${all.split(" | ").slice(1).join(", ")}`,
      `On ${bl}: check "${bWin ? "where.exe" : "which -a"} ${tool}" and remove or reorder the stale one.`);
  }

  // 10. git checkout details
  const wc = +W.get("git.crlf_scripts") || 0, bc = +B.get("git.crlf_scripts") || 0;
  if (bc > 0 && wc === 0) add(70, "git", `${bc} script(s) on ${bl} have Windows line endings (CRLF)`,
    `Shell scripts with CRLF fail with "bad interpreter" or "\\r: command not found". ${bl} has core.autocrlf=${B.get("git.core.autocrlf")}.`,
    `Add "*.sh text eol=lf" to .gitattributes, commit, then on ${bl}: git rm --cached -r . && git reset --hard`);
  if (W.get("git.core.ignorecase") === "true" && B.get("git.core.ignorecase") === "false")
    add(55, "git", `${wl} ignores filename case, ${bl} does not`, `An import like "./Header" for a file named header.js works on Windows and macOS and fails on Linux.`, `Search for imports whose case does not match the file name on disk; git mv to fix the file name.`);
  for (const k of pick("git.submodule.")) if (W.get(k) !== B.get(k)) add(80, "git", `Submodule ${k.slice(14)} is at a different commit`, `${wl}: ${short(W.get(k))}, ${bl}: ${short(B.get(k)) || "not checked out"}`, `On ${bl}: git submodule update --init --recursive`);
  if (B.get("git.lfs_pointers") === "no-git-lfs") add(85, "git", `This repo uses Git LFS, but ${bl} does not have git-lfs`, `Large files are still tiny pointer files there.`, `On ${bl}: install git-lfs, then git lfs install && git lfs pull`);
  else if (+B.get("git.lfs_pointers") > 0 && !(+W.get("git.lfs_pointers") > 0)) add(82, "git", `${B.get("git.lfs_pointers")} Git LFS file(s) on ${bl} were never downloaded`, `They are still pointer files.`, `On ${bl}: git lfs pull`);

  // 11. config and platform
  for (const k of pick("cfg.")) if (W.get(k) !== B.get(k)) add(34, "config", `${k.slice(4)} differs`, `${wl}: ${W.get(k) || "default"}. ${bl}: ${B.get(k) || "default"}.`, `Use the same registry or index on both, or commit it to the project's config.`);
  if (W.get("os.name") !== B.get("os.name") || W.get("os.arch") !== B.get("os.arch"))
    add(20, "platform", `Different platform: ${plat(W)} vs ${plat(B)}`, `Only matters with paths, line endings, case or native code.`, `Look for hard-coded "/" or "\\\\" paths and shell-specific scripts.`);
  const tz = (f) => (f.get("os.tz") || "").match(/[+-]\d{4}$/)?.[0];
  if (tz(W) && tz(B) && tz(W) !== tz(B)) add(24, "platform", `Different time zone (${tz(W)} vs ${tz(B)})`, `Date tests and "today" logic can pass in one zone and fail in another.`, `Run the failing test with TZ=UTC on both machines.`);
  const cp = (f) => (f.get("os.locale") || "").match(/cp(\d+)/)?.[1];
  if (bWin && cp(B) && cp(B) !== "65001" && (cp(W) === "65001" || W.get("os.name") !== "Windows")) add(30, "platform", `${bl}'s console is not UTF-8 (code page ${cp(B)})`, `Non-English output and file names can break.`, `On ${bl}: set PYTHONUTF8=1, or enable "Beta: Use Unicode UTF-8" in Windows region settings.`);

  out.sort((a, b) => b.score - a.score);
  return { works: wl, broken: bl, worksPlatform: plat(W), brokenPlatform: plat(B), sameCommit: !!(wh && bh && wh === bh), findings: out };
}

function pinHint(tool) {
  return { node: ".nvmrc", python: ".python-version", ruby: ".ruby-version", go: "the go line in go.mod", rustc: "rust-toolchain.toml", dotnet: "global.json", java: ".java-version or .tool-versions" }[tool] || ".tool-versions";
}
function fixRuntime(tool, spec, win, file) {
  const v = String(spec ?? "").replace(/^[^\d]*/, "").split(/\s/)[0] || "";
  switch (tool) {
    case "node": return file === ".nvmrc" && !win ? `On the other machine: nvm install && nvm use` : `Install Node ${v || "(the pinned version)"}: ${win ? `nvm install ${v}; nvm use ${v}` : `nvm install ${v} && nvm use ${v}`} (or fnm / volta)`;
    case "python": return `Install Python ${v}: uv python install ${v} && uv venv --python ${v}  (or pyenv install ${v})`;
    case "pnpm": case "yarn": return `corepack enable && corepack prepare ${tool}@${v || "latest"} --activate`;
    case "npm": return `npm install -g npm@${v || "latest"}`;
    case "go": return `Install Go ${v} (go.dev/dl), or set GOTOOLCHAIN=go${v}`;
    case "rustc": return `rustup toolchain install ${v || "stable"}`;
    case "ruby": return `rbenv install ${v} (or asdf install ruby ${v})`;
    case "java": return `Install JDK ${v} (sdk install java / winget) and point JAVA_HOME at it`;
    case "dotnet": return `Install .NET SDK ${v}`;
    default: return `Install ${tool} ${v}`.trim();
  }
}

// ---------- output ----------
export function render(r, all = false) {
  const top = r.findings.filter((f) => f.score >= 30);
  const show = all ? r.findings : top.slice(0, 5);
  const lines = [`## Works on ${r.works}'s machine. Why not on ${r.broken}'s?`, "",
    `${r.works}: ${r.worksPlatform}  |  ${r.broken}: ${r.brokenPlatform}  |  ${r.sameCommit ? "same commit" : "commit: see below"}`, ""];
  if (!show.length) lines.push("No meaningful difference found. The cause is probably outside what a fingerprint sees (data, network, permissions, hardware).");
  show.forEach((f, i) => {
    const level = f.score >= 80 ? "HIGH" : f.score >= 50 ? "MEDIUM" : "LOW";
    lines.push(`${i + 1}. [${level}] ${f.title}`, `   ${f.detail}`, `   Fix: ${f.fix}`, "");
  });
  const rest = r.findings.length - show.length;
  if (rest > 0) lines.push(`${rest} smaller difference(s) not shown. Run with --all to list them.`);
  return lines.join("\n");
}

// ---------- cli ----------
function main(argv) {
  const flags = new Map(); const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--gh-run", "--job", "--repo", "--gh-repo", "--decode"].includes(a)) flags.set(a, argv[++i]);
    else if (a.startsWith("--")) flags.set(a, true); else pos.push(a);
  }
  if (flags.has("--decode")) { for (const [k, v] of load(flags.get("--decode"))) console.log(`${k}\t${v}`); return; }
  if (!pos.length || flags.has("--help")) { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 9).join("\n")); return; }
  let W = load(pos[0]);
  let B;
  if (flags.has("--gh-run")) {
    B = fromGhRun(flags.get("--gh-run"), flags.get("--job"), flags.get("--gh-repo")).facts;
    if (flags.has("--ci-works")) [W, B] = [B, W];
  } else if (pos[1]) B = load(pos[1]);
  else throw new Error("need a second fingerprint (or --gh-run)");
  if (!W.has("meta.label") || W.get("meta.label") === B.get("meta.label")) { W.set("meta.label", "works"); B.set("meta.label", B.get("meta.label") === "works" ? "broken" : B.get("meta.label") || "broken"); }
  const envRefs = envReferences(flags.get("--repo") || process.cwd());
  const r = analyze(W, B, { envRefs });
  console.log(flags.has("--json") ? JSON.stringify(r, null, 2) : render(r, flags.has("--all")));
}

if (/compare\.mjs$/.test(process.argv[1] || "")) {
  try { main(process.argv.slice(2)); } catch (e) { console.error("works-on-my-machine: " + e.message); process.exit(1); }
}
