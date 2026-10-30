# open_antigravity.ps1 - Intelligent Antigravity Window Launcher & Restorer
param(
    [string]$WorkspaceDir = "E:\MThu Mobile Code"
)

# 1. Tìm đường dẫn Antigravity.exe linh hoạt trên mọi máy tính
$antigravityExe = $null

# Cách 1: Lấy trực tiếp từ tiến trình đang chạy
$running = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1
if ($running -and (Test-Path $running.Path)) {
    $antigravityExe = $running.Path
}

# Cách 2: Tìm trong AppData của user hiện tại
if (-not $antigravityExe) {
    $localPath = "$env:LOCALAPPDATA\Programs\antigravity\Antigravity.exe"
    if (Test-Path $localPath) {
        $antigravityExe = $localPath
    }
}

# Cách 3: Tìm trong Program Files
if (-not $antigravityExe) {
    $pf = "$env:ProgramFiles\Antigravity\Antigravity.exe"
    if (Test-Path $pf) { $antigravityExe = $pf }
}
if (-not $antigravityExe) {
    $pf86 = "${env:ProgramFiles(x86)}\Antigravity\Antigravity.exe"
    if (Test-Path $pf86) { $antigravityExe = $pf86 }
}

# Cách 4: Tìm trong Start Menu Shortcuts
if (-not $antigravityExe) {
    $startMenuLnk = Get-ChildItem -Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter "*Antigravity*.lnk" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($startMenuLnk) {
        try {
            $ws = New-Object -ComObject WScript.Shell
            $sc = $ws.CreateShortcut($startMenuLnk.FullName)
            if ($sc.TargetPath -and (Test-Path $sc.TargetPath)) {
                $antigravityExe = $sc.TargetPath
            }
        } catch {}
    }
}

# Nếu không tìm thấy Antigravity trên máy tính
if (-not $antigravityExe) {
    Write-Output "NOT_FOUND"
    exit 0
}

# 2. Kiểm tra tiến trình
$procs = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue

# Import Win32 API để khôi phục (restore) cửa sổ bị thu nhỏ và đưa lên đầu
$win32Code = @"
using System;
using System.Runtime.InteropServices;

public class WinFocus {
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
}
"@

try {
    Add-Type -TypeDefinition $win32Code -ErrorAction SilentlyContinue
} catch {}

if (-not $procs) {
    # Chưa chạy -> Khởi động mới kèm workspace
    if (Test-Path $WorkspaceDir) {
        Start-Process -FilePath $antigravityExe -ArgumentList "`"$WorkspaceDir`""
    } else {
        Start-Process -FilePath $antigravityExe
    }
    Write-Output "LAUNCHED"
} else {
    # Đang chạy -> Restore và đưa cửa sổ lên màn hình
    $brought = $false

    # Thử khôi phục qua MainWindowHandle của các tiến trình Antigravity
    foreach ($p in $procs) {
        if ($p.MainWindowHandle -and $p.MainWindowHandle -ne [IntPtr]::Zero) {
            try {
                [WinFocus]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null # SW_RESTORE = 9
                [WinFocus]::ShowWindowAsync($p.MainWindowHandle, 5) | Out-Null # SW_SHOW = 5
                [WinFocus]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
                [WinFocus]::SwitchToThisWindow($p.MainWindowHandle, $true)
                $brought = $true
            } catch {}
        }
    }

    # Thử qua AppActivate của WScript.Shell
    try {
        $wshell = New-Object -ComObject Wscript.Shell
        $activated = $wshell.AppActivate("Antigravity")
        if ($activated) { $brought = $true }
    } catch {}

    # Gửi lệnh mở workspace tới instance Electron để Electron tự kích hoạt giao diện
    try {
        if (Test-Path $WorkspaceDir) {
            Start-Process -FilePath $antigravityExe -ArgumentList "`"$WorkspaceDir`""
        } else {
            Start-Process -FilePath $antigravityExe
        }
    } catch {}

    if ($brought) {
        Write-Output "FOCUSED"
    } else {
        Write-Output "BROUGHT_TO_FRONT"
    }
}
