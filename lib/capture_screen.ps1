# capture_screen.ps1 - Robust Screen Capture with Interactive Session Fallback
param(
    [string]$OutputPath = "E:\MThu Mobile Code\screenshots\screen.png"
)

$dir = Split-Path $OutputPath -Parent
if ($dir -and (-not (Test-Path $dir))) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$captured = $false

# 1. Thử chụp trực tiếp (nếu tiến trình đang chạy trong session desktop tương tác)
try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $gfx.Dispose()
    $bmp.Dispose()
    if (Test-Path $OutputPath) {
        $len = (Get-Item $OutputPath).Length
        if ($len -gt 15000) { $captured = $true } # Ảnh thật luôn > 15KB, ảnh đen chỉ ~2-5KB
    }
} catch {}

# 2. Nếu thất bại (chạy ngầm bị cô lập session / màn hình đen) -> Dùng Interactive Task Scheduler
if (-not $captured) {
    try {
        $tempPs1 = "E:\code\temp_interactive_cap.ps1"
        $scriptContent = @"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try {
    `$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    `$bmp = New-Object System.Drawing.Bitmap `$bounds.Width, `$bounds.Height
    `$gfx = [System.Drawing.Graphics]::FromImage(`$bmp)
    `$gfx.CopyFromScreen(`$bounds.Location, [System.Drawing.Point]::Empty, `$bounds.Size)
    `$bmp.Save('$OutputPath', [System.Drawing.Imaging.ImageFormat]::Png)
    `$gfx.Dispose()
    `$bmp.Dispose()
} catch {}
"@
        Set-Content -Path $tempPs1 -Value $scriptContent -Encoding UTF8

        $taskName = "QuinCap_" + (Get-Random -Minimum 1000 -Maximum 9999)
        schtasks /create /tn $taskName /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$tempPs1`"" /sc once /st 23:59 /it /f | Out-Null
        schtasks /run /tn $taskName | Out-Null

        # Chờ tối đa 3 giây để ảnh được lưu
        for ($i = 0; $i -lt 15; $i++) {
            Start-Sleep -Milliseconds 200
            if (Test-Path $OutputPath) {
                $len = (Get-Item $OutputPath).Length
                if ($len -gt 15000) {
                    $captured = $true
                    break
                }
            }
        }

        # Dọn dẹp task & script tạm
        schtasks /delete /tn $taskName /f | Out-Null
        Remove-Item $tempPs1 -ErrorAction SilentlyContinue
    } catch {}
}

if ($captured) {
    Write-Output "OK"
} else {
    Write-Output "FAIL"
}
