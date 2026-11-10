import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { decode, satisfies, analyze, render } from "../skills/works-on-my-machine/scripts/compare.mjs";

const fp = (obj) => new Map(Object.entries({ "meta.format": "womm1", "os.name": "Linux", "os.arch": "x64", ...obj }));
const top = (W, B, opts) => analyze(W, B, opts).findings[0];

test("satisfies handles pin files and engine ranges", () => {
  assert.equal(satisfies("24.1.0", "24"), true);
  assert.equal(satisfies("20.18.1", "v24"), false);
  assert.equal(satisfies("3.12.4", "3.12"), true);
  assert.equal(satisfies("3.11.9", "3.12"), false);
  assert.equal(satisfies("20.11.0", ">=18 <21"), true);
  assert.equal(satisfies("22.0.0", ">=18 <21"), false);
  assert.equal(satisfies("20.12.0", "^20.10.0"), true);
  assert.equal(satisfies("21.0.0", "^20.10.0"), false);
  assert.equal(satisfies("18.2.0", "16 || 18"), true);
  assert.equal(satisfies("20.1.0", "20.x"), true);
  assert.equal(satisfies("20.1.0", "lts/iron"), null);
  assert.equal(satisfies("", "20"), null);
});

test("decode finds a WOMM1 line inside pasted chat text, even when wrapped", () => {
  const body = "meta.format\twomm1\nmeta.label\tsara\ntool.node.version\t20.1.0\n";
  const b64 = zlib.gzipSync(body).toString("base64");
  const pasted = `hey here it is:\nWOMM1:${b64.slice(0, 20)}\n${b64.slice(20)}\nthanks`;
  const f = decode(pasted);
  assert.equal(f.get("meta.label"), "sara");
  assert.equal(f.get("tool.node.version"), "20.1.0");
  assert.equal(decode(body).get("meta.label"), "sara"); // --show output works too
  assert.throws(() => decode("nothing here"));
});

test("different commit outranks everything", () => {
  const f = top(fp({ "git.head": "aaaaaaaa1", "pin..nvmrc": "24", "tool.node.version": "24.0.0" }),
    fp({ "git.head": "bbbbbbbb2", "pin..nvmrc": "24", "tool.node.version": "20.0.0" }));
  assert.match(f.title, /same commit/);
});

test("uncommitted changes on the working machine are flagged", () => {
  const f = top(fp({ "git.head": "a", "git.dirty": "2", "git.changed_files": "src/a.js,src/b.js" }), fp({ "git.head": "a", "git.dirty": "0" }));
  assert.match(f.title, /uncommitted/);
  assert.match(f.detail, /src\/a\.js/);
});

test("pin violation names the file and the fix", () => {
  const f = top(fp({ "pin..nvmrc": "24", "tool.node.version": "24.2.0", "node.abi": "137" }), fp({ "pin..nvmrc": "24", "tool.node.version": "20.18.1", "node.abi": "115" }));
  assert.match(f.title, /node 20\.18\.1 .* \.nvmrc asks for 24/);
  assert.match(f.fix, /nvm/);
});

test("python pin uses the project interpreter, not the first python on PATH", () => {
  const f = top(fp({ "pin..python-version": "3.12", "tool.python.version": "3.9.0", "py.version": "3.12.3" }),
    fp({ "pin..python-version": "3.12", "tool.python.version": "3.12.1", "py.version": "3.11.2" }));
  assert.match(f.title, /python 3\.11\.2/);
});

test("missing node packages point at the lockfile's install command", () => {
  const W = fp({ "lock.pnpm-lock.yaml": "abc", "npm.declared": "5", "npm.a": "1.0.0", "npm.b": "1.0.0", "npm.c": "1.0.0", "npm.d": "1.0.0", "npm.e": "1.0.0" });
  const B = fp({ "lock.pnpm-lock.yaml": "abc", "npm.declared": "5", "npm.a": "missing", "npm.b": "missing", "npm.c": "missing", "npm.d": "missing", "npm.e": "missing" });
  const f = top(W, B);
  assert.match(f.title, /5 Node packages/);
  assert.match(f.fix, /pnpm install --frozen-lockfile/);
});

test("env vars count only when the code reads them", () => {
  const W = fp({ "env.STRIPE_KEY": "set", "env.GAMENET_KIOSK": "h:1", "dotenv..env.local.DB_HOST": "set" });
  const B = fp({});
  const r = analyze(W, B, { envRefs: new Set(["STRIPE_KEY", "DB_HOST"]) });
  const env = r.findings.find((x) => x.layer === "env" && /environment variable/.test(x.title));
  assert.match(env.detail, /STRIPE_KEY/);
  assert.match(env.detail, /DB_HOST/);
  assert.doesNotMatch(env.detail, /GAMENET/);
});

test("CRLF scripts, LFS without git-lfs and venv mismatch are caught", () => {
  const r = analyze(fp({ "git.crlf_scripts": "0", "git.lfs_used": "1", "git.lfs_pointers": "0", "py.interpreter": "project-venv", "py.version": "3.12.0" }),
    fp({ "git.crlf_scripts": "3", "git.core.autocrlf": "true", "git.lfs_used": "1", "git.lfs_pointers": "no-git-lfs", "py.interpreter": "python3", "py.version": "3.12.0" }));
  const titles = r.findings.map((f) => f.title).join("\n");
  assert.match(titles, /line endings/);
  assert.match(titles, /git-lfs/);
  assert.match(titles, /virtualenv/);
});

test("Microsoft Store python stub is called out", () => {
  const r = analyze(fp({ "py.version": "3.12.0", "tool.python.version": "3.12.0" }),
    fp({ "os.name": "Windows", "tool.python.version": "store-stub", "tool.python.path": "C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps\\python" }));
  assert.ok(r.findings.some((f) => /Store placeholder/.test(f.title)));
});

test("npm major difference is demoted when node itself differs", () => {
  const r = analyze(fp({ "lock.package-lock.json": "a", "npm.x": "1.0.0", "tool.node.version": "24.0.0", "tool.npm.version": "11.0.0" }),
    fp({ "lock.package-lock.json": "a", "npm.x": "1.0.0", "tool.node.version": "20.0.0", "tool.npm.version": "10.0.0" }));
  assert.match(r.findings[0].title, /node 24/);
  assert.ok(r.findings.find((f) => /^npm/.test(f.title)).score < 30);
});

test("identical machines produce a clean card", () => {
  const same = { "git.head": "a", "tool.node.version": "24.0.0", "npm.x": "1.0.0" };
  const r = analyze(fp(same), fp(same));
  assert.equal(r.findings.length, 0);
  assert.match(render(r), /No meaningful difference/);
});
