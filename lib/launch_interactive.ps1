# launch_interactive.ps1 - Robust Interactive GUI Launcher for Windows
param(
    [string]$Target = "https://www.youtube.com",
    [string]$Browser = "default",
    [string]$Profile = ""
)

$ErrorActionPreference = "SilentlyContinue"

# Import Win32 APIs for window activation
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinTop {
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
}
"@ -ErrorAction SilentlyContinue

function Find-Exe($paths) {
    foreach ($p in $paths) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "D:\Browsers\Chrome\chrome.exe"
)
$edgePaths = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "D:\Browsers\Edge\msedge.exe"
)
$bravePaths = @(
    "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
    "D:\Browsers\Brave\brave.exe"
)
$firefoxPaths = @(
    "C:\Program Files\Mozilla Firefox\firefox.exe",
    "C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
    "D:\Browsers\Firefox\firefox.exe"
)

$isUrl = ($Target -match "^https?://" -or $Target -match "^www\.")

if ($isUrl) {
    $targetUrl = if ($Target.StartsWith("www.")) { "https://" + $Target } else { $Target }
    $bLower = $Browser.ToLower()
    $browserExe = $null

    if ($bLower -eq "chrome") {
        $browserExe = Find-Exe $chromePaths
    } elseif ($bLower -eq "edge" -or $bLower -eq "msedge") {
        $browserExe = Find-Exe $edgePaths
    } elseif ($bLower -eq "brave") {
        $browserExe = Find-Exe $bravePaths
    } elseif ($bLower -eq "firefox") {
        $browserExe = Find-Exe $firefoxPaths
    } else {
        # Ưu tiên Chrome nếu đã cài trên máy, sau đó tới Edge
        $browserExe = Find-Exe $chromePaths
        if (-not $browserExe) { $browserExe = Find-Exe $edgePaths }
    }

    $argList = @()
    if ($Profile) {
        $argList += "--profile-directory=`"$Profile`""
    }
    $argList += "`"$targetUrl`""

    if ($browserExe) {
        Start-Process -FilePath $browserExe -ArgumentList $argList
    } else {
        Start-Process $targetUrl
    }

    # Đợi cửa sổ trình duyệt xuất hiện và đưa lên trước
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Milliseconds 250
        $procs = Get-Process chrome, msedge, brave, firefox -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
        if ($procs) {
            foreach ($p in $procs) {
                [WinTop]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null # SW_RESTORE
                [WinTop]::ShowWindowAsync($p.MainWindowHandle, 3) | Out-Null # SW_MAXIMIZE
                [WinTop]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
                [WinTop]::SwitchToThisWindow($p.MainWindowHandle, $true)
            }
            break
        }
    }
} else {
    # Ứng dụng Desktop thông thường
    $appProc = Start-Process -FilePath $Target -PassThru -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    if ($appProc -and $appProc.MainWindowHandle -ne 0) {
        [WinTop]::ShowWindowAsync($appProc.MainWindowHandle, 9) | Out-Null
        [WinTop]::SetForegroundWindow($appProc.MainWindowHandle) | Out-Null
        [WinTop]::SwitchToThisWindow($appProc.MainWindowHandle, $true)
    }
}

Write-Output "OK"
