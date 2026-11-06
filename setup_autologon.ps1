# setup_autologon.ps1 - Cấu hình Tự Động Đăng Nhập Windows (AutoAdminLogon) cho QuinloveRin Code
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Clear-Host
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "   QUINLOVERIN CODE - CẤU HÌNH TỰ ĐỘNG ĐĂNG NHẬP WINDOWS (AUTOLOGON)" -ForegroundColor Yellow
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "💻 Máy tính: $env:COMPUTERNAME" -ForegroundColor Green
Write-Host "👤 Tài khoản Windows: $env:USERNAME" -ForegroundColor Green
Write-Host ""
Write-Host "MỤC ĐÍCH:" -ForegroundColor Yellow
Write-Host "  Khi bro bật máy từ xa bằng Telegram hoặc nút nguồn:"
Write-Host "  Windows sẽ TỰ ĐỘNG đăng nhập ngầm vào Desktop để nạp bot và Antigravity."
Write-Host "  Bro hoàn toàn không cần nhập mật khẩu bằng tay mỗi lần mở máy nữa!"
Write-Host ""
Write-Host "====================================================================" -ForegroundColor DarkGray
Write-Host "  [1] BẬT Tự Động Đăng Nhập (AutoLogon ON)" -ForegroundColor Cyan
Write-Host "  [2] TẮT Tự Động Đăng Nhập (Khôi phục mặc định)" -ForegroundColor Red
Write-Host "  [3] Thoát" -ForegroundColor Gray
Write-Host "====================================================================" -ForegroundColor DarkGray
Write-Host ""

$choice = Read-Host "👉 Bro hãy chọn (1, 2 hoặc 3)"

if ($choice -eq '1') {
    Write-Host ""
    Write-Host "🔑 Vui lòng nhập MẬT KHẨU WINDOWS của tài khoản [$env:USERNAME]:" -ForegroundColor Yellow
    Write-Host "(Mật khẩu sẽ được ẩn đi khi gõ để đảm bảo an toàn)" -ForegroundColor DarkGray
    $secPass = Read-Host -AsSecureString "Mật khẩu"
    $plainPass = [System.Net.NetworkCredential]::new('', $secPass).Password

    if ([string]::IsNullOrWhiteSpace($plainPass)) {
        Write-Host "❌ Mật khẩu không được để trống!" -ForegroundColor Red
        Write-Host "Bấm phím bất kỳ để đóng..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit
    }

    Write-Host ""
    $lockChoice = Read-Host "🔒 Bro có muốn TỰ ĐỘNG KHÓA MÀN HÌNH (Lock) sau khi vào Windows 8s không? (Y/N - Mặc định Y)"
    if ([string]::IsNullOrWhiteSpace($lockChoice) -or $lockChoice.ToUpper() -eq 'Y') {
        $autoLock = $true
    } else {
        $autoLock = $false
    }

    # Cấu hình Registry Winlogon
    $regPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
    Set-ItemProperty -Path $regPath -Name "AutoAdminLogon" -Value "1" -Type String -Force
    Set-ItemProperty -Path $regPath -Name "DefaultUserName" -Value $env:USERNAME -Type String -Force
    Set-ItemProperty -Path $regPath -Name "DefaultDomainName" -Value $env:COMPUTERNAME -Type String -Force
    Set-ItemProperty -Path $regPath -Name "DefaultPassword" -Value $plainPass -Type String -Force

    # Cấu hình tự động khóa màn hình nếu chọn Y trong Startup VBS
    $startupVbs = [System.IO.Path]::Combine([Environment]::GetFolderPath('Startup'), 'QuinloveRin_Bridge_Startup.vbs')
    if ($autoLock) {
        $vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "G:\MThu Mobile Code"
WshShell.Run """E:\code\GM_DevTools\node.exe"" ""G:\MThu Mobile Code\fast_bridge.cjs""", 0, False
WScript.Sleep 8000
WshShell.Run "rundll32.exe user32.dll,LockWorkStation", 0, False
"@
        [System.IO.File]::WriteAllText($startupVbs, $vbsContent, [System.Text.Encoding]::ASCII)
    } else {
        $vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "G:\MThu Mobile Code"
WshShell.Run """E:\code\GM_DevTools\node.exe"" ""G:\MThu Mobile Code\fast_bridge.cjs""", 0, False
"@
        [System.IO.File]::WriteAllText($startupVbs, $vbsContent, [System.Text.Encoding]::ASCII)
    }

    Write-Host ""
    Write-Host "====================================================================" -ForegroundColor Green
    Write-Host "🎉 [CẤU HÌNH THÀNH CÔNG RỰC RỠ!]" -ForegroundColor Green
    Write-Host "====================================================================" -ForegroundColor Green
    Write-Host "✅ Đã bật tính năng AutoAdminLogon cho tài khoản: $env:USERNAME" -ForegroundColor White
    if ($autoLock) {
        Write-Host "🛡️ Chế độ bảo mật: Sau khi vào Windows 8 giây, màn hình sẽ TỰ ĐỘNG KHÓA LẠI." -ForegroundColor Cyan
        Write-Host "   (Người ngoài nhìn vào thấy khóa, nhưng bot bên trong đã chạy sẵn sàng!)" -ForegroundColor Gray
    } else {
        Write-Host "🖥️ Màn hình Desktop sẽ giữ nguyên trạng thái mở." -ForegroundColor Cyan
    }
    Write-Host ""
    Write-Host "👉 Giờ bro có thể thử tắt máy và mở lại từ xa qua Telegram thoải mái!" -ForegroundColor Yellow
} elseif ($choice -eq '2') {
    $regPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
    Set-ItemProperty -Path $regPath -Name "AutoAdminLogon" -Value "0" -Type String -Force
    Remove-ItemProperty -Path $regPath -Name "DefaultPassword" -ErrorAction SilentlyContinue

    # Khôi phục file Startup VBS không khóa
    $startupVbs = [System.IO.Path]::Combine([Environment]::GetFolderPath('Startup'), 'QuinloveRin_Bridge_Startup.vbs')
    $vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "G:\MThu Mobile Code"
WshShell.Run """E:\code\GM_DevTools\node.exe"" ""G:\MThu Mobile Code\fast_bridge.cjs""", 0, False
"@
    [System.IO.File]::WriteAllText($startupVbs, $vbsContent, [System.Text.Encoding]::ASCII)

    Write-Host ""
    Write-Host "✅ Đã TẮT tính năng Tự động đăng nhập! Windows trở về chế độ đòi pass bình thường." -ForegroundColor Green
} else {
    Write-Host "Đã thoát." -ForegroundColor Gray
}

Write-Host ""
Write-Host "Bấm phím bất kỳ để đóng cửa sổ này..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
