# Standalone local-file checks for Windows PowerShell 5.1 and PowerShell 7.
# These tests use generated images, an isolated temporary directory and DPAPI.
# They never pair a real device, call a server or access a printer.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'StudioOsLab.Core.ps1')
Add-Type -AssemblyName System.Drawing

$script:Passed = 0
function Assert-Test([bool]$Condition,[string]$Message) {
    if (!$Condition) { throw ('Assertion failed: '+$Message) }
}
function Assert-TestThrows([scriptblock]$Action,[string]$Message) {
    $failed = $false
    try { & $Action | Out-Null } catch { $failed = $true }
    Assert-Test $failed $Message
}
function Invoke-Test([string]$Name,[scriptblock]$Action) {
    & $Action
    $script:Passed++
    Write-Output ('PASS '+$Name)
}
function New-TestJpeg([int]$Width,[int]$Height,[Drawing.Color]$Color,[single]$Density=300) {
    $bitmap = [Drawing.Bitmap]::new($Width,$Height)
    $graphics = $null; $stream = [IO.MemoryStream]::new()
    try {
        $bitmap.SetResolution($Density,$Density)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $graphics.Clear($Color)
        $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Jpeg)
        return ,$stream.ToArray()
    } finally {
        if ($graphics) { $graphics.Dispose() }
        $bitmap.Dispose(); $stream.Dispose()
    }
}
function Copy-TestObject($Value) { return ($Value | ConvertTo-Json -Depth 20 -Compress | ConvertFrom-Json) }
function New-TestManifest([string]$DispatchId,[string]$Reference='PROOF2-SYNTHETIC-PACKAGE') {
    return [pscustomobject][ordered]@{
        schemaVersion=2; dispatchId=$DispatchId; jobId=[Guid]::NewGuid().ToString(); reference=$Reference; version=7
        testOnly=$true; printAllowed=$false; payment='test_no_payment'; outputProfile='sRGB'; densityPpi=300
        quantity=2; finishedPrints=6; paperSheets=4
        slots=@(
            [pscustomobject]@{slotId='8x10';filename='SYNTHETIC-first-original.jpg'},
            [pscustomobject]@{slotId='5x7-a';filename='SYNTHETIC-second-original.jpg'},
            [pscustomobject]@{slotId='5x7-b';filename='SYNTHETIC-third-original.jpg'}
        )
        sheets=@(
            [pscustomobject]@{size='8x10';filename=($Reference+'-8x10.jpg');widthPixels=2400;heightPixels=3000;copies=2;printsPerSheet=1;slots=@('8x10');byteSize=$script:Paper8.Length;sha256=(Get-StudioHash $script:Paper8)},
            [pscustomobject]@{size='10x7';filename=($Reference+'-10x7.jpg');widthPixels=3000;heightPixels=2100;copies=2;printsPerSheet=2;slots=@('5x7-a','5x7-b');byteSize=$script:Paper10.Length;sha256=(Get-StudioHash $script:Paper10)}
        )
    }
}
function Get-TestManifestBytes($Manifest) { return ,(Get-StudioUtf8 ($Manifest | ConvertTo-Json -Depth 20 -Compress)) }

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('StudioOsLabTests-'+[Guid]::NewGuid().ToString())
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$junctions = @()
try {
    $script:Paper8 = New-TestJpeg 2400 3000 ([Drawing.Color]::Firebrick)
    $script:Paper10 = New-TestJpeg 3000 2100 ([Drawing.Color]::RoyalBlue)
    $script:NetworkCalls = 0
    function Invoke-StudioHttp { $script:NetworkCalls++; throw 'Network calls are forbidden in this fixture.' }

    Invoke-Test 'generated JPEG fixtures decode at the exact dimensions and 300ppi' {
        $m = New-TestManifest ([Guid]::NewGuid().ToString())
        Assert-StudioJpeg $script:Paper8 $m.sheets[0]
        Assert-StudioJpeg $script:Paper10 $m.sheets[1]
        Assert-Test ((Get-StudioHash $script:Paper8) -cne (Get-StudioHash $script:Paper10)) 'The paper fixtures must have different fingerprints.'
    }

    $root = Join-Path $testRoot 'atomic'
    $dispatchId = [Guid]::NewGuid().ToString()
    $manifest = New-TestManifest $dispatchId
    $bytes = Get-TestManifestBytes $manifest
    $manifestHash = Get-StudioHash $bytes
    $script:DownloadCount = 0
    $script:AtomicFinal = Join-Path (Join-Path $root 'Review only') $dispatchId
    Invoke-Test 'a complete verified folder appears atomically and contains every exact file' {
        $download = {
            param($size)
            Assert-Test (!(Test-Path -LiteralPath $script:AtomicFinal)) 'No partial final folder may be visible during either download.'
            $script:DownloadCount++
            if ($size -ceq '8x10') { return ,$script:Paper8 }
            if ($size -ceq '10x7') { return ,$script:Paper10 }
            throw 'Unexpected paper request.'
        }
        $saved = Save-StudioDispatch $root $dispatchId $manifestHash $bytes $download
        Assert-Test (!$saved.replayed) 'The first publication is not a retry.'
        Assert-Test ($script:DownloadCount -eq 2) 'Each of the two paper files downloads once.'
        Assert-Test (Test-Path -LiteralPath $saved.folder -PathType Container) 'The completed review folder exists.'
        Assert-Test (!(Test-Path -LiteralPath (Join-Path (Join-Path $root 'Preparing') $dispatchId))) 'The preparing folder moved completely.'
        Assert-Test (@(Get-ChildItem -LiteralPath $saved.folder -File).Count -eq 3) 'There are exactly two JPEGs and one manifest.'
        Assert-Test ((Get-StudioHash ([IO.File]::ReadAllBytes((Join-Path $saved.folder 'manifest.json')))) -ceq $manifestHash) 'The original manifest bytes stay exact.'
        foreach ($s in $manifest.sheets) { Assert-StudioJpeg ([IO.File]::ReadAllBytes((Join-Path $saved.folder $s.filename))) $s }
        Assert-Test ($saved.receipt.state -ceq 'staged_for_review') 'Staging is recorded only as review.'
        Assert-Test ($saved.receipt.manifestSha256 -ceq $manifestHash) 'Receipt binds the exact manifest.'
        Assert-Test (@($saved.receipt.files).Count -eq 2) 'Receipt contains two exact paper fingerprints.'
    }

    Invoke-Test 'an identical retry verifies local bytes and never downloads or republishes' {
        $saved = Save-StudioDispatch $root $dispatchId $manifestHash $bytes { throw 'A retry must not download.' }
        Assert-Test $saved.replayed 'Retry is identified.'
        Assert-Test ($script:DownloadCount -eq 2) 'No extra download occurred.'
    }

    Invoke-Test 'a changed manifest cannot replace an existing reviewed dispatch' {
        $changed = Copy-TestObject $manifest
        $changed.version = 8
        $different = Get-TestManifestBytes $changed
        Assert-TestThrows { Save-StudioDispatch $root $dispatchId (Get-StudioHash $different) $different { throw 'Must not download.' } } 'Changing the sealed manifest must fail.'
        Assert-Test ((Get-StudioHash ([IO.File]::ReadAllBytes((Join-Path $script:AtomicFinal 'manifest.json')))) -ceq $manifestHash) 'Existing reviewed bytes are retained.'
    }

    Invoke-Test 'a corrupt right-hand paper never publishes a partial final folder' {
        $badRoot = Join-Path $testRoot 'corrupt-right'
        $id = [Guid]::NewGuid().ToString(); $m = New-TestManifest $id
        $b = Get-TestManifestBytes $m
        $download = { param($size) if ($size -ceq '8x10') { return ,$script:Paper8 }; $damaged = [byte[]]$script:Paper10.Clone(); $damaged[0] = $damaged[0] -bxor 1; return ,$damaged }
        Assert-TestThrows { Save-StudioDispatch $badRoot $id (Get-StudioHash $b) $b $download } 'Corrupt second file must fail before publication.'
        Assert-Test (!(Test-Path -LiteralPath (Join-Path (Join-Path $badRoot 'Review only') $id))) 'No final folder exists after failure.'
        Assert-Test (Test-Path -LiteralPath (Join-Path (Join-Path $badRoot 'Preparing') $id)) 'A failed staging attempt remains isolated for review.'
        $recover = Save-StudioDispatch $badRoot $id (Get-StudioHash $b) $b { param($size) if ($size -ceq '8x10') { return ,$script:Paper8 }; return ,$script:Paper10 }
        Assert-Test (!$recover.replayed) 'An incomplete attempt can finish with the original exact files.'
    }

    Invoke-Test 'local corruption on a later retry is detected without overwriting the changed file' {
        $file = Join-Path $script:AtomicFinal $manifest.sheets[1].filename
        $backup = [IO.File]::ReadAllBytes($file)
        $damaged = [byte[]]$backup.Clone(); $damaged[20] = $damaged[20] -bxor 1
        [IO.File]::WriteAllBytes($file,$damaged)
        try { Assert-TestThrows { Save-StudioDispatch $root $dispatchId $manifestHash $bytes { throw 'Must not download.' } } 'A local fingerprint change must fail.'
            Assert-Test ((Get-StudioHash ([IO.File]::ReadAllBytes($file))) -ceq (Get-StudioHash $damaged)) 'The helper does not overwrite a changed local file.'
        } finally { [IO.File]::WriteAllBytes($file,$backup) }
    }

    Invoke-Test 'wrong JPEG geometry and density are rejected even with matching byte fingerprints' {
        $bad = New-TestJpeg 600 400 ([Drawing.Color]::DarkGreen)
        $s = Copy-TestObject $manifest.sheets[0]; $s.byteSize = $bad.Length; $s.sha256 = Get-StudioHash $bad
        Assert-TestThrows { Assert-StudioJpeg $bad $s } 'Wrong decoded dimensions fail.'
        $badDensity = New-TestJpeg 2400 3000 ([Drawing.Color]::DarkGreen) 72
        $s.byteSize = $badDensity.Length; $s.sha256 = Get-StudioHash $badDensity
        Assert-TestThrows { Assert-StudioJpeg $badDensity $s } 'Wrong decoded print density fails.'
    }

    Invoke-Test 'unsafe file names, counts and real-print permissions fail before touching disk' {
        foreach ($attack in @('path','permission','string-permission','quantity','copies','paper-count','wrong-slot')) {
            $id = [Guid]::NewGuid().ToString(); $m = New-TestManifest $id
            switch ($attack) {
                'path' { $m.sheets[0].filename = '..\outside.jpg' }
                'permission' { $m.printAllowed = $true }
                'string-permission' { $m.printAllowed = 'false' }
                'quantity' { $m.quantity = 1.5 }
                'copies' { $m.sheets[1].copies = 9 }
                'paper-count' { $m.paperSheets = 1 }
                'wrong-slot' { $m.sheets[1].size = '5x7' }
            }
            $b = Get-TestManifestBytes $m
            $attackRoot = Join-Path $testRoot ('unsafe-'+$attack)
            Assert-TestThrows { Save-StudioDispatch $attackRoot $id (Get-StudioHash $b) $b { throw 'Rejected manifests must never download.' } } ('Manifest attack '+$attack+' must fail.')
            Assert-Test (!(Test-Path -LiteralPath $attackRoot)) 'Rejected manifest does not create output folders.'
        }
        Assert-TestThrows { Save-StudioDispatch $root $dispatchId ('f'*64) $bytes { throw 'Must not download.' } } 'An incorrect manifest fingerprint fails.'
    }

    Invoke-Test 'junctions in the selected root or review path are rejected' {
        $target = Join-Path $testRoot 'junction-target'; [IO.Directory]::CreateDirectory($target) | Out-Null
        $link = Join-Path $testRoot 'junction-root'
        New-Item -ItemType Junction -Path $link -Target $target | Out-Null
        $script:JunctionRoot = $link
        Assert-TestThrows { Initialize-StudioRoot $script:JunctionRoot } 'A selected root junction must fail.'
        $normal = Join-Path $testRoot 'junction-review'; Initialize-StudioRoot $normal
        $review = Join-Path $normal 'Review only'; [IO.Directory]::Delete($review)
        New-Item -ItemType Junction -Path $review -Target $target | Out-Null
        $script:JunctionReview = $review
        Assert-TestThrows { Initialize-StudioRoot $normal } 'A nested review junction must fail.'
        Assert-Test (@(Get-ChildItem -LiteralPath $target).Count -eq 0) 'No files were written through a junction.'
    }

    Invoke-Test 'DPAPI credentials round-trip and never persist the bearer token as plaintext' {
        $path = Join-Path $testRoot 'pairing.dpapi'
        $credential = New-StudioSecret ('a'*32)
        Save-StudioSecret $path $credential
        $encrypted = [IO.File]::ReadAllBytes($path)
        Assert-Test (![Text.Encoding]::UTF8.GetString($encrypted).Contains($credential.token)) 'Protected storage contains no plaintext device token.'
        $loaded = Read-StudioSecret $path
        Assert-Test ($loaded.id -ceq $credential.id -and $loaded.token -ceq $credential.token) 'DPAPI retrieves the same scoped device identity.'
        $credential.paired = $true; $credential.pairCode = ''; Save-StudioSecret $path $credential
        Assert-Test ((Read-StudioSecret $path).paired) 'Atomic credential replacement retains paired state.'
        $credential.origin = 'https://invalid.example.test'; Save-StudioSecret $path $credential
        Assert-TestThrows { Read-StudioSecret $path } 'A credential for another origin is rejected.'
    }

    Assert-Test ($script:NetworkCalls -eq 0) 'No test used the cloud or any external network.'
    Write-Output ('All '+$script:Passed+' Windows connector checks passed. No network, payment or printer operation ran.')
} finally {
    foreach ($variable in @('JunctionReview','JunctionRoot')) {
        $value = Get-Variable -Name $variable -Scope Script -ErrorAction SilentlyContinue
        if ($null -ne $value -and $value.Value -and (Test-Path -LiteralPath $value.Value)) { [IO.Directory]::Delete([string]$value.Value) }
    }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
