# capture_screen.ps1 - Fast High-Resolution Screen Capture
param(
    [string]$OutputPath = "E:\MThu Mobile Code\screenshots\screen.png"
)

$dir = Split-Path $OutputPath -Parent
if ($dir -and (-not (Test-Path $dir))) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$captured = $false

# Cách 1: Windows Forms & System.Drawing
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
        if ($len -gt 1000) { $captured = $true }
    }
} catch {}

# Cách 2: Win32 GDI BitBlt trực tiếp từ Desktop Device Context
if (-not $captured) {
    try {
        $win32Code = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class WinScreenCap {
    [DllImport("user32.dll")]
    public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr hObject, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hObjectSource, int nXSrc, int nYSrc, int dwRop);
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    public static bool Capture(string filePath) {
        try {
            int w = GetSystemMetrics(0);
            int h = GetSystemMetrics(1);
            IntPtr hDesk = GetDesktopWindow();
            IntPtr hDcDesk = GetDC(hDesk);
            Bitmap bmp = new Bitmap(w, h);
            Graphics g = Graphics.FromImage(bmp);
            IntPtr hDcBmp = g.GetHdc();
            BitBlt(hDcBmp, 0, 0, w, h, hDcDesk, 0, 0, 0x00CC0020);
            g.ReleaseHdc(hDcBmp);
            ReleaseDC(hDesk, hDcDesk);
            g.Dispose();
            bmp.Save(filePath, ImageFormat.Png);
            bmp.Dispose();
            return true;
        } catch {
            return false;
        }
    }
}
"@
        Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $win32Code -ErrorAction SilentlyContinue
        $res = [WinScreenCap]::Capture($OutputPath)
        if ($res -and (Test-Path $OutputPath)) {
            $captured = $true
        }
    } catch {}
}

if ($captured) {
    Write-Output "OK"
} else {
    Write-Output "FAIL"
}
