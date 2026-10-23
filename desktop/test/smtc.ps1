# Talks to Windows' system media controls (the "what's playing" panel by the
# volume flyout), which is where media keys go when an app isn't focused.
# Only the session whose title starts with -Title is reported or controlled;
# other apps' sessions are counted, never read or touched.
#   -Action list | toggle | next | previous
param([string]$Title, [string]$Action = 'list')
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await ($managerType::RequestAsync()) $managerType

$mine = $null
$others = 0
foreach ($session in $manager.GetSessions()) {
  $props = Await ($session.TryGetMediaPropertiesAsync()) $propsType
  if ($Title -and $props.Title -like "$Title*") { $mine = @{ session = $session; props = $props } } else { $others++ }
}

if ($mine -and $Action -ne 'list') {
  $ok = switch ($Action) {
    'toggle' { Await ($mine.session.TryTogglePlayPauseAsync()) ([bool]) }
    'next' { Await ($mine.session.TrySkipNextAsync()) ([bool]) }
    'previous' { Await ($mine.session.TrySkipPreviousAsync()) ([bool]) }
  }
  @{ action = $Action; accepted = $ok } | ConvertTo-Json -Compress
  exit
}

$info = if ($mine) { $mine.session.GetPlaybackInfo() } else { $null }
@{
  found = [bool]$mine
  app = if ($mine) { $mine.session.SourceAppUserModelId } else { $null }
  title = if ($mine) { $mine.props.Title } else { $null }
  artist = if ($mine) { $mine.props.Artist } else { $null }
  album = if ($mine) { $mine.props.AlbumTitle } else { $null }
  status = if ($info) { "$($info.PlaybackStatus)" } else { $null }
  canNext = if ($info) { $info.Controls.IsNextEnabled } else { $null }
  otherSessions = $others
} | ConvertTo-Json -Compress
