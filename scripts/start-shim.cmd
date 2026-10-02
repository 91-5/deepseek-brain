@echo off
rem ===========================================================================
rem  deepseek-brain shim launcher (idempotent)
rem
rem  Design notes:
rem   * Project root is derived from %~dp0\.. so the repo can live anywhere.
rem     No hardcoded absolute path.
rem   * Idempotent guard: if something already LISTENS on the port we exit 0
rem     and never start a second instance. Two node processes sharing one
rem     .chrome-profile directory cause a Chromium profile lock conflict,
rem     which is nastier than EADDRINUSE.
rem   * PORT env var overrides the default 8790; config.ts reads the same var,
rem     so the guard and the server always agree on the port.
rem   * stdout/stderr are APPENDED to dated files under logs\ so history is
rem     never overwritten.
rem   * Readiness is polled on /health for up to ~30s, then this script exits
rem     and leaves the detached node process running.
rem
rem  Comments are intentionally ASCII-only: a .cmd carrying UTF-8 or GBK text
rem  renders as mojibake unless the console codepage happens to match.
rem ===========================================================================
setlocal EnableExtensions

rem --- 1. port --------------------------------------------------------------
if not defined PORT set "PORT=8790"

rem --- 2. project root, derived from this script's own location --------------
for %%I in ("%~dp0..") do set "PROJROOT=%%~fI"

if not exist "%PROJROOT%\dist\cli.js" (
    echo [shim] FATAL: "%PROJROOT%\dist\cli.js" not found. Run "npm run build" first.
    endlocal & exit /b 1
)

rem --- 3. idempotent guard ---------------------------------------------------
rem  PORTSTATE stays empty if the probe itself could not run. We then refuse to
rem  start blind: a false "free" verdict risks a duplicate instance, and a false
rem  "listening" verdict would silently never start. Refusing loudly wins.
set "PORTSTATE="
for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "$c = @(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue); if ($c.Count -gt 0) { 'LISTENING' } else { 'FREE' }"`) do set "PORTSTATE=%%S"

if /i "%PORTSTATE%"=="LISTENING" (
    echo [shim] port %PORT% is already listening - shim already running. Nothing to do.
    endlocal & exit /b 0
)
if not "%PORTSTATE%"=="FREE" (
    echo [shim] FATAL: could not probe port %PORT% ^(probe state="%PORTSTATE%"^). Refusing to start blind.
    endlocal & exit /b 1
)

rem --- 4. locate node -------------------------------------------------------
set "NODE="
for %%N in (node.exe) do if not defined NODE set "NODE=%%~$PATH:N"
if not defined NODE (
    echo [shim] FATAL: node.exe not found on PATH. Node ^>=20 is required.
    endlocal & exit /b 1
)

rem --- 5. locate curl.exe (in PATH, else the known System32 copy) -----------
set "CURL="
for %%C in (curl.exe) do if not defined CURL set "CURL=%%~$PATH:C"
if not defined CURL if exist "%SystemRoot%\System32\curl.exe" set "CURL=%SystemRoot%\System32\curl.exe"
if not defined CURL (
    echo [shim] FATAL: curl.exe not found. Needed for the /health readiness probe.
    endlocal & exit /b 1
)

rem --- 6. dated log files (append, keep history) ----------------------------
set "STAMP="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"`) do set "STAMP=%%D"
if not defined STAMP set "STAMP=unknown-date"

if not exist "%PROJROOT%\logs" mkdir "%PROJROOT%\logs" >nul 2>&1
set "LOG=%PROJROOT%\logs\shim-%STAMP%.log"
set "ERRLOG=%PROJROOT%\logs\shim-%STAMP%.err.log"

rem --- 7. launch detached so the shim outlives this script ------------------
rem  "start" (without /wait) hands node its own process; this script exits while
rem  node keeps running. PORT stays in the child environment, so config.ts picks
rem  it up via loadConfig(process.env).
echo [shim] starting: node dist\cli.js  (port %PORT%, cwd "%PROJROOT%")
rem  NB: "cd ... || exit /b 1" would be wrong. cmd parses "a || b & c" as
rem  "(a || b) & c", so the trailing exit would fire even when cd succeeded.
cd /d "%PROJROOT%"
if errorlevel 1 (
    echo [shim] FATAL: could not cd to "%PROJROOT%".
    endlocal & exit /b 1
)
start "" /b "%NODE%" "%PROJROOT%\dist\cli.js" 1>>"%LOG%" 2>>"%ERRLOG%"

rem --- 8. readiness probe: /health must answer 200 within ~30s ---------------
set "HEALTH=http://127.0.0.1:%PORT%/health"
set "TRIES=0"
:wait_ready
set /a TRIES+=1
"%CURL%" -s -f -o NUL "%HEALTH%" >nul 2>&1
if not errorlevel 1 goto :ready
if %TRIES% geq 30 goto :not_ready
ping -n 2 127.0.0.1 >nul 2>&1
goto :wait_ready

:not_ready
echo [shim] WARNING: %HEALTH% did not answer 200 within ~30s ^(tried %TRIES% times^).
echo [shim] The process WAS launched. On a first run it may still be waiting for
echo [shim] you to log in to chat.deepseek.com in the Chrome window it opened.
echo [shim] stdout: %LOG%
echo [shim] stderr: %ERRLOG%
endlocal & exit /b 0

:ready
echo [shim] READY: %HEALTH% returned 200 after %TRIES% attempt^(s^).
echo [shim] stdout: %LOG%
echo [shim] stderr: %ERRLOG%
endlocal & exit /b 0