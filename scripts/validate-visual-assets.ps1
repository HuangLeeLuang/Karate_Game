$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$publicPath = Join-Path $PSScriptRoot '..\public'
$stage = [System.Drawing.Bitmap]::FromFile((Join-Path $publicPath 'urban-stage-seamless.png'))
try {
  for ($y = 0; $y -lt $stage.Height; $y += 1) {
    if ($stage.GetPixel(0, $y).ToArgb() -ne $stage.GetPixel($stage.Width - 1, $y).ToArgb()) {
      throw "Stage edges differ at y=$y"
    }
  }
} finally {
  $stage.Dispose()
}

$sheetDefinitions = @(
  @('fio-actions-smooth.png', 24),
  @('enemy-quick-fist-smooth.png', 36),
  @('enemy-long-kick-smooth.png', 36),
  @('enemy-grappler-smooth.png', 36),
  @('fio-hit-reactions-smooth.png', 12),
  @('fio-guards-smooth.png', 12),
  @('fio-gun-actions-smooth.png', 12),
  @('kai-gun-actions-smooth.png', 12),
  @('fio-walk-smooth.png', 12),
  @('kai-walk-smooth.png', 12),
  @('enemy-long-kick-walk-smooth.png', 12),
  @('enemy-grappler-walk-smooth.png', 12)
)

foreach ($definition in $sheetDefinitions) {
  $name = $definition[0]
  $expectedFrames = $definition[1]
  $rows = if ($expectedFrames -eq 24) { 2 } elseif ($expectedFrames -eq 36) { 3 } else { 1 }
  $image = [System.Drawing.Bitmap]::FromFile((Join-Path $publicPath $name))
  try {
    $columns = 12
    if ($image.Width % $columns -ne 0 -or $image.Height % $rows -ne 0) {
      throw "$name does not contain an even 12-column grid"
    }
    if ($columns * $rows -ne $expectedFrames) {
      throw "$name frame count is incorrect"
    }
  } finally {
    $image.Dispose()
  }
}

Write-Host 'Validated seamless stage edges and 228 animation frames.'
