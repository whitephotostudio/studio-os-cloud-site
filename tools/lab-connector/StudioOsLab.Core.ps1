# Studio OS Lab Pilot - Windows PowerShell 5.1 / PowerShell 7.
# This helper has no printer, hot-folder, payment or customer-email operation.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Security
$script:StudioOrigin = 'https://studio-os-labs-pilot.vercel.app'

function Get-StudioHash([byte[]]$Bytes) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $h.Dispose() }
}
function Get-StudioUtf8([string]$Text) { return ,([Text.UTF8Encoding]::new($false).GetBytes($Text)) }
function Assert-StudioSafePath([string]$Path) {
    $p = [IO.Path]::GetFullPath($Path)
    while ($p) {
        if ((Test-Path -LiteralPath $p) -and (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Choose a local folder without symbolic links or junctions.' }
        $parent = [IO.Path]::GetDirectoryName($p)
        if ($parent -eq $p) { break }; $p = $parent
    }
}
function Initialize-StudioRoot([string]$Root) {
    Assert-StudioSafePath $Root
    [IO.Directory]::CreateDirectory($Root) | Out-Null
    foreach ($name in @('Review only','Preparing')) {
        $path = Join-Path $Root $name; Assert-StudioSafePath $path
        [IO.Directory]::CreateDirectory($path) | Out-Null
    }
}
function Write-StudioNewFile([string]$Path,[byte[]]$Bytes) {
    Assert-StudioSafePath $Path
    $s = [IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $s.Write($Bytes,0,$Bytes.Length); $s.Flush($true) } finally { $s.Dispose() }
}
function Save-StudioSecret([string]$Path,$Credential) {
    Assert-StudioSafePath $Path
    $bytes = Get-StudioUtf8 ($Credential | ConvertTo-Json -Depth 8 -Compress)
    $protected = [Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $temporary = $Path + '.new'
    if (Test-Path -LiteralPath $temporary) { Assert-StudioSafePath $temporary; [IO.File]::Delete($temporary) }
    Write-StudioNewFile $temporary $protected
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary,$Path,$null) } else { [IO.File]::Move($temporary,$Path) }
}
function Read-StudioSecret([string]$Path) {
    Assert-StudioSafePath $Path
    if (!(Test-Path -LiteralPath $Path)) { return $null }
    if ((Get-Item -LiteralPath $Path).Length -gt 16000) { throw 'The local pairing file is invalid.' }
    $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($Path),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $c = ([Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json)
    if ($c.origin -cne $script:StudioOrigin -or $c.token -cnotmatch '^[a-f0-9]{64}$' -or $c.id -cnotmatch '^[a-f0-9-]{36}$') { throw 'Pair this PC again.' }
    return $c
}
function New-StudioSecret([string]$Code) {
    $random = New-Object byte[] 32; $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    return [pscustomobject]@{origin=$script:StudioOrigin;id=[Guid]::NewGuid().ToString();token=([BitConverter]::ToString($random)).Replace('-','').ToLowerInvariant();pairCode=$Code;paired=$false}
}
function Invoke-StudioHttp([string]$Method,[string]$Query,$Credential,$Body=$null,[int]$Maximum=50000) {
    if ($Query -notmatch '^/api/lab-connector(?:\?[a-zA-Z0-9=&-]+)?$') { throw 'Invalid helper endpoint.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $handler = [Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler); $client.Timeout = [TimeSpan]::FromSeconds(45)
    $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method),$script:StudioOrigin+$Query)
    $message.Headers.Add('User-Agent','StudioOS-LabPilot/1.0')
    if ($null -ne $Credential) { $message.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',($Credential.id+'.'+$Credential.token)) }
    if ($null -ne $Body) { $message.Content = [Net.Http.StringContent]::new(($Body | ConvertTo-Json -Depth 16 -Compress),[Text.Encoding]::UTF8,'application/json') }
    $response = $null; $stream = $null; $buffer = [IO.MemoryStream]::new()
    try {
        $response = $client.SendAsync($message,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        if ([int]$response.StatusCode -ne 200) { throw ('Studio OS returned HTTP '+[int]$response.StatusCode+'. Nothing was printed. Retry or check pairing in the portal.') }
        if ($response.Content.Headers.ContentLength -gt $Maximum) { throw 'The file exceeds the helper limit.' }
        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult(); $chunk = New-Object byte[] 65536
        while (($n = $stream.Read($chunk,0,$chunk.Length)) -gt 0) {
            if ($buffer.Length + $n -gt $Maximum) { throw 'The file exceeds the helper limit.' }
            $buffer.Write($chunk,0,$n)
        }
        return ,$buffer.ToArray()
    } finally { if ($stream) { $stream.Dispose() }; if ($response) { $response.Dispose() }; $buffer.Dispose(); $message.Dispose(); $client.Dispose(); $handler.Dispose() }
}
function Invoke-StudioJson([string]$Method,[string]$Query,$Credential,$Body=$null) {
    $bytes = Invoke-StudioHttp $Method $Query $Credential $Body 50000
    $result = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    if ($result.ok -ne $true) { throw 'Studio OS did not confirm this request.' }; return $result
}
function Connect-StudioPc([string]$Root,[string]$Code) {
    Initialize-StudioRoot $Root
    $codeClean = $Code.Replace('-','').Trim().ToLowerInvariant()
    if ($codeClean -cnotmatch '^[a-f0-9]{32}$') { throw 'Copy the complete pairing code from the portal. It expires after 10 minutes.' }
    $path = Join-Path $Root 'pairing.dpapi'; $c = Read-StudioSecret $path
    if ($null -eq $c -or $c.pairCode -cne $codeClean -or $c.paired) { $c = New-StudioSecret $codeClean; Save-StudioSecret $path $c }
    # Persist the device identity before sending. A lost response retries the same identity.
    $result = Invoke-StudioJson 'POST' '/api/lab-connector' $null @{action='pair';pairCode=$codeClean;deviceId=$c.id;deviceToken=$c.token}
    if ($result.device.id -cne $c.id -or $result.device.printAllowed -ne $false -or $result.device.testOnly -ne $true) { throw 'The pairing response is invalid.' }
    $c.paired = $true; $c.pairCode = ''; Save-StudioSecret $path $c
    return $result.device.name
}
function Assert-StudioManifest($M,[string]$DispatchId) {
    if ($DispatchId -cnotmatch '^[a-f0-9-]{36}$' -or $M.dispatchId -cne $DispatchId -or $M.reference -cnotmatch '^[A-Z0-9-]{6,90}$' -or
        $M.schemaVersion -ne 2 -or $M.testOnly -isnot [bool] -or !$M.testOnly -or $M.printAllowed -isnot [bool] -or $M.printAllowed -or
        $M.payment -cne 'test_no_payment' -or $M.outputProfile -cne 'sRGB' -or $M.densityPpi -ne 300 -or
        $M.quantity -lt 1 -or $M.quantity -gt 10 -or $M.quantity -ne [math]::Truncate($M.quantity) -or
        $M.finishedPrints -ne $M.quantity*3 -or $M.paperSheets -ne $M.quantity*2 -or @($M.sheets).Count -ne 2) { throw 'This is not a valid test-only Studio OS paper manifest.' }
    $i = 0
    foreach ($s in $M.sheets) {
        $size = @('8x10','10x7')[$i]; $width = @(2400,3000)[$i]; $height = @(3000,2100)[$i]
        if ($s.size -cne $size -or $s.filename -cne ($M.reference+'-'+$size+'.jpg') -or $s.widthPixels -ne $width -or $s.heightPixels -ne $height -or
            $s.copies -ne $M.quantity -or $s.printsPerSheet -ne ($i+1) -or $s.byteSize -lt 1 -or $s.byteSize -gt 4000000 -or $s.byteSize -ne [math]::Truncate($s.byteSize) -or $s.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'The paper size, count, name or fingerprint is invalid.' }
        $i++
    }
}
function Assert-StudioJpeg([byte[]]$Bytes,$Sheet) {
    if ($Bytes.Length -ne $Sheet.byteSize -or (Get-StudioHash $Bytes) -cne $Sheet.sha256) { throw 'A paper file failed its fingerprint check. Nothing was published.' }
    Add-Type -AssemblyName System.Drawing
    $stream = [IO.MemoryStream]::new($Bytes); $image = $null
    try {
        $image = [Drawing.Image]::FromStream($stream,$true,$true)
        if ($image.RawFormat.Guid -ne [Drawing.Imaging.ImageFormat]::Jpeg.Guid -or $image.Width -ne $Sheet.widthPixels -or $image.Height -ne $Sheet.heightPixels -or [math]::Abs($image.HorizontalResolution-300) -gt 0.5 -or [math]::Abs($image.VerticalResolution-300) -gt 0.5) { throw 'A paper file has the wrong image geometry or density.' }
    } finally { if ($image) { $image.Dispose() }; $stream.Dispose() }
}
function Read-StudioBoundedFile([string]$Path,[int]$Maximum) {
    Assert-StudioSafePath $Path
    if (!(Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-Item -LiteralPath $Path).Length -gt $Maximum) { throw 'A local reviewed file is missing or too large.' }
    return ,([IO.File]::ReadAllBytes($Path))
}
function Save-StudioDispatch([string]$Root,[string]$DispatchId,[string]$ManifestHash,[byte[]]$ManifestBytes,[scriptblock]$DownloadFile) {
    if ($ManifestBytes.Length -gt 50000 -or $ManifestHash -cnotmatch '^[a-f0-9]{64}$' -or (Get-StudioHash $ManifestBytes) -cne $ManifestHash) { throw 'The manifest fingerprint is invalid.' }
    $m = [Text.Encoding]::UTF8.GetString($ManifestBytes) | ConvertFrom-Json; Assert-StudioManifest $m $DispatchId
    Initialize-StudioRoot $Root
    $final = Join-Path (Join-Path $Root 'Review only') $DispatchId
    $stage = Join-Path (Join-Path $Root 'Preparing') $DispatchId
    Assert-StudioSafePath $final; Assert-StudioSafePath $stage
    $replayed = Test-Path -LiteralPath $final
    if (!$replayed) {
        [IO.Directory]::CreateDirectory($stage) | Out-Null
        foreach ($s in $m.sheets) {
            [byte[]]$bytes = & $DownloadFile $s.size
            Assert-StudioJpeg $bytes $s
            $path = Join-Path $stage $s.filename
            if (Test-Path -LiteralPath $path) { $old=Read-StudioBoundedFile $path 4000000; if ((Get-StudioHash $old) -cne $s.sha256) { throw 'An earlier staging attempt has different bytes. Ask the owner to review it.' } }
            else { Write-StudioNewFile $path $bytes }
        }
        $mp = Join-Path $stage 'manifest.json'
        if (Test-Path -LiteralPath $mp) { if ((Get-StudioHash (Read-StudioBoundedFile $mp 50000)) -cne $ManifestHash) { throw 'An earlier staging manifest differs. Stop and review it.' } }
        else { Write-StudioNewFile $mp $ManifestBytes }
        # Directory.Move publishes the complete folder on this volume, never overwriting another job.
        [IO.Directory]::Move($stage,$final)
    }
    if ((Get-StudioHash (Read-StudioBoundedFile (Join-Path $final 'manifest.json') 50000)) -cne $ManifestHash) { throw 'The existing reviewed manifest changed. It will not be replaced.' }
    foreach ($s in $m.sheets) { Assert-StudioJpeg (Read-StudioBoundedFile (Join-Path $final $s.filename) 4000000) $s }
    $receipt = [ordered]@{state='staged_for_review';manifestSha256=$ManifestHash;files=@($m.sheets | ForEach-Object { [ordered]@{name=$_.filename;sha256=$_.sha256;byteSize=$_.byteSize} })}
    return [pscustomobject]@{folder=$final;reference=$m.reference;receipt=$receipt;replayed=$replayed}
}
function Send-StudioPendingReceipts([string]$Root,$Credential) {
    $review = Join-Path $Root 'Review only'; Assert-StudioSafePath $review
    $folders = @(Get-ChildItem -LiteralPath $review -Directory)
    if ($folders.Count -gt 2000) { throw 'Archive old reviewed jobs before continuing.' }
    foreach ($folder in $folders) {
        if ($folder.Name -cnotmatch '^[a-f0-9-]{36}$') { throw 'An unexpected folder is in the private review area.' }
        Assert-StudioSafePath $folder.FullName
        $ack = Join-Path $folder.FullName 'cloud-receipt.json'
        if (Test-Path -LiteralPath $ack) { continue }
        $bytes = Read-StudioBoundedFile (Join-Path $folder.FullName 'manifest.json') 50000
        $m = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json; Assert-StudioManifest $m $folder.Name
        $saved = Save-StudioDispatch $Root $folder.Name (Get-StudioHash $bytes) $bytes { throw 'Existing files must never download again.' }
        $r = Invoke-StudioJson 'POST' '/api/lab-connector' $Credential @{action='receipt';dispatchId=$folder.Name;receipt=$saved.receipt}
        if ($r.id -cne $folder.Name -or $r.state -cne 'staged_for_review' -or $r.printAllowed -ne $false) { throw 'The cloud did not confirm the test receipt.' }
        Write-StudioNewFile $ack (Get-StudioUtf8 ($r | ConvertTo-Json -Depth 8))
    }
}
function Receive-StudioNext([string]$Root) {
    Initialize-StudioRoot $Root; $c = Read-StudioSecret (Join-Path $Root 'pairing.dpapi')
    if ($null -eq $c -or !$c.paired) { throw 'Pair this PC with your receiving workspace first.' }
    Send-StudioPendingReceipts $Root $c
    $r = Invoke-StudioJson 'GET' '/api/lab-connector?action=next' $c
    if ($r.testOnly -ne $true -or $r.printAllowed -ne $false) { throw 'This helper only accepts test jobs.' }
    if ($null -eq $r.dispatch) { return 'No new sealed test jobs. Physical printing is disabled.' }
    $id = [string]$r.dispatch.id
    if ($id -cnotmatch '^[a-f0-9-]{36}$') { throw 'Invalid dispatch identity.' }
    $manifest = Invoke-StudioHttp 'GET' ('/api/lab-connector?action=file&dispatchId='+$id+'&file=manifest') $c $null 50000
    $download = {param($size) return ,(Invoke-StudioHttp 'GET' ('/api/lab-connector?action=file&dispatchId='+$id+'&file='+$size) $c $null 4000000)}
    $saved = Save-StudioDispatch $Root $id $r.dispatch.manifestSha256 $manifest $download
    Send-StudioPendingReceipts $Root $c
    return ($saved.reference+' is staged in Review only. Nothing was printed.')
}
