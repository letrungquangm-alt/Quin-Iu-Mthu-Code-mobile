$proc = Get-CimInstance Win32_Process -Filter "Name = 'language_server.exe'" | Select-Object -First 1
if ($proc) {
    $token = ""
    if ($proc.CommandLine -match '--csrf_token\s+([a-f0-9\-]+)') {
        $token = $matches[1]
    }
    $conns = Get-NetTCPConnection -OwningProcess $proc.ProcessId -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' }
    $port = 53473
    if ($conns) {
        $port = ($conns | Select-Object -ExpandProperty LocalPort | Select-Object -First 1)
    }
    @{
        pid = $proc.ProcessId
        token = $token
        port = $port
        address = "127.0.0.1:$port"
    } | ConvertTo-Json -Compress
}
