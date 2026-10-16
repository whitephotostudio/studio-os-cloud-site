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
$global:StudioOsUiSmoke = [pscustomobject]@{ apiCalls=0; rendered=$false; artifact=$artifact }
$replacement = @'
try {
    # Fail closed before any event pump. The real helper UI is unchanged; these
    # test-only transport sentinels prevent accidental cloud traffic.
    function Invoke-StudioHttp { $global:StudioOsUiSmoke.apiCalls++; throw 'GUI smoke forbids every HTTP call.' }
    function Invoke-StudioJson { $global:StudioOsUiSmoke.apiCalls++; throw 'GUI smoke forbids every API call.' }
    $form.Show()
    [Windows.Forms.Application]::DoEvents()
    $form.Refresh()
    [Windows.Forms.Application]::DoEvents()
    if (!$form.Visible -or !$form.IsHandleCreated -or $form.Text -cne 'Studio OS - Lab test helper') { throw 'The real helper window did not become visible with its expected title.' }
    $buttons = @($form.Controls | Where-Object { $_ -is [Windows.Forms.Button] })
    foreach ($caption in @('Pair this PC','Check for a test job','Open review folder')) {
        $match = @($buttons | Where-Object { $_.Text -ceq $caption -and $_.Enabled -and $_.Visible })
        if ($match.Count -ne 1) { throw ('Missing or disabled actual GUI control: '+$caption) }
    }
    if ($buttons.Count -ne 3) { throw 'Unexpected extra helper action button; review its safety before updating the smoke test.' }
    $inputs = @($form.Controls | Where-Object { $_ -is [Windows.Forms.TextBox] -and $_.AccessibleName -ceq 'Portal pairing code' })
    if ($inputs.Count -ne 1 -or $inputs[0].MaxLength -ne 39 -or $inputs[0].Text -cne '') { throw 'The pairing control is missing, prefilled or incorrectly bounded.' }
    $checks = @($form.Controls | Where-Object { $_ -is [Windows.Forms.CheckBox] })
    if ($checks.Count -ne 1 -or $checks[0].Checked -or $timer.Enabled -or $timer.Interval -ne 30000) { throw 'Automatic polling must start OFF with a 30-second interval.' }
    if ($notice.Text -notmatch 'Physical printing and payments are disabled' -or $status.Text -notmatch 'Ready to pair') { throw 'The test-only boundary or unpaired status is not visible.' }
    if ($global:StudioOsUiSmoke.apiCalls -ne 0) { throw 'Opening the helper attempted an API call.' }
    $bitmap = [Drawing.Bitmap]::new($form.Width,$form.Height)
    try {
        $form.DrawToBitmap($bitmap,[Drawing.Rectangle]::new(0,0,$form.Width,$form.Height))
        $bitmap.Save($global:StudioOsUiSmoke.artifact,[Drawing.Imaging.ImageFormat]::Png)
    } finally { $bitmap.Dispose() }
    $global:StudioOsUiSmoke.rendered = $true
} finally { $form.Close(); [Windows.Forms.Application]::DoEvents() }
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
    Write-Output ('PASS real Windows helper GUI: visible form, three buttons, empty pairing field, polling OFF, test-only notice and zero API calls. PNG: '+$artifact)
} finally {
    Remove-Variable -Name StudioOsUiSmoke -Scope Global -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
}
