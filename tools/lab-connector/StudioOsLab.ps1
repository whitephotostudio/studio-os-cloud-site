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
    $script:studioUiBusy = $false; $script:studioUiPaired = $false; $script:studioUiDetailsOpen = $false
    $script:studioUiPhase = 'setup'; $script:studioUiError = ''; $script:studioUiLastReceived = ''
    $ink = [Drawing.Color]::FromArgb(27,43,57); $muted = [Drawing.Color]::FromArgb(83,101,115)
    $blue = [Drawing.Color]::FromArgb(28,91,124); $soft = [Drawing.Color]::FromArgb(239,245,248)
    $form = [Windows.Forms.Form]::new()
    $form.Text = 'Studio OS - Lab helper'; $form.ClientSize = [Drawing.Size]::new(720,660)
    $form.MinimumSize = [Drawing.Size]::new(736,630); $form.StartPosition = 'CenterScreen'
    $form.Font = [Drawing.Font]::new('Segoe UI',10); $form.BackColor = [Drawing.Color]::White; $form.ForeColor = $ink
    $layout = [Windows.Forms.TableLayoutPanel]::new(); $layout.Dock='Fill'; $layout.Padding=[Windows.Forms.Padding]::new(28)
    $layout.ColumnCount=1; $layout.RowCount=9; $layout.AutoScroll=$true
    foreach ($index in 0..8) { $layout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::AutoSize)) | Out-Null }
    $form.Controls.Add($layout)
    function New-StudioText([string]$Text,[single]$Size=10,[bool]$Bold=$false) {
        $label=[Windows.Forms.Label]::new(); $label.Text=$Text; $label.AutoSize=$true; $label.Dock='Fill'; $label.Margin=[Windows.Forms.Padding]::new(0,0,0,12)
        $style=if($Bold){[Drawing.FontStyle]::Bold}else{[Drawing.FontStyle]::Regular}
        $label.Font=[Drawing.Font]::new('Segoe UI',$Size,$style); return $label
    }
    $brand=New-StudioText 'STUDIO OS LAB' 10 $true; $brand.ForeColor=$muted; $layout.Controls.Add($brand,0,0)
    $statePanel=[Windows.Forms.TableLayoutPanel]::new(); $statePanel.Dock='Top'; $statePanel.AutoSize=$true; $statePanel.ColumnCount=1; $statePanel.RowCount=3
    $statePanel.Margin=[Windows.Forms.Padding]::new(0,0,0,14)
    $phaseBadge=New-StudioText 'SETUP' 9 $true; $phaseBadge.ForeColor=$blue
    $stateTitle=New-StudioText 'Connect this PC' 23 $true; $stateTitle.AccessibleName='Current helper state'
    $stateMessage=New-StudioText 'Copy a pairing code from your lab portal, then paste it below.'; $stateMessage.ForeColor=$muted
    $statePanel.Controls.Add($phaseBadge,0,0); $statePanel.Controls.Add($stateTitle,0,1); $statePanel.Controls.Add($stateMessage,0,2); $layout.Controls.Add($statePanel,0,1)
    $notice=New-StudioText "Test mode: files for review only.`r`nPhysical printing and payments are disabled." 10 $false
    $notice.BackColor=[Drawing.Color]::FromArgb(255,247,228); $notice.ForeColor=[Drawing.Color]::FromArgb(117,77,18)
    $notice.Padding=[Windows.Forms.Padding]::new(12); $notice.Margin=[Windows.Forms.Padding]::new(0,0,0,20); $layout.Controls.Add($notice,0,2)
    $pairingPanel=[Windows.Forms.GroupBox]::new(); $pairingPanel.Text='First time on this PC'; $pairingPanel.AutoSize=$true; $pairingPanel.Dock='Top'
    $pairingPanel.Padding=[Windows.Forms.Padding]::new(14,22,14,14); $pairingPanel.Margin=[Windows.Forms.Padding]::new(0,0,0,20)
    $pairLayout=[Windows.Forms.TableLayoutPanel]::new(); $pairLayout.Dock='Top'; $pairLayout.AutoSize=$true; $pairLayout.ColumnCount=2; $pairLayout.RowCount=2
    $pairLayout.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new([Windows.Forms.SizeType]::Percent,100)) | Out-Null
    $pairLayout.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new([Windows.Forms.SizeType]::Absolute,126)) | Out-Null
    $pairHelp=New-StudioText 'Use the complete code within 10 minutes. You do this once.' 9; $pairHelp.ForeColor=$muted
    $pairLayout.Controls.Add($pairHelp,0,0); $pairLayout.SetColumnSpan($pairHelp,2)
    $code=[Windows.Forms.TextBox]::new(); $code.Dock='Fill'; $code.MaxLength=39; $code.AccessibleName='Portal pairing code'; $code.Margin=[Windows.Forms.Padding]::new(0,6,12,0)
    $code.Font=[Drawing.Font]::new('Segoe UI',12); $pairLayout.Controls.Add($code,0,1)
    function Set-StudioButtonStyle($Button,[bool]$Primary) {
        $Button.FlatStyle='Flat'; $Button.FlatAppearance.BorderSize=0
        $Button.BackColor=if($Primary){$blue}else{$soft}; $Button.ForeColor=if($Primary){[Drawing.Color]::White}else{$ink}
    }
    $pair=[Windows.Forms.Button]::new(); $pair.Text='Connect'; $pair.AccessibleName='Connect this PC'; $pair.Dock='Fill'; $pair.Height=38
    $pair.Margin=[Windows.Forms.Padding]::new(0); Set-StudioButtonStyle $pair $true; $pairLayout.Controls.Add($pair,1,1)
    $pairingPanel.Controls.Add($pairLayout); $layout.Controls.Add($pairingPanel,0,3)
    $actions=[Windows.Forms.FlowLayoutPanel]::new(); $actions.AutoSize=$true; $actions.Dock='Top'; $actions.WrapContents=$true; $actions.Margin=[Windows.Forms.Padding]::new(0,0,0,12)
    $receive=[Windows.Forms.Button]::new(); $receive.Text='Check for orders'; $receive.AccessibleName='Check for orders'; $receive.Size=[Drawing.Size]::new(184,43); $receive.Margin=[Windows.Forms.Padding]::new(0,0,12,0)
    $open=[Windows.Forms.Button]::new(); $open.Text='Open files'; $open.AccessibleName='Open received files'; $open.Size=[Drawing.Size]::new(150,43); $open.Margin=[Windows.Forms.Padding]::new(0)
    Set-StudioButtonStyle $receive $true; Set-StudioButtonStyle $open $false
    $actions.Controls.Add($receive); $actions.Controls.Add($open); $layout.Controls.Add($actions,0,4)
    $auto=[Windows.Forms.CheckBox]::new(); $auto.Text='Check automatically every 30 seconds'; $auto.AccessibleName='Automatic order checking'; $auto.AutoSize=$true
    $auto.Checked=$false; $auto.Margin=[Windows.Forms.Padding]::new(0,0,0,20); $layout.Controls.Add($auto,0,5)
    $detailsLink=[Windows.Forms.LinkLabel]::new(); $detailsLink.Text='Details'; $detailsLink.AutoSize=$true; $detailsLink.LinkColor=$blue
    $detailsLink.AccessibleName='Show connection details and folder'; $detailsLink.Margin=[Windows.Forms.Padding]::new(0,0,0,8); $layout.Controls.Add($detailsLink,0,6)
    $detailsPanel=[Windows.Forms.TableLayoutPanel]::new(); $detailsPanel.AutoSize=$true; $detailsPanel.Dock='Top'; $detailsPanel.ColumnCount=1; $detailsPanel.RowCount=3
    $folderLabel=New-StudioText 'Review folder' 9 $true; $folderLabel.ForeColor=$muted; $folderLabel.Margin=[Windows.Forms.Padding]::new(0,0,0,4)
    $folderPath=[Windows.Forms.TextBox]::new(); $folderPath.Text=Join-Path $WorkRoot 'Review only'; $folderPath.ReadOnly=$true; $folderPath.Multiline=$true; $folderPath.WordWrap=$true
    $folderPath.Height=48; $folderPath.Dock='Top'; $folderPath.BorderStyle='FixedSingle'; $folderPath.AccessibleName='Review folder location'; $folderPath.BackColor=[Drawing.Color]::White
    $errorDetail=New-StudioText '' 9; $errorDetail.ForeColor=[Drawing.Color]::FromArgb(132,74,18); $errorDetail.Margin=[Windows.Forms.Padding]::new(0,8,0,4)
    $detailsPanel.Controls.Add($folderLabel,0,0); $detailsPanel.Controls.Add($folderPath,0,1); $detailsPanel.Controls.Add($errorDetail,0,2)
    $detailsPanel.Visible=$false; $layout.Controls.Add($detailsPanel,0,7)
    $timer=[Windows.Forms.Timer]::new(); $timer.Interval=30000
    function Update-StudioUiLayout {
        $width=[math]::Max(300,$form.ClientSize.Width-72)
        $stateMessage.MaximumSize=[Drawing.Size]::new($width,0); $notice.MaximumSize=[Drawing.Size]::new($width,0); $errorDetail.MaximumSize=[Drawing.Size]::new($width,0)
    }
    function Update-StudioUiControls {
        $pairingPanel.Visible=!$script:studioUiPaired
        $actions.Visible=$script:studioUiPaired; $auto.Visible=$script:studioUiPaired
        $pair.Enabled=!$script:studioUiBusy -and !$script:studioUiPaired
        $receive.Enabled=!$script:studioUiBusy -and $script:studioUiPaired
        $auto.Enabled=!$script:studioUiBusy -and $script:studioUiPaired
        $open.Enabled=!$script:studioUiBusy
        $form.AcceptButton=if($script:studioUiPaired){$receive}else{$pair}
        $detailsPanel.Visible=$script:studioUiDetailsOpen
        $detailsLink.Text=if($script:studioUiDetailsOpen){'Hide details'}else{'Details'}
        Set-StudioButtonStyle $receive ($script:studioUiPhase -ne 'received')
        Set-StudioButtonStyle $open ($script:studioUiPhase -eq 'received')
    }
    function Set-StudioUiState([string]$Phase,[string]$Message='',[string]$Detail='') {
        $script:studioUiPhase=$Phase; $script:studioUiError=$Detail; $errorDetail.Text=$Detail; $errorDetail.Visible=[bool]$Detail
        $receive.Text='Check for orders'
        switch ($Phase) {
            'setup' { $phaseBadge.Text='SETUP'; $stateTitle.Text='Connect this PC'; $stateMessage.Text='Copy a pairing code from your lab portal, then paste it below.' }
            'saved' { $phaseBadge.Text='SAVED PAIRING'; $stateTitle.Text='Ready to check'; $stateMessage.Text='This PC has a saved pairing. Check for orders to confirm the connection.' }
            'connected' { $phaseBadge.Text='CONNECTED'; $stateTitle.Text='Connected'; $stateMessage.Text=$Message }
            'waiting' { $phaseBadge.Text='CONNECTED'; $stateTitle.Text='Waiting for orders'; $stateMessage.Text=if($script:studioUiLastReceived){'No new orders. Last received: '+$script:studioUiLastReceived+'. Open files to inspect them.'}else{'No new orders are ready. Check again or turn on automatic checking.'} }
            'received' { $phaseBadge.Text='RECEIVED'; $stateTitle.Text='Files received'; $stateMessage.Text=$Message }
            'attention' { $phaseBadge.Text='ACTION NEEDED'; $stateTitle.Text='Needs attention'; $stateMessage.Text=$Message; $receive.Text='Try again' }
            default { throw 'Unknown helper display state.' }
        }
        $phaseBadge.ForeColor=if($Phase -eq 'attention'){[Drawing.Color]::FromArgb(147,88,14)}elseif($Phase -in @('connected','waiting','received')){[Drawing.Color]::FromArgb(29,111,83)}else{$blue}
        Update-StudioUiControls
    }
    function Invoke-StudioUi([string]$WorkingText,[scriptblock]$Action) {
        if ($script:studioUiBusy) { return }; $script:studioUiBusy=$true; Update-StudioUiControls
        $stateTitle.Text=$WorkingText; $stateMessage.Text='This may take a moment.'; $form.UseWaitCursor=$true; $form.Refresh()
        try { & $Action | Out-Null }
        catch {
            $wasAutomatic=$auto.Checked; $auto.Checked=$false; $timer.Stop(); $script:studioUiDetailsOpen=$true
            $message=if($script:studioUiPaired){'We could not finish. Your files and pending requests are kept. Check the details, then try again.'}else{'This PC is not connected yet. Check the code and connection details, then try again.'}
            if($wasAutomatic){$message+=' Automatic checking is paused.'}
            Set-StudioUiState 'attention' $message $_.Exception.Message
        }
        finally { $form.UseWaitCursor=$false; $script:studioUiBusy=$false; Update-StudioUiControls }
    }
    function Invoke-StudioPair {
        Invoke-StudioUi 'Connecting...' {
            $name=Connect-StudioPc $WorkRoot $code.Text
            $script:studioUiPaired=$true; $code.Clear(); $script:studioUiDetailsOpen=$false
            Set-StudioUiState 'connected' ('Connected as '+$name+'. Check for an order to begin.')
        }
    }
    function Invoke-StudioReceive {
        if(!$script:studioUiPaired){return}
        Invoke-StudioUi 'Checking for orders...' {
            $result=[string](Receive-StudioNext $WorkRoot)
            if($result -ceq 'No new sealed test jobs. Physical printing is disabled.') { Set-StudioUiState 'waiting' }
            elseif($result -cmatch '^(?<reference>[A-Z0-9-]{6,90}) is staged in Review only\. Nothing was printed\.$') {
                $script:studioUiLastReceived=$Matches.reference
                Set-StudioUiState 'received' ($Matches.reference+' is ready for review. Open the files to inspect them. Nothing was printed.')
            } else { throw 'The helper did not return a confirmed order result. Keep the existing files and try again.' }
        }
    }
    $pair.Add_Click({ Invoke-StudioPair }); $receive.Add_Click({ Invoke-StudioReceive })
    $timer.Add_Tick({ if($auto.Checked){Invoke-StudioReceive} })
    $auto.Add_CheckedChanged({ if($auto.Checked -and $script:studioUiPaired){$timer.Start()}else{$timer.Stop()} })
    $detailsLink.Add_LinkClicked({ $script:studioUiDetailsOpen=!$script:studioUiDetailsOpen; Update-StudioUiControls })
    $open.Add_Click({ try { $path=Join-Path $WorkRoot 'Review only'; Assert-StudioSafePath $path; Start-Process -FilePath 'explorer.exe' -ArgumentList ('"'+$path+'"') } catch { $auto.Checked=$false; $timer.Stop(); $script:studioUiDetailsOpen=$true; Set-StudioUiState 'attention' 'The review folder could not be opened. Check Details and try again.' $_.Exception.Message } })
    $form.Add_SizeChanged({ Update-StudioUiLayout }); $form.Add_FormClosed({$timer.Stop();$timer.Dispose()})
    Update-StudioUiLayout; Set-StudioUiState 'setup'
    try {
        $credential=Read-StudioSecret (Join-Path $WorkRoot 'pairing.dpapi')
        if($credential -and $credential.paired){$script:studioUiPaired=$true;Set-StudioUiState 'saved'}
    } catch { $script:studioUiDetailsOpen=$true;Set-StudioUiState 'attention' 'The saved connection could not be opened. Ask your operator to review Details before replacing it.' $_.Exception.Message }
    try { [Windows.Forms.Application]::Run($form) } finally { $mutex.ReleaseMutex(); $mutex.Dispose(); $form.Dispose() }
} catch {
    Write-Error 'The lab test helper could not start. Use a local Windows 10/11 PC and keep all helper files together.'
    exit 1
}
