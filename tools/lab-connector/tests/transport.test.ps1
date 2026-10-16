# Real Windows HttpClient tests against an isolated Node loopback fixture.
# No cloud account, external request, payment, photo or printer is used.
# Only Windows PowerShell 5.1 runs the single real 45-second body-timeout test.
param([switch]$IncludeTimeout)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'StudioOsLab.Core.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('StudioOsLabHttp-'+[Guid]::NewGuid().ToString())
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$fixture = $null; $script:TransportPassed = 0
function Assert-Transport([bool]$Condition,[string]$Message) { if (!$Condition) { throw ('Transport assertion failed: '+$Message) } }
function Test-Transport([string]$Name,[scriptblock]$Action) { & $Action; $script:TransportPassed++; Write-Output ('PASS '+$Name) }
function Assert-TransportThrows([scriptblock]$Action,[string]$Message,[string]$Expected='') {
    $failure = $null
    try { & $Action | Out-Null } catch { $failure = $_ }
    Assert-Transport ($null -ne $failure) $Message
    if ($Expected) { Assert-Transport ($failure.Exception.Message -match $Expected) ('Expected bounded error '+$Expected+', received '+$failure.Exception.Message) }
}
try {
    $readyPath = Join-Path $testRoot 'ready.json'; $metadataPath = Join-Path $testRoot 'metadata.json'
    $fixturePath = Join-Path $PSScriptRoot 'http-fixture.mjs'
    $arguments = @(('"'+$fixturePath+'"'),'--ready-file',('"'+$readyPath+'"'),'--metadata-file',('"'+$metadataPath+'"'))
    $fixture = Start-Process -FilePath 'node' -ArgumentList $arguments -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $testRoot 'node.stdout.txt') -RedirectStandardError (Join-Path $testRoot 'node.stderr.txt')
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (!(Test-Path -LiteralPath $readyPath)) {
        if ($fixture.HasExited) { throw ('Loopback fixture exited: '+(Get-Content -LiteralPath (Join-Path $testRoot 'node.stderr.txt') -Raw)) }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Loopback fixture did not become ready within 20 seconds.' }
        Start-Sleep -Milliseconds 100
    }
    $ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
    Assert-Transport ($ready.fixtureVersion -eq 1 -and $ready.origin -cmatch '^http://127\.0\.0\.1:[0-9]{1,5}$') 'Only a loopback fixture origin is permitted.'
    # This override exists in this test script only; distributed helper origin is unchanged.
    $script:StudioOrigin = [string]$ready.origin
    $credential = [pscustomobject]@{id=[string]$ready.deviceId;token=[string]$ready.deviceToken}
    Test-Transport 'actual POST pairing serializes the synthetic identity and returns test-only JSON' {
        $r = Invoke-StudioJson 'POST' '/api/lab-connector' $null @{action='pair';pairCode=$ready.pairCode;deviceId=$credential.id;deviceToken=$credential.token}
        Assert-Transport ($r.device.id -ceq $credential.id -and $r.device.testOnly -eq $true -and $r.device.printAllowed -eq $false) 'Pairing response must be the exact synthetic test device.'
    }
    Test-Transport 'actual GET next transmits the exact scoped bearer and parses no-job JSON' {
        $r = Invoke-StudioJson 'GET' '/api/lab-connector?action=next' $credential
        Assert-Transport ($null -eq $r.dispatch -and $r.testOnly -eq $true -and $r.printAllowed -eq $false) 'The authorized local fixture returns no real job.'
    }
    Test-Transport 'bounded binary payload survives HttpClient byte-for-byte' {
        [byte[]]$bytes = Invoke-StudioHttp 'GET' '/api/lab-connector?action=jpeg' $credential $null 64
        Assert-Transport ($bytes.Length -eq $ready.payloadLength -and (Get-StudioHash $bytes) -ceq $ready.payloadSha256) 'The exact 64 bounded payload bytes must be retained.'
    }
    Test-Transport '302 is rejected without following its target' {
        Assert-TransportThrows { Invoke-StudioHttp 'GET' '/api/lab-connector?action=redirect' $credential } 'Redirects must fail closed.' 'HTTP 302'
        $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
        Assert-Transport (!($metadata.counts.PSObject.Properties.Name -contains 'redirect-target')) 'No request may follow the redirect.'
    }
    Test-Transport '401 and an incorrect bearer fail closed' {
        Assert-TransportThrows { Invoke-StudioHttp 'GET' '/api/lab-connector?action=unauthorized' $credential } 'An unauthorized response must fail.' 'HTTP 401'
        $wrong = [pscustomobject]@{id=$credential.id;token=('d'*64)}
        Assert-TransportThrows { Invoke-StudioHttp 'GET' '/api/lab-connector?action=next' $wrong } 'A changed bearer must be rejected.' 'HTTP 401'
    }
    Test-Transport 'declared oversize is rejected before accepting a payload' {
        Assert-TransportThrows { Invoke-StudioHttp 'GET' '/api/lab-connector?action=declared-oversize' $credential $null 64 } 'Content-Length cannot exceed the configured bound.' 'exceeds'
    }
    Test-Transport 'chunked oversize is rejected without Content-Length' {
        Assert-TransportThrows { Invoke-StudioHttp 'GET' '/api/lab-connector?action=chunked-oversize' $credential $null 64 } 'Chunked bytes must be bounded while streaming.' 'exceeds'
    }
    Test-Transport 'invalid and unconfirmed JSON cannot become successful receipts' {
        Assert-TransportThrows { Invoke-StudioJson 'GET' '/api/lab-connector?action=invalid-json' $credential } 'Malformed JSON must fail.'
        Assert-TransportThrows { Invoke-StudioJson 'GET' '/api/lab-connector?action=unconfirmed' $credential } 'A JSON response without ok=true must fail.' 'did not confirm'
    }
    if ($IncludeTimeout) {
        Test-Transport 'headers followed by a stalled body stop at the real 45-second deadline' {
            $watch = [Diagnostics.Stopwatch]::StartNew()
            try { Assert-TransportThrows { Invoke-StudioHttp 'GET' '/api/lab-connector?action=body-timeout' $credential $null 64 } 'A stalled response body cannot hang the helper.' }
            finally { $watch.Stop() }
            Assert-Transport ($watch.Elapsed.TotalSeconds -ge 40 -and $watch.Elapsed.TotalSeconds -le 65) ('The real transfer deadline must remain bounded; elapsed '+$watch.Elapsed.TotalSeconds+' seconds.')
        }
    } else { Write-Output 'SKIP real 45-second body timeout (covered once by Windows PowerShell 5.1).' }
    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    Assert-Transport ($metadata.host -ceq '127.0.0.1' -and $metadata.externalRequests -eq 0 -and $metadata.pairValidated -eq $true) 'All traffic remained synthetic and loopback-only.'
    foreach ($request in $metadata.requests) { Assert-Transport $request.local 'Every accepted socket must be loopback.' }
    Write-Output ('All '+$script:TransportPassed+' real Windows transport checks passed. No cloud, payment or printer was contacted.')
} finally {
    if ($null -ne $fixture) { if (!$fixture.HasExited) { Stop-Process -Id $fixture.Id -Force -ErrorAction SilentlyContinue }; $fixture.WaitForExit(5000) | Out-Null; $fixture.Dispose() }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
