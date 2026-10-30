$antigravityPath = "C:\Users\letru\AppData\Local\Programs\antigravity\Antigravity.exe"

$procs = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue

if (-not $procs) {
    if (Test-Path $antigravityPath) {
        Start-Process -FilePath $antigravityPath
        Write-Output "LAUNCHED"
    } else {
        Write-Output "NOT_FOUND"
    }
} else {
    try {
        $wshell = New-Object -ComObject Wscript.Shell
        $activated = $wshell.AppActivate("Antigravity")
        if ($activated) {
            Write-Output "FOCUSED"
        } else {
            Start-Process -FilePath $antigravityPath
            Write-Output "BROUGHT_TO_FRONT"
        }
    } catch {
        Start-Process -FilePath $antigravityPath
        Write-Output "RELAUNCHED"
    }
}
