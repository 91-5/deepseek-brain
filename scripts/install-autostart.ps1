<#
.SYNOPSIS
    注册 / 卸载 deepseek-brain shim 的「登录自启」计划任务。

.DESCRIPTION
    两种注册方式，按可用性选择：

    * Registry（默认，无需管理员）：写 HKCU\Software\Microsoft\Windows\
      CurrentVersion\Run。登录时在当前用户的交互式会话里跑，Chrome 能正常
      拉起有界面窗口。非提权 shell 唯一能用的方式。
    * ScheduledTask：schtasks /create。Windows 上创建计划任务默认需要管理员
      权限，非提权会直接返回「拒绝访问」（实测于 2026-10-02）。要能创建就把
      整个脚本用管理员 PowerShell 跑。

    ScheduledTask 方式的几个关键决策（都有理由，不要随手改）：
    * 触发器用 ONLOGON，不是开机。shim 靠 puppeteer 拉有界面的 Chrome，需要
      用户的交互式会话；开机时（ONSTART）还没有会话，Chrome 起不来。
    * 用 /it 走交互式登录令牌，所以不需要保存密码（配 /it 时 /rp 可以省略）。
    * 用 /rl limited：拉一个 node 进程不需要管理员权限，别去要提权。
    * /f 覆盖同名任务，方便重跑。

    引号陷阱（两种方式都有份）：命令行是  cmd /c "<绝对路径>\scripts\start-shim.cmd"，
    内层引号必须转义，否则会被截断成  cmd /c  而丢掉整个路径 —— 典型的
    Windows 命令行解析坑。schtasks 方式用 ProcessStartInfo.Arguments 直接控制
    整条命令行来绕开 PS 5.1 的原生命令参数绑定；Registry 方式存的是纯字符串，
    由 Run 键处理器直接 CreateProcess，故用  cmd /c ""<path>""  的双引号包裹形式
    对含空格与不含空格的路径都成立。

    默认是 dry-run：只打印将要执行的命令，必须显式加 -Execute 才真正写入。

.PARAMETER Execute
    真正执行注册/卸载。不加此开关只打印命令。

.PARAMETER Remove
    删除自启项，而不是创建。

.PARAMETER TaskName
    名称，默认 DeepSeekBrainShim。

.PARAMETER Method
    Registry（默认，写 HKCU Run 键，无需管理员）或 ScheduledTask
    （schtasks，需管理员）。

.EXAMPLE
    .\scripts\install-autostart.ps1
    dry-run，只打印命令（默认 Registry 方式）。

.EXAMPLE
    .\scripts\install-autostart.ps1 -Execute
    注册登录自启（写 HKCU Run 键，无需管理员）。

.EXAMPLE
    .\scripts\install-autostart.ps1 -Method ScheduledTask -Execute
    用计划任务注册（需管理员 PowerShell）。

.EXAMPLE
    .\scripts\install-autostart.ps1 -Remove -Execute
    卸载（Registry 与 ScheduledTask 两种方式都会被清理）。
#>
[CmdletBinding()]
param(
    [string]$TaskName = 'DeepSeekBrainShim',
    [switch]$Execute,
    [switch]$Remove,
    [ValidateSet('Registry', 'ScheduledTask')]
    [string]$Method = 'Registry'
)

$ErrorActionPreference = 'Stop'

# 项目根从本脚本位置推导，仓库换位置也不用改这里。
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$launcher    = Join-Path $projectRoot 'scripts\start-shim.cmd'

if (-not (Test-Path -LiteralPath $launcher)) {
    throw "找不到启动脚本：$launcher"
}
if ($Remove -and $Execute -eq $false) {
    throw '-Remove 需要同时加 -Execute 才会真的删除。'
}

# ---------------------------------------------------------------- Registry ----
# 走这条分支时直接结束，下面那段 schtasks 代码与它无关。
if ($Method -eq 'Registry') {
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

    # 始终用  cmd /c ""<path>""  的双引号包裹形式：cmd 的 /c 有「首尾引号成对剥掉」
    # 的规则，这个写法对含空格与不含空格的路径都成立，写死无引号会在别人机器上
    # （路径含空格，例如 C:\Users\John Doe\...）整条命令崩掉。
    $regValue = 'cmd.exe /c ""{0}""' -f $launcher

    Write-Host "自启方式：Registry（HKCU Run 键，无需管理员）" -ForegroundColor Cyan
    Write-Host "启动脚本：$launcher" -ForegroundColor Cyan
    Write-Host ''

    if ($Remove) {
        # 顺带把计划任务也清掉：用户可能先跑过 -Method ScheduledTask，
        # 卸载时只清一半会留下一个仍在拉起 shim 的僵尸任务。
        Write-Host '将要执行：' -ForegroundColor Cyan
        Write-Host "  Remove-ItemProperty -Path '$runKey' -Name '$TaskName'" -ForegroundColor White
        Write-Host "  schtasks /delete /tn ""$TaskName"" /f   （若存在）" -ForegroundColor White
        if (-not $Execute) {
            Write-Host '[dry-run] 未执行任何系统改动。加 -Execute 重跑。' -ForegroundColor Yellow
            return
        }
        if ((Get-ItemProperty -Path $runKey -Name $TaskName -ErrorAction SilentlyContinue)) {
            Remove-ItemProperty -Path $runKey -Name $TaskName -ErrorAction Stop
            Write-Host "已删除 HKCU Run 值：$TaskName" -ForegroundColor Green
        } else {
            Write-Host "HKCU Run 中本无 $TaskName，跳过。" -ForegroundColor DarkGray
        }
        # 计划任务删除失败不算致命：它可能根本不存在。只提示，不抛。
        $st = Start-Process -FilePath 'schtasks.exe' -ArgumentList "/delete /tn `"$TaskName`" /f" `
             -NoNewWindow -Wait -PassThru -RedirectStandardOutput "$env:TEMP\dsb-stdel.out" `
             -RedirectStandardError "$env:TEMP\dsb-stdel.err" -ErrorAction SilentlyContinue
        if ($st -and $st.ExitCode -eq 0) {
            Write-Host "已删除计划任务：$TaskName" -ForegroundColor Green
        } else {
            Write-Host "计划任务 $TaskName 不存在或无权删除（忽略）。" -ForegroundColor DarkGray
        }
        return
    }

    Write-Host '将要执行：' -ForegroundColor Cyan
    Write-Host "  Set-ItemProperty -Path '$runKey' -Name '$TaskName' -Value `"$regValue`"" -ForegroundColor White
    Write-Host ''
    if (-not $Execute) {
        Write-Host '[dry-run] 未执行任何系统改动。' -ForegroundColor Yellow
        Write-Host '[dry-run] 确认后加 -Execute 重跑：' -ForegroundColor Yellow
        Write-Host '[dry-run]   .\scripts\install-autostart.ps1 -Execute' -ForegroundColor Yellow
        return
    }
    if (-not (Test-Path -LiteralPath $runKey)) {
        throw "找不到 Run 键：$runKey"
    }
    Set-ItemProperty -Path $runKey -Name $TaskName -Value $regValue -Type String -ErrorAction Stop
    $actual = (Get-ItemProperty -Path $runKey -Name $TaskName -ErrorAction Stop).$TaskName
    if ($actual -ne $regValue) {
        throw "写入校验失败。期望 [$regValue]，实际 [$actual]"
    }
    Write-Host "已写入并校验：$TaskName = $actual" -ForegroundColor Green
    Write-Host '撤销：.\scripts\install-autostart.ps1 -Remove -Execute' -ForegroundColor DarkGray
    return
}

# ----------------------------------------------------------- ScheduledTask ----
if ($Remove) {
    $exeName   = 'schtasks.exe'
    $arguments = '/delete /tn "{0}" /f' -f $TaskName
    $what      = '删除'
} else {
    # 当前用户的交互式登录名（MACHINE\user）。给 /ru 是为了避免 schtasks
    # 弹密码提示；配合 /it 就不需要 /rp。
    $identity = try { [System.Security.Principal.WindowsIdentity]::GetCurrent().Name } catch { $env:USERNAME }

    # 注意路径不能以反斜杠结尾：cmd 会把结尾的 \" 当成转义而不是引号结束符。
    $arguments = '/create /tn "{0}" /tr "cmd /c \"{1}\"" /sc onlogon /ru "{2}" /rl limited /it /f' -f
                    $TaskName, $launcher, $identity
    $exeName   = 'schtasks.exe'
    $what      = '创建/覆盖'
}

Write-Host "计划任务：$what $TaskName" -ForegroundColor Cyan
Write-Host "启动脚本：$launcher" -ForegroundColor Cyan
Write-Host ''
Write-Host '将要执行：' -ForegroundColor Cyan
Write-Host ("  {0} {1}" -f $exeName, $arguments) -ForegroundColor White
Write-Host ''

if (-not $Execute) {
    Write-Host '[dry-run] 未执行任何系统改动。' -ForegroundColor Yellow
    Write-Host '[dry-run] 确认上面那行命令无误后，加 -Execute 重跑：' -ForegroundColor Yellow
    Write-Host "[dry-run]   .\scripts\install-autostart.ps1 -Execute" -ForegroundColor Yellow
    return
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName               = $exeName
$psi.Arguments              = $arguments   # 原样拼出的整条命令行，.NET 不再二次加引号
$psi.UseShellExecute        = $false
$psi.CreateNoWindow         = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError  = $true

$proc        = [System.Diagnostics.Process]::Start($psi)
$stdout      = $proc.StandardOutput.ReadToEnd()
$stderr      = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()

if ($stdout.Trim()) { Write-Host $stdout.Trim() }
if ($stderr.Trim()) { Write-Host $stderr.Trim() -ForegroundColor Red }
Write-Host ("schtasks 退出码：{0}" -f $proc.ExitCode)

if ($proc.ExitCode -ne 0) {
    throw "schtasks 失败，退出码 $($proc.ExitCode)"
}

if (-not $Remove) {
    Write-Host ''
    Write-Host '当前任务定义：' -ForegroundColor Cyan
    & schtasks.exe /query /tn $TaskName /fo LIST /v
    Write-Host ''
    Write-Host "完成。任务名：$TaskName（登录时触发，交互式，普通权限）。" -ForegroundColor Green
    Write-Host '撤销：.\scripts\install-autostart.ps1 -Remove -Execute' -ForegroundColor DarkGray
}