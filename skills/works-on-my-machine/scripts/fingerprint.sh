#!/bin/sh
# works-on-my-machine fingerprint (macOS, Linux, WSL, Git Bash).
# Run it in the project folder. It prints one line starting with WOMM1: that you
# send back to whoever asked. Nothing is uploaded anywhere.
#
# What it records: OS, tool versions and which binary wins on PATH, version pin
# files, lockfile hashes, installed package versions, git state, and the NAMES of
# environment variables. Secret-looking values are never read; other values are
# reduced to an 8-character hash so only "same / different" can be told apart.
#
#   sh fingerprint.sh            print the WOMM1: line (and copy it if possible)
#   sh fingerprint.sh --show     print the readable facts instead
#   sh fingerprint.sh --label sara --no-env
set -u

LABEL="${USER:-machine}"; SHOW=0; NOENV=0
while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="${2:-machine}"; shift ;;
    --show) SHOW=1 ;;
    --no-env) NOENV=1 ;;
    -h|--help) sed -n '2,15p' "$0" 2>/dev/null; exit 0 ;;
  esac
  shift
done

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT" || exit 1
OUT=$(mktemp 2>/dev/null || echo "/tmp/womm.$$")
trap 'rm -f "$OUT"' EXIT

# one fact per line: key<TAB>value, value flattened to one line
p() { v=$(printf '%s' "$2" | tr '\t\r\n' '   '); printf '%s\t%s\n' "$1" "$v" >> "$OUT"; }
have() { command -v "$1" >/dev/null 2>&1; }
ver() { printf '%s' "$1" | grep -Eo '[0-9]+(\.[0-9]+)+' | head -n 1; }
if have sha256sum; then SHA="sha256sum"; else SHA="shasum -a 256"; fi
hash8() { printf '%s' "$1" | $SHA | cut -c1-8; }
filehash() { tr -d '\r' < "$1" | $SHA | cut -c1-12; }

p meta.format womm1
p meta.label "$LABEL"
p meta.time "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
p meta.collector sh

# ---- OS ----------------------------------------------------------------
OSN=$(uname -s 2>/dev/null)
case "$OSN" in
  Linux) if grep -qi microsoft /proc/version 2>/dev/null; then p os.wsl 1; fi
         p os.name Linux
         p os.release "$( (. /etc/os-release 2>/dev/null && printf '%s %s' "$ID" "$VERSION_ID") || uname -r)" ;;
  Darwin) p os.name macOS; p os.release "$(sw_vers -productVersion 2>/dev/null)" ;;
  MINGW*|MSYS*|CYGWIN*) p os.name Windows; p os.release "$(uname -r)"; p os.shell_env "$OSN" ;;
  *) p os.name "$OSN"; p os.release "$(uname -r)" ;;
esac
ARCH=$(uname -m 2>/dev/null)
case "$ARCH" in amd64|x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; esac
p os.arch "$ARCH"
if have ldd; then
  L=$(ldd --version 2>&1 | head -n 1)
  case "$L" in *musl*) p os.libc "musl $(ver "$(ldd --version 2>&1)")" ;; *GLIBC*|*GNU*) p os.libc "glibc $(ver "$L")" ;; esac
fi
p os.shell "$(basename "${SHELL:-sh}")"
p os.locale "${LC_ALL:-${LANG:-unset}}"
p os.tz "$( (date +%Z) 2>/dev/null)$(date +%z 2>/dev/null)"

# ---- Tools: version and every copy on PATH -----------------------------
paths_of() {
  t="$1"; found=""; old_ifs=$IFS; IFS=:
  for d in $PATH; do
    [ -n "$d" ] || continue
    for c in "$d/$t" "$d/$t.exe"; do
      if [ -f "$c" ] && [ -x "$c" ]; then
        case " | $found | " in *" | $c | "*) ;; *) found="${found:+$found | }$c" ;; esac
        break
      fi
    done
  done
  IFS=$old_ifs; printf '%s' "$found"
}
for t in node npm pnpm yarn bun deno python python3 pip pip3 uv poetry pipenv java javac mvn gradle \
         go rustc cargo ruby bundle php composer dotnet docker podman kubectl git git-lfs make cmake gcc clang terraform dart; do
  have "$t" || continue
  case "$t" in
    java|javac) out=$("$t" -version 2>&1 | head -n 1) ;;
    go) out=$(go version 2>&1) ;;
    git-lfs) out=$(git-lfs version 2>&1) ;;
    *) out=$("$t" --version 2>&1 | head -n 3 | tr '\n' ' ') ;;
  esac
  v=$(ver "$out")
  case "$out" in *"was not found"*|*"Microsoft Store"*) v="store-stub" ;; esac
  p "tool.$t.version" "${v:-unknown}"
  all=$(paths_of "$t")
  p "tool.$t.path" "$(command -v "$t")"
  case "$all" in *" | "*) p "tool.$t.all" "$all" ;; esac
done

# ---- Version pins --------------------------------------------------------
for f in .nvmrc .node-version .python-version .ruby-version .java-version .terraform-version .bun-version rust-toolchain .sdkmanrc; do
  [ -f "$f" ] && p "pin.$f" "$(grep -v '^[[:space:]]*#' "$f" | grep -v '^[[:space:]]*$' | head -n 1)"
done
if [ -f .tool-versions ]; then
  grep -v '^[[:space:]]*#' .tool-versions | while read -r tool v _; do [ -n "$tool" ] && p "pin.tool-versions.$tool" "$v"; done
fi
[ -f go.mod ] && p pin.go.mod "$(grep -E '^go [0-9]' go.mod | head -n 1 | cut -d' ' -f2)"
[ -f rust-toolchain.toml ] && p pin.rust-toolchain.toml "$(grep -E 'channel' rust-toolchain.toml | head -n 1 | grep -Eo '"[^"]+"' | tr -d '"')"
[ -f global.json ] && p pin.global.json "$(grep -Eo '"version"[^,}]*' global.json | head -n 1 | grep -Eo '[0-9][0-9.]*[A-Za-z0-9.-]*')"

# ---- Lockfiles (CR stripped, so autocrlf alone does not change the hash) ---
for f in package-lock.json npm-shrinkwrap.json pnpm-lock.yaml yarn.lock bun.lock bun.lockb poetry.lock uv.lock Pipfile.lock \
         requirements.txt Cargo.lock go.sum Gemfile.lock composer.lock gradle.lockfile packages.lock.json; do
  [ -f "$f" ] && p "lock.$f" "$(filehash "$f")"
done

# ---- Git -----------------------------------------------------------------
if git rev-parse --git-dir >/dev/null 2>&1; then
  p git.head "$(git rev-parse HEAD 2>/dev/null)"
  p git.branch "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  # untracked files that are still empty are this script's own output (sh fingerprint.sh > out.txt)
  ch=$(git status --porcelain --untracked-files=no 2>/dev/null | cut -c4-)
  ut=$(git ls-files --others --exclude-standard 2>/dev/null | while read -r f; do [ -s "$f" ] && printf '%s\n' "$f"; done)
  p git.dirty "$(printf '%s' "$ch" | grep -c .)"
  p git.untracked "$(printf '%s' "$ut" | grep -c .)"
  all_ch=$(printf '%s\n%s\n' "$ch" "$ut" | grep . | head -n 15 | tr '\n' ',' | sed 's/,$//')
  [ -n "$all_ch" ] && p git.changed_files "$all_ch"
  for k in core.autocrlf core.eol core.filemode core.ignorecase core.symlinks; do
    p "git.$k" "$(git config --get "$k" 2>/dev/null || echo unset)"
  done
  eol=$(git ls-files --eol 2>/dev/null)
  p git.crlf_files "$(printf '%s\n' "$eol" | grep -c 'w/crlf')"
  p git.crlf_scripts "$(printf '%s\n' "$eol" | grep 'w/crlf' | grep -cE '\.(sh|bash|py|rb|pl)$|(^|/)(gradlew|Dockerfile|Makefile)$')"
  git submodule status 2>/dev/null | while read -r sha path _; do p "git.submodule.$path" "$sha"; done
  if grep -qs 'filter=lfs' .gitattributes; then
    p git.lfs_used 1
    if have git-lfs; then p git.lfs_pointers "$(git lfs ls-files 2>/dev/null | grep -c ' - ')"; else p git.lfs_pointers no-git-lfs; fi
  fi
  # ignored local config files that one machine may have and the other not
  git ls-files --others --ignored --exclude-standard --directory 2>/dev/null \
    | grep -E '(^|/)(\.env[^/]*|[^/]*\.local(\.[^/]+)?|[^/]*override[^/]*|\.npmrc|\.yarnrc[^/]*|local_settings\.py|application-local[^/]*|appsettings\.Development\.json|master\.key|credentials[^/]*\.json)$' \
    | head -n 40 | while read -r f; do
      p "local.$f" present
      case "$f" in
        *.env|*.env.*|.env*|*/.env*)
          [ -f "$f" ] && grep -E '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=' "$f" \
            | sed -E 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/' | head -n 80 \
            | while read -r k; do p "dotenv.$f.$k" set; done ;;
      esac
    done
fi

# ---- Package manager config ---------------------------------------------
for f in .npmrc "$HOME/.npmrc"; do
  [ -f "$f" ] && grep -E '^[[:space:]]*(@[^:]+:)?registry[[:space:]]*=' "$f" | head -n 3 | while read -r l; do
    p "cfg.npmrc.$(printf '%s' "$l" | cut -d= -f1 | tr -d ' ')" "$(printf '%s' "$l" | cut -d= -f2- | sed -E 's#//[^/@]*@#//#' | tr -d ' ')"
  done
done
for f in "$HOME/.config/pip/pip.conf" "$HOME/.pip/pip.conf" /etc/pip.conf; do
  [ -f "$f" ] && grep -E '^[[:space:]]*(extra-)?index-url' "$f" | head -n 2 | while read -r l; do
    p "cfg.pip.$(printf '%s' "$l" | cut -d= -f1 | tr -d ' ')" "$(printf '%s' "$l" | cut -d= -f2- | sed -E 's#//[^/@]*@#//#' | tr -d ' ')"
  done
done
[ -n "${PIP_INDEX_URL:-}" ] && p cfg.pip.index-url "$(printf '%s' "$PIP_INDEX_URL" | sed -E 's#//[^/@]*@#//#')"
have docker && p docker.context "$(docker context show 2>/dev/null)"

# ---- Node project details (asks node itself) ----------------------------
NODE_JS='const fs=require("fs"),path=require("path");const p=(k,v)=>console.log(k+"\t"+String(v).replace(/[\t\r\n]+/g," "));
p("node.abi",process.versions.modules);p("node.openssl",process.versions.openssl);
let pj;try{pj=JSON.parse(fs.readFileSync("package.json","utf8"))}catch(e){}
if(pj){if(pj.engines)for(const[k,v]of Object.entries(pj.engines))p("pin.engines."+k,v);if(pj.packageManager)p("pin.packageManager",pj.packageManager);
const deps=Object.assign({},pj.optionalDependencies,pj.devDependencies,pj.dependencies);const names=Object.keys(deps).sort();p("npm.declared",names.length);
for(const d of names.slice(0,400)){const dir=path.join("node_modules",d);try{const m=JSON.parse(fs.readFileSync(path.join(dir,"package.json"),"utf8"));p("npm."+d,m.version);
const od=Object.keys(m.optionalDependencies||{});if(m.gypfile||m.binary||fs.existsSync(path.join(dir,"binding.gyp"))||od.some(x=>/(darwin|linux|win32|musl|gnu|msvc)/.test(x)))p("npm.native."+d,1)}catch(e){p("npm."+d,"missing")}}}'
if [ -f package.json ] && have node; then node -e "$NODE_JS" >> "$OUT" 2>/dev/null; fi

# ---- Python project details (asks the project's interpreter) ------------
PY_CODE='import sys,platform
def p(k,v): print(k+"\t"+" ".join(str(v).split()))
p("py.version",platform.python_version());p("py.impl",platform.python_implementation());p("py.venv",int(sys.prefix!=getattr(sys,"base_prefix",sys.prefix)));p("py.bits",platform.architecture()[0])
try:
    from importlib import metadata as md
    seen={}
    for d in md.distributions():
        n=(d.metadata["Name"] or "").lower().replace("_","-")
        if n and n not in seen: seen[n]=d.version
    for n in sorted(seen)[:600]: p("pip."+n,seen[n])
except Exception: pass'
if [ -f pyproject.toml ] || [ -f setup.py ] || [ -f Pipfile ] || ls requirements*.txt >/dev/null 2>&1; then
  PY=""
  for c in .venv/bin/python venv/bin/python env/bin/python .venv/Scripts/python.exe venv/Scripts/python.exe; do [ -x "$c" ] && PY="$c" && break; done
  if [ -n "$PY" ]; then p py.interpreter project-venv; else
    for c in python3 python; do have "$c" && "$c" -c 'import sys' >/dev/null 2>&1 && PY="$c" && break; done
    p py.interpreter "${PY:-none}"
  fi
  [ -n "$PY" ] && "$PY" -c "$PY_CODE" >> "$OUT" 2>/dev/null
fi

# ---- Environment variable names (values hashed or skipped) --------------
if [ "$NOENV" -eq 0 ]; then
  env | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' | cut -d= -f1 | sort -u | while read -r k; do
    case "$k" in
      HOME|USER|USERNAME|LOGNAME|HOSTNAME|SHELL|TERM|TERM_PROGRAM*|EDITOR|VISUAL|PAGER|LESS|PWD|OLDPWD|SHLVL|_|PATH|MAIL|TMPDIR|TMP|TEMP|DISPLAY|XAUTHORITY|COLUMNS|LINES|PS1|PS2|PS4|IFS|OPTIND|PPID|RANDOM|SECONDS|LINENO|HIST*|TERM_SESSION_ID|WT_SESSION|SSH_*|XDG_*|DBUS_*|*_SOCK|WINDOWID|VSCODE_*|GIT_ASKPASS|*PROMPT*|LS_COLORS|LSCOLORS|OLDPWD|ORIGINAL_PATH|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEPATH|HOMEDRIVE|COMPUTERNAME|USERDOMAIN*|LOGONSERVER|SESSIONNAME) continue ;;
    esac
    case "$k" in
      *TOKEN*|*SECRET*|*PASSW*|*PWD*|*KEY*|*AUTH*|*CRED*|*PRIVATE*|*SESSION*|*COOKIE*|*DSN*|*CONN*|*_URL|*_URI|*token*|*secret*|*key*|*pass*)
        p "env.$k" set ;;
      *) eval "val=\${$k-}"; p "env.$k" "h:$(hash8 "$val")" ;;
    esac
  done
fi

# ---- Output -------------------------------------------------------------
if [ "$SHOW" -eq 1 ]; then cat "$OUT"; exit 0; fi
BLOB="WOMM1:$(gzip -c -9 < "$OUT" | base64 | tr -d '\n\r')"
COPIED=""
for c in pbcopy wl-copy "xclip -selection clipboard" "xsel --clipboard --input" clip.exe clip; do
  set -- $c
  if have "$1"; then printf '%s' "$BLOB" | $c 2>/dev/null && COPIED=1 && break; fi
done
N=$(wc -l < "$OUT" | tr -d ' ')
echo "works-on-my-machine: recorded $N facts about this machine (run with --show to read them)." >&2
if [ -n "$COPIED" ]; then echo "It is already copied. Paste it back to whoever sent you this:" >&2
else echo "Copy the line below and send it back to whoever sent you this:" >&2; fi
echo "" >&2
printf '%s\n' "$BLOB"
