param(
    [string]$ProcessNames = "",
    [string]$WindowTitle = ""
)

$closedCount = 0
$closedItems = @()

if ($ProcessNames) {
    $names = $ProcessNames.Split(',')
    foreach ($pName in $names) {
        $p = $pName.Trim()
        if ($p) {
            $found = Get-Process -Name $p -ErrorAction SilentlyContinue
            if ($found) {
                $closedCount += $found.Count
                $closedItems += "$p ($($found.Count))"
                $found | Stop-Process -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

if ($WindowTitle) {
    $w = $WindowTitle.Trim()
    $byTitle = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.MainWindowTitle -and ($_.MainWindowTitle.ToLower().Contains($w.ToLower()))
    }
    if ($byTitle) {
        foreach ($item in $byTitle) {
            $closedCount++
            $closedItems += "$($item.ProcessName) ('$($item.MainWindowTitle)')"
            $item.CloseMainWindow() | Out-Null
            Start-Sleep -Milliseconds 150
            if (-not $item.HasExited) {
                $item | Stop-Process -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

$res = [PSCustomObject]@{
    ok = ($closedCount -gt 0)
    count = $closedCount
    details = ($closedItems -join ', ')
}
$res | ConvertTo-Json -Compress
