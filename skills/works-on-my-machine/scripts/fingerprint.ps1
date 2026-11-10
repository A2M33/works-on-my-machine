# works-on-my-machine fingerprint (Windows PowerShell 5.1+ and PowerShell 7 on any OS).
# Run it in the project folder. It prints one line starting with WOMM1: that you
# send back to whoever asked. Nothing is uploaded anywhere.
#
# What it records: OS, tool versions and which binary wins on PATH, version pin
# files, lockfile hashes, installed package versions, git state, and the NAMES of
# environment variables. Secret-looking values are never read; other values are
# reduced to an 8-character hash so only "same / different" can be told apart.
#
#   powershell -ExecutionPolicy Bypass -File fingerprint.ps1
#   powershell -ExecutionPolicy Bypass -File fingerprint.ps1 -Show
#   irm <url>/fingerprint.ps1 | iex          (uses $env:WOMM_LABEL if set)
param([string]$Label = $(if ($env:WOMM_LABEL) { $env:WOMM_LABEL } else { $env:USERNAME }),
      [switch]$Show, [switch]$NoEnv)

$ErrorActionPreference = 'SilentlyContinue'
if (-not $Label) { $Label = 'machine' }
$root = (git rev-parse --show-toplevel 2>$null)
if ($root) { Set-Location $root }
$facts = New-Object System.Collections.Generic.List[string]
function P([string]$k, $v) { $facts.Add($k + "`t" + (([string]$v) -replace '[\t\r\n]+', ' ').Trim()) }
function Have([string]$n) { [bool](Get-Command $n -CommandType Application -ErrorAction SilentlyContinue) }
function Ver([string]$s) { if ($s -match '\d+(\.\d+)+') { $Matches[0] } else { '' } }
$sha = [System.Security.Cryptography.SHA256]::Create()
function HexOf([byte[]]$b) { (($sha.ComputeHash($b) | ForEach-Object { $_.ToString('x2') }) -join '') }
function Hash8([string]$s) { (HexOf ([Text.Encoding]::UTF8.GetBytes($s))).Substring(0, 8) }
function FileHash([string]$f) {
  $b = [IO.File]::ReadAllBytes((Resolve-Path $f)); $keep = New-Object System.Collections.Generic.List[byte]
  foreach ($x in $b) { if ($x -ne 13) { $keep.Add($x) } }
  (HexOf $keep.ToArray()).Substring(0, 12)
}
function Run([string]$exe, [string[]]$a) { ((& $exe @a 2>&1) | Out-String) }

P meta.format womm1
P meta.label $Label
P meta.time ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))
P meta.collector ps1

# ---- OS ----------------------------------------------------------------
$isWin = ($env:OS -eq 'Windows_NT') -or ($PSVersionTable.PSEdition -eq 'Desktop')
if ($isWin) {
  P os.name Windows
  $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  P os.release ("{0} build {1}" -f $cv.DisplayVersion, $cv.CurrentBuild)
  $a = $env:PROCESSOR_ARCHITECTURE; if ($env:PROCESSOR_ARCHITEW6432) { $a = $env:PROCESSOR_ARCHITEW6432 }
  $archMap = @{ AMD64 = 'x64'; ARM64 = 'arm64'; x86 = 'x86' }
  P os.arch $(if ($archMap[$a]) { $archMap[$a] } else { $a })
} else {
  $u = (uname -s); P os.name $(if ($u -eq 'Darwin') { 'macOS' } else { $u })
  P os.release $(if ($u -eq 'Darwin') { sw_vers -productVersion } else { uname -r })
  $m = (uname -m); $archMap = @{ x86_64 = 'x64'; amd64 = 'x64'; aarch64 = 'arm64' }
  P os.arch $(if ($archMap[$m]) { $archMap[$m] } else { $m })
  if (Get-Command ldd -ErrorAction SilentlyContinue) {
    $l = ((ldd --version 2>&1) | Out-String)
    if ($l -match 'musl') { P os.libc ("musl " + (Ver $l)) } elseif ($l -match 'GLIBC|GNU') { P os.libc ("glibc " + (Ver (($l -split "`n")[0]))) }
  }
}
P os.shell ("powershell " + $PSVersionTable.PSVersion.ToString())
# system code page (65001 = "Use Unicode UTF-8" is on); the console's own page changes with redirection
$cpReg = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage' -ErrorAction SilentlyContinue).ACP
P os.locale ([Globalization.CultureInfo]::CurrentCulture.Name + $(if ($cpReg) { " cp$cpReg" } else { '' }))
$tz = [TimeZoneInfo]::Local; $off = $tz.GetUtcOffset((Get-Date))
P os.tz ($tz.Id + ('{0}{1:hhmm}' -f $(if ($off -lt 0) { '-' } else { '+' }), $off))

# ---- Tools: version and every copy on PATH -----------------------------
$tools = 'node npm pnpm yarn bun deno python python3 pip pip3 uv poetry pipenv java javac mvn gradle go rustc cargo ruby bundle php composer dotnet docker podman kubectl git git-lfs make cmake gcc clang terraform dart' -split ' '
foreach ($t in $tools) {
  $cmds = @(Get-Command $t -All -CommandType Application -ErrorAction SilentlyContinue)
  if ($cmds.Count -eq 0) { continue }
  $out = switch ($t) { { $_ -in 'java', 'javac' } { Run $t @('-version') } 'go' { Run $t @('version') } 'git-lfs' { Run $t @('version') } default { Run $t @('--version') } }
  $v = Ver $out
  if ($out -match 'was not found|Microsoft Store') { $v = 'store-stub' }
  P "tool.$t.version" $(if ($v) { $v } else { 'unknown' })
  # one entry per folder, in PATH order (Get-Command lists .exe/.cmd/.ps1 variants separately)
  $dirs = New-Object System.Collections.Generic.List[string]
  foreach ($c in $cmds) { $p = Join-Path (Split-Path $c.Source) $t; if (-not $dirs.Contains($p)) { $dirs.Add($p) } }
  P "tool.$t.path" $dirs[0]
  if ($dirs.Count -gt 1) { P "tool.$t.all" ($dirs -join ' | ') }
}

# ---- Version pins --------------------------------------------------------
function FirstLine([string]$f) { (Get-Content $f | Where-Object { $_ -notmatch '^\s*(#|$)' } | Select-Object -First 1) }
foreach ($f in '.nvmrc', '.node-version', '.python-version', '.ruby-version', '.java-version', '.terraform-version', '.bun-version', 'rust-toolchain', '.sdkmanrc') {
  if (Test-Path $f -PathType Leaf) { P "pin.$f" (FirstLine $f) }
}
if (Test-Path .tool-versions) {
  foreach ($l in Get-Content .tool-versions) { if ($l -match '^\s*([^#\s]+)\s+(\S+)') { P "pin.tool-versions.$($Matches[1])" $Matches[2] } }
}
if (Test-Path go.mod) { $g = Select-String -Path go.mod -Pattern '^go (\d\S*)' | Select-Object -First 1; if ($g) { P pin.go.mod $g.Matches[0].Groups[1].Value } }
if (Test-Path rust-toolchain.toml) { $g = Select-String -Path rust-toolchain.toml -Pattern 'channel\s*=\s*"([^"]+)"' | Select-Object -First 1; if ($g) { P pin.rust-toolchain.toml $g.Matches[0].Groups[1].Value } }
if (Test-Path global.json) { $g = Select-String -Path global.json -Pattern '"version"\s*:\s*"([^"]+)"' | Select-Object -First 1; if ($g) { P pin.global.json $g.Matches[0].Groups[1].Value } }

# ---- Lockfiles (CR stripped, so autocrlf alone does not change the hash) ---
foreach ($f in 'package-lock.json npm-shrinkwrap.json pnpm-lock.yaml yarn.lock bun.lock bun.lockb poetry.lock uv.lock Pipfile.lock requirements.txt Cargo.lock go.sum Gemfile.lock composer.lock gradle.lockfile packages.lock.json' -split ' ') {
  if (Test-Path $f -PathType Leaf) { P "lock.$f" (FileHash $f) }
}

# ---- Git -----------------------------------------------------------------
if (git rev-parse --git-dir 2>$null) {
  P git.head (git rev-parse HEAD)
  P git.branch (git rev-parse --abbrev-ref HEAD)
  # untracked files that are still empty are this script's own output (fingerprint.ps1 > out.txt)
  $ch = @(git status --porcelain --untracked-files=no | Where-Object { $_ } | ForEach-Object { $_.Substring(3) })
  $ut = @(git ls-files --others --exclude-standard | Where-Object { $_ -and (Test-Path $_ -PathType Leaf) -and (Get-Item $_).Length -gt 0 })
  P git.dirty $ch.Count
  P git.untracked $ut.Count
  $allCh = @($ch + $ut | Select-Object -First 15)
  if ($allCh.Count) { P git.changed_files ($allCh -join ',') }
  foreach ($k in 'core.autocrlf', 'core.eol', 'core.filemode', 'core.ignorecase', 'core.symlinks') {
    $v = (git config --get $k); P "git.$k" $(if ($v) { $v } else { 'unset' })
  }
  $eol = @(git ls-files --eol)
  $crlf = @($eol | Where-Object { $_ -match 'w/crlf' })
  P git.crlf_files $crlf.Count
  P git.crlf_scripts @($crlf | Where-Object { $_ -match '\.(sh|bash|py|rb|pl)$|(^|/)(gradlew|Dockerfile|Makefile)$' }).Count
  foreach ($l in @(git submodule status)) { if ($l -match '^\s*[-+U ]?([0-9a-f]+)\s+(\S+)') { P "git.submodule.$($Matches[2])" $l.Trim().Split(' ')[0] } }
  if ((Test-Path .gitattributes) -and (Select-String -Path .gitattributes -Pattern 'filter=lfs' -Quiet)) {
    P git.lfs_used 1
    if (Have git-lfs) { P git.lfs_pointers @(git lfs ls-files | Where-Object { $_ -match ' - ' }).Count } else { P git.lfs_pointers no-git-lfs }
  }
  $localRe = '(^|/)(\.env[^/]*|[^/]*\.local(\.[^/]+)?|[^/]*override[^/]*|\.npmrc|\.yarnrc[^/]*|local_settings\.py|application-local[^/]*|appsettings\.Development\.json|master\.key|credentials[^/]*\.json)$'
  foreach ($f in @(git ls-files --others --ignored --exclude-standard --directory | Where-Object { $_ -match $localRe } | Select-Object -First 40)) {
    P "local.$f" present
    if (($f -match '(^|/)\.env') -and (Test-Path $f -PathType Leaf)) {
      foreach ($l in @(Get-Content $f | Select-Object -First 400)) {
        if ($l -match '^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)=') { P "dotenv.$f.$($Matches[2])" set }
      }
    }
  }
}

# ---- Package manager config ---------------------------------------------
$homeDir = $(if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME })
foreach ($f in '.npmrc', (Join-Path $homeDir '.npmrc')) {
  if (Test-Path $f -PathType Leaf) {
    foreach ($l in @(Get-Content $f | Where-Object { $_ -match '^\s*(@[^:]+:)?registry\s*=' } | Select-Object -First 3)) {
      $k, $v = $l -split '=', 2; P "cfg.npmrc.$($k.Trim())" (($v.Trim()) -replace '//[^/@]*@', '//')
    }
  }
}
foreach ($f in (Join-Path $env:APPDATA 'pip\pip.ini'), (Join-Path $homeDir '.config/pip/pip.conf'), (Join-Path $homeDir '.pip/pip.conf')) {
  if ($f -and (Test-Path $f -PathType Leaf)) {
    foreach ($l in @(Get-Content $f | Where-Object { $_ -match '^\s*(extra-)?index-url' } | Select-Object -First 2)) {
      $k, $v = $l -split '=', 2; P "cfg.pip.$($k.Trim())" (($v.Trim()) -replace '//[^/@]*@', '//')
    }
  }
}
if ($env:PIP_INDEX_URL) { P cfg.pip.index-url ($env:PIP_INDEX_URL -replace '//[^/@]*@', '//') }
if (Have docker) { P docker.context (docker context show) }

# ---- Node project details (asks node itself) ----------------------------
$nodeJs = @'
const fs=require("fs"),path=require("path");const p=(k,v)=>console.log(k+"\t"+String(v).replace(/[\t\r\n]+/g," "));
p("node.abi",process.versions.modules);p("node.openssl",process.versions.openssl);
let pj;try{pj=JSON.parse(fs.readFileSync("package.json","utf8"))}catch(e){}
if(pj){if(pj.engines)for(const[k,v]of Object.entries(pj.engines))p("pin.engines."+k,v);if(pj.packageManager)p("pin.packageManager",pj.packageManager);
const deps=Object.assign({},pj.optionalDependencies,pj.devDependencies,pj.dependencies);const names=Object.keys(deps).sort();p("npm.declared",names.length);
for(const d of names.slice(0,400)){const dir=path.join("node_modules",d);try{const m=JSON.parse(fs.readFileSync(path.join(dir,"package.json"),"utf8"));p("npm."+d,m.version);
const od=Object.keys(m.optionalDependencies||{});if(m.gypfile||m.binary||fs.existsSync(path.join(dir,"binding.gyp"))||od.some(x=>/(darwin|linux|win32|musl|gnu|msvc)/.test(x)))p("npm.native."+d,1)}catch(e){p("npm."+d,"missing")}}}
'@
if ((Test-Path package.json) -and (Have node)) {
  $tmp = [IO.Path]::GetTempFileName() + '.js'; [IO.File]::WriteAllText($tmp, $nodeJs)
  foreach ($l in @(node $tmp)) { if ($l) { $facts.Add($l) } }
  Remove-Item $tmp
}

# ---- Python project details (asks the project's interpreter) ------------
$pyCode = @'
import sys,platform
def p(k,v): print(k+"\t"+" ".join(str(v).split()))
p("py.version",platform.python_version());p("py.impl",platform.python_implementation());p("py.venv",int(sys.prefix!=getattr(sys,"base_prefix",sys.prefix)));p("py.bits",platform.architecture()[0])
try:
    from importlib import metadata as md
    seen={}
    for d in md.distributions():
        n=(d.metadata["Name"] or "").lower().replace("_","-")
        if n and n not in seen: seen[n]=d.version
    for n in sorted(seen)[:600]: p("pip."+n,seen[n])
except Exception: pass
'@
if ((Test-Path pyproject.toml) -or (Test-Path setup.py) -or (Test-Path Pipfile) -or (Test-Path requirements*.txt)) {
  $py = $null
  foreach ($c in '.venv/Scripts/python.exe', 'venv/Scripts/python.exe', 'env/Scripts/python.exe', '.venv/bin/python', 'venv/bin/python') { if (Test-Path $c) { $py = (Resolve-Path $c).Path; break } }
  if ($py) { P py.interpreter project-venv } else {
    foreach ($c in 'python3', 'python') { if ((Have $c) -and ((& $c -c 'print(1)' 2>$null) -eq '1')) { $py = $c; break } }
    P py.interpreter $(if ($py) { $py } else { 'none' })
  }
  if ($py) {
    $tmp = [IO.Path]::GetTempFileName() + '.py'; [IO.File]::WriteAllText($tmp, $pyCode)
    foreach ($l in @(& $py $tmp)) { if ($l) { $facts.Add($l) } }
    Remove-Item $tmp
  }
}

# ---- Environment variable names (values hashed or skipped) --------------
if (-not $NoEnv) {
  $skip = '^(HOME|USER|USERNAME|LOGNAME|HOSTNAME|PWD|OLDPWD|SHLVL|_|PATH|MAIL|TMPDIR|TMP|TEMP|DISPLAY|XAUTHORITY|COLUMNS|LINES|PS1|PS2|PS4|IFS|HIST.*|TERM_SESSION_ID|WT_SESSION|WT_PROFILE_ID|SSH_.*|XDG_.*|DBUS_.*|.*_SOCK|WINDOWID|VSCODE_.*|GIT_ASKPASS|.*PROMPT.*|LS_COLORS|LSCOLORS|ORIGINAL_PATH|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEPATH|HOMEDRIVE|COMPUTERNAME|USERDOMAIN.*|LOGONSERVER|SESSIONNAME|PSModulePath|PSExecutionPolicyPreference|OneDrive.*)$'
  $secret = 'TOKEN|SECRET|PASSW|PWD|KEY|AUTH|CRED|PRIVATE|SESSION|COOKIE|DSN|CONN|_URL$|_URI$'
  foreach ($e in Get-ChildItem env: | Sort-Object Name) {
    $k = $e.Name
    if ($k -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or $k -match $skip) { continue }
    if ($k -match $secret) { P "env.$k" set } else { P "env.$k" ("h:" + (Hash8 ([string]$e.Value))) }
  }
}

# ---- Output -------------------------------------------------------------
$text = ($facts -join "`n") + "`n"
if ($Show) { $text; return }
$ms = New-Object IO.MemoryStream
$gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress)
$bytes = [Text.Encoding]::UTF8.GetBytes($text); $gz.Write($bytes, 0, $bytes.Length); $gz.Close()
$blob = 'WOMM1:' + [Convert]::ToBase64String($ms.ToArray())
$copied = $false
try { Set-Clipboard -Value $blob -ErrorAction Stop; $copied = $true } catch {}
[Console]::Error.WriteLine("works-on-my-machine: recorded $($facts.Count) facts about this machine (run with -Show to read them).")
if ($copied) { [Console]::Error.WriteLine("It is already copied. Paste it back to whoever sent you this:") }
else { [Console]::Error.WriteLine("Copy the line below and send it back to whoever sent you this:") }
[Console]::Error.WriteLine("")
$blob
