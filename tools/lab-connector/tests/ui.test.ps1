# Real WinForms smoke/render on Windows PowerShell 5.1. The distributed source
# is never edited. Only its Core path and single blocking Application.Run call
# are replaced in memory; no cloud, pairing, printer or payment action runs.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$helperRoot = Split-Path $PSScriptRoot -Parent
$guiPath = Join-Path $helperRoot 'StudioOsLab.ps1'
$corePath = Join-Path $helperRoot 'StudioOsLab.Core.ps1'
$source = [IO.File]::ReadAllText($guiPath)
$beforeHash = (Get-FileHash -LiteralPath $guiPath -Algorithm SHA256).Hash
$runCall = '[Windows.Forms.Application]::Run($form)'
$coreCall = ". (Join-Path `$PSScriptRoot 'StudioOsLab.Core.ps1')"
if ([regex]::Matches($source,[regex]::Escape($runCall)).Count -ne 1) { throw 'The trusted GUI must contain exactly one Application.Run($form) call.' }
if ([regex]::Matches($source,[regex]::Escape($coreCall)).Count -ne 1) { throw 'The trusted GUI Core dot-source expression changed; review this smoke harness.' }
$parseTokens = $null; $parseErrors = $null
[Management.Automation.Language.Parser]::ParseInput($source,[ref]$parseTokens,[ref]$parseErrors) | Out-Null
if ($parseErrors.Count -ne 0) { throw 'The shipped GUI has PowerShell syntax errors.' }
$workRoot = Join-Path ([IO.Path]::GetTempPath()) ('StudioOsLabUi-'+[Guid]::NewGuid().ToString())
$artifactRoot = Join-Path (Get-Location).Path 'artifacts\lab-connector'
$artifact = Join-Path $artifactRoot 'windows-helper-ui.png'
[IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
$global:StudioOsUiSmoke = [pscustomobject]@{ apiCalls=0; rendered=$false; artifact=$artifact; mode='waiting' }
$replacement = @'
try {
    function Invoke-StudioHttp { $global:StudioOsUiSmoke.apiCalls++; throw 'GUI smoke forbids every HTTP call.' }
    function Invoke-StudioJson { $global:StudioOsUiSmoke.apiCalls++; throw 'GUI smoke forbids every API call.' }
    # These presentation-only results stand in for independently transport-tested
    # Core functions. They never pair a device, download files or contact a server.
    function Connect-StudioPc { return 'Synthetic lab PC' }
    function Receive-StudioNext {
        switch($global:StudioOsUiSmoke.mode) {
            'waiting' { return 'No new sealed test jobs. Physical printing is disabled.' }
            'received' { return 'PROOF2-SYNTHETIC-UI is staged in Review only. Nothing was printed.' }
            'offline' { throw 'Synthetic offline connection: retry is safe.' }
            default { throw 'Unexpected GUI fixture action.' }
        }
    }
    function Save-StudioUiSmokeImage([string]$Name) {
        $form.Refresh(); [Windows.Forms.Application]::DoEvents()
        $bitmap=[Drawing.Bitmap]::new($form.Width,$form.Height)
        try { $form.DrawToBitmap($bitmap,[Drawing.Rectangle]::new(0,0,$form.Width,$form.Height));$bitmap.Save((Join-Path (Split-Path $global:StudioOsUiSmoke.artifact -Parent) $Name),[Drawing.Imaging.ImageFormat]::Png) }
        finally { $bitmap.Dispose() }
    }
    $form.Show(); [Windows.Forms.Application]::DoEvents();$form.Refresh()
    if(!$form.Visible -or !$form.IsHandleCreated -or $form.Text -cne 'Studio OS - Lab helper'){throw 'The guided helper window did not become visible.'}
    if($stateTitle.Text -cne 'Connect this PC' -or !$pairingPanel.Visible -or !$pair.Enabled -or $receive.Enabled -or $auto.Checked -or $timer.Enabled){throw 'A new PC must show only the connection step, without polling.'}
    if($code.MaxLength -ne 39 -or $code.AccessibleName -cne 'Portal pairing code' -or $code.Text -cne ''){throw 'The initial pairing input must be empty and bounded.'}
    if($notice.Text -notmatch 'Physical printing and payments are disabled'){throw 'The test-only boundary must remain visible.'}
    Save-StudioUiSmokeImage 'windows-helper-setup.png'
    $code.Text='bbbbbbbb-bbbbbbbb-bbbbbbbb-bbbbbbbb';$pair.PerformClick();[Windows.Forms.Application]::DoEvents()
    if($stateTitle.Text -cne 'Connected' -or $pairingPanel.Visible -or !$receive.Enabled -or !$auto.Enabled -or $auto.Checked -or $timer.Enabled){throw 'Confirmed pairing must fold setup and enable the manual next step without polling.'}
    $global:StudioOsUiSmoke.mode='waiting';$receive.PerformClick()
    if($stateTitle.Text -cne 'Waiting for orders' -or $phaseBadge.Text -cne 'CONNECTED'){throw 'A confirmed empty response must show Waiting for orders.'}
    $global:StudioOsUiSmoke.mode='received';$receive.PerformClick()
    if($stateTitle.Text -cne 'Files received' -or $stateMessage.Text -notmatch 'PROOF2-SYNTHETIC-UI' -or !$open.Enabled){throw 'Only a confirmed staged result may show Files received and its next action.'}
    Save-StudioUiSmokeImage 'windows-helper-ui.png'
    $auto.Checked=$true
    if(!$timer.Enabled){throw 'Explicitly enabling polling must start the 30-second timer.'}
    $global:StudioOsUiSmoke.mode='offline';$receive.PerformClick()
    if($stateTitle.Text -cne 'Needs attention' -or $auto.Checked -or $timer.Enabled -or !$receive.Enabled -or $receive.Text -cne 'Try again' -or !$detailsPanel.Visible){throw 'Offline failure must preserve retry access, pause polling and reveal Details.'}
    if($errorDetail.Text -notmatch 'Synthetic offline' -or !$folderPath.ReadOnly -or $folderPath.AccessibleName -cne 'Review folder location'){throw 'Details must retain the real error and readable review-folder location.'}
    Save-StudioUiSmokeImage 'windows-helper-attention.png'
    $global:StudioOsUiSmoke.mode='waiting';$receive.PerformClick()
    if($stateTitle.Text -cne 'Waiting for orders' -or $auto.Checked -or $timer.Enabled){throw 'A successful manual retry must recover without silently restarting polling.'}
    Set-StudioUiState 'saved'
    if($stateTitle.Text -cne 'Ready to check' -or $phaseBadge.Text -ceq 'CONNECTED'){throw 'A saved pairing alone must not claim a live connection.'}
    if($global:StudioOsUiSmoke.apiCalls -ne 0){throw 'Presentation smoke attempted a network call.'}
    $global:StudioOsUiSmoke.rendered=$true
} finally { $form.Close();[Windows.Forms.Application]::DoEvents() }

'@
try {
    $coreLiteral = ". '" + $corePath.Replace("'","''") + "'"
    $inMemory = $source.Replace($coreCall,$coreLiteral).Replace($runCall,$replacement)
    $script = [scriptblock]::Create($inMemory)
    & $script -WorkRoot $workRoot
    if (!$global:StudioOsUiSmoke.rendered -or $global:StudioOsUiSmoke.apiCalls -ne 0) { throw 'The GUI smoke did not finish without API traffic.' }
    if (!(Test-Path -LiteralPath $artifact -PathType Leaf) -or (Get-Item -LiteralPath $artifact).Length -lt 1000) { throw 'The real WinForms render artifact is missing.' }
    if ((Get-FileHash -LiteralPath $guiPath -Algorithm SHA256).Hash -cne $beforeHash) { throw 'The shipped helper source changed during the smoke test.' }
    if (Test-Path -LiteralPath (Join-Path $workRoot 'pairing.dpapi')) { throw 'GUI smoke must not create a pairing credential.' }
    Write-Output ('PASS guided Windows GUI: setup, connected, waiting, independent received state, offline retry, polling paused/off, saved-pairing honesty and zero API calls. PNG: '+$artifact)
} finally {
    Remove-Variable -Name StudioOsUiSmoke -Scope Global -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
}
