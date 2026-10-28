param(
    [string]$Title = "📱 Telegram -> PC Sync",
    [string]$Message = "Đồng bộ tin nhắn mới",
    [int]$DurationSec = 4
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

try {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = $Title
    $form.Size = New-Object System.Drawing.Size(440, 150)
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    
    # Bottom right of primary screen
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $form.Location = New-Object System.Drawing.Point(($screen.Right - 460), ($screen.Bottom - 170))
    $form.TopMost = $true
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.BackColor = [System.Drawing.Color]::FromArgb(26, 27, 38)
    $form.Opacity = 0.96
    $form.ShowInTaskbar = $false

    # Border effect
    $pnl = New-Object System.Windows.Forms.Panel
    $pnl.Dock = [System.Windows.Forms.DockStyle]::Fill
    $pnl.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $form.Controls.Add($pnl)

    $lblTitle = New-Object System.Windows.Forms.Label
    $lblTitle.Text = $Title
    $lblTitle.ForeColor = [System.Drawing.Color]::FromArgb(64, 196, 255)
    $lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 10.5, [System.Drawing.FontStyle]::Bold)
    $lblTitle.Location = New-Object System.Drawing.Point(16, 12)
    $lblTitle.AutoSize = $true
    $pnl.Controls.Add($lblTitle)

    $lblMsg = New-Object System.Windows.Forms.Label
    $lblMsg.Text = $Message
    $lblMsg.ForeColor = [System.Drawing.Color]::FromArgb(235, 235, 240)
    $lblMsg.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Regular)
    $lblMsg.Location = New-Object System.Drawing.Point(16, 42)
    $lblMsg.Size = New-Object System.Drawing.Size(400, 95)
    $pnl.Controls.Add($lblMsg)

    # Timer close
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = ($DurationSec * 1000)
    $timer.Add_Tick({
        $timer.Stop()
        $form.Close()
    })
    $timer.Start()

    try { [System.Media.SystemSounds]::Asterisk.Play() } catch {}
    $form.ShowDialog() | Out-Null
} catch {}

