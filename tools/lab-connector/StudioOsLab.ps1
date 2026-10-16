#Requires -Version 5.1
param([string]$WorkRoot = (Join-Path $env:LOCALAPPDATA 'Studio OS Lab Pilot'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'StudioOsLab.Core.ps1')
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [Windows.Forms.Application]::EnableVisualStyles()
    Initialize-StudioRoot $WorkRoot
    $mutexName = 'Local\StudioOSLabPilot-' + (Get-StudioHash (Get-StudioUtf8 ([IO.Path]::GetFullPath($WorkRoot)))).Substring(0,24)
    $mutex = [Threading.Mutex]::new($false,$mutexName)
    if (!$mutex.WaitOne(0)) { [Windows.Forms.MessageBox]::Show('The Studio OS lab helper is already open.','Studio OS') | Out-Null; exit 0 }
    $script:busy = $false
    $form = [Windows.Forms.Form]::new()
    $form.Text = 'Studio OS - Lab test helper'; $form.ClientSize = [Drawing.Size]::new(700,530)
    $form.MinimumSize = [Drawing.Size]::new(640,550); $form.StartPosition = 'CenterScreen'
    $form.Font = [Drawing.Font]::new('Segoe UI',10); $form.BackColor = [Drawing.Color]::White
    function New-StudioLabel([string]$Text,[int]$X,[int]$Y,[int]$W,[int]$H) {
        $label = [Windows.Forms.Label]::new(); $label.Text=$Text; $label.SetBounds($X,$Y,$W,$H); $form.Controls.Add($label); return $label
    }
    $heading = New-StudioLabel 'Your lab, connected to Studio OS' 25 20 640 35
    $heading.Font = [Drawing.Font]::new('Segoe UI',18,[Drawing.FontStyle]::Bold)
    $notice = New-StudioLabel 'TEST MODE - files go to a private review folder. Physical printing and payments are disabled.' 25 65 640 50
    $notice.ForeColor = [Drawing.Color]::FromArgb(135,70,0)
    $help = New-StudioLabel '1. Open the lab portal and create a pairing code.  2. Paste it below.  3. Receive a sealed test job.' 25 120 640 45
    $code = [Windows.Forms.TextBox]::new(); $code.SetBounds(25,175,450,32); $code.MaxLength=39; $code.AccessibleName='Portal pairing code'; $form.Controls.Add($code)
    $pair = [Windows.Forms.Button]::new(); $pair.Text='Pair this PC'; $pair.SetBounds(490,172,175,38); $form.Controls.Add($pair)
    $receive = [Windows.Forms.Button]::new(); $receive.Text='Check for a test job'; $receive.SetBounds(25,230,220,42); $form.Controls.Add($receive)
    $open = [Windows.Forms.Button]::new(); $open.Text='Open review folder'; $open.SetBounds(260,230,200,42); $form.Controls.Add($open)
    $auto = [Windows.Forms.CheckBox]::new(); $auto.Text='Check every 30 seconds while open'; $auto.SetBounds(25,290,420,30); $auto.Checked=$false; $form.Controls.Add($auto)
    $status = New-StudioLabel 'Ready to pair. The PC never needs your Studio OS account password.' 25 335 640 70
    $status.ForeColor = [Drawing.Color]::FromArgb(20,70,95)
    $details = New-StudioLabel ('Review folder: '+(Join-Path $WorkRoot 'Review only')) 25 425 640 60
    $details.Font = [Drawing.Font]::new('Segoe UI',9)
    $timer = [Windows.Forms.Timer]::new(); $timer.Interval=30000
    function Invoke-StudioUi([scriptblock]$Action) {
        if ($script:busy) { return }; $script:busy=$true; $pair.Enabled=$false; $receive.Enabled=$false; $status.Text='Working...'; $form.Refresh()
        try { $status.Text=[string](& $Action) }
        catch { $status.Text='Stopped safely. '+$_.Exception.Message }
        finally { $pair.Enabled=$true; $receive.Enabled=$true; $script:busy=$false }
    }
    $pair.Add_Click({ Invoke-StudioUi { $name=Connect-StudioPc $WorkRoot $code.Text; $code.Clear(); return ('Paired as '+$name+'. Click Check for a test job.') } })
    $receive.Add_Click({ Invoke-StudioUi { Receive-StudioNext $WorkRoot } })
    $timer.Add_Tick({ if ($auto.Checked) { Invoke-StudioUi { Receive-StudioNext $WorkRoot } } })
    $auto.Add_CheckedChanged({ if ($auto.Checked) { $timer.Start() } else { $timer.Stop() } })
    $open.Add_Click({ try { $p=Join-Path $WorkRoot 'Review only'; Assert-StudioSafePath $p; Start-Process -FilePath 'explorer.exe' -ArgumentList ('"'+$p+'"') } catch { $status.Text='Could not open the private review folder.' } })
    $form.Add_FormClosed({ $timer.Stop(); $timer.Dispose() })
    $credential = Read-StudioSecret (Join-Path $WorkRoot 'pairing.dpapi')
    if ($credential -and $credential.paired) { $status.Text='This PC is paired. Click Check for a test job. Automatic checking starts off.' }
    try { [Windows.Forms.Application]::Run($form) } finally { $mutex.ReleaseMutex(); $mutex.Dispose(); $form.Dispose() }
} catch {
    Write-Error 'The lab test helper could not start. Use a local Windows 10/11 PC and keep all helper files together.'
    exit 1
}
