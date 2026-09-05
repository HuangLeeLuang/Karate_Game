$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$publicPath = Join-Path $PSScriptRoot '..\public'

function Draw-Cell {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Bitmap]$Source,
    [int]$SourceIndex,
    [int]$Columns,
    [int]$Rows,
    [System.Drawing.Rectangle]$Destination,
    [float]$Opacity
  )

  $sourceColumn = $SourceIndex % $Columns
  $sourceRow = [Math]::Floor($SourceIndex / $Columns)
  $sourceCellWidth = $Source.Width / $Columns
  $sourceCellHeight = $Source.Height / $Rows
  $sourceRect = [System.Drawing.RectangleF]::new(
    $sourceColumn * $sourceCellWidth,
    $sourceRow * $sourceCellHeight,
    $sourceCellWidth,
    $sourceCellHeight
  )
  $matrix = [System.Drawing.Imaging.ColorMatrix]::new()
  $matrix.Matrix33 = $Opacity
  $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
  $attributes.SetColorMatrix($matrix)
  $Graphics.DrawImage(
    $Source,
    $Destination,
    $sourceRect.X,
    $sourceRect.Y,
    $sourceRect.Width,
    $sourceRect.Height,
    [System.Drawing.GraphicsUnit]::Pixel,
    $attributes
  )
  $attributes.Dispose()
}

function Build-TripledSheet {
  param(
    [string]$InputName,
    [string]$OutputName,
    [int]$Columns,
    [int]$Rows,
    [ValidateSet('pose', 'walk')][string]$Mode
  )

  $source = [System.Drawing.Bitmap]::FromFile((Join-Path $publicPath $InputName))
  try {
    # Three times as many cells need not mean three times the decoded mobile
    # memory. 72% source cells remain crisp at the game's render size while
    # preserving the exact original aspect ratio in every frame.
    $renderScale = 0.72
    $cellWidth = [Math]::Ceiling(($source.Width / $Columns) * $renderScale)
    $cellHeight = [Math]::Ceiling(($source.Height / $Rows) * $renderScale)
    $output = [System.Drawing.Bitmap]::new(
      $cellWidth * $Columns * 3,
      $cellHeight * $Rows,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($output)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

        $frameCount = $Columns * $Rows
        for ($frame = 0; $frame -lt $frameCount; $frame += 1) {
          for ($phase = 0; $phase -lt 3; $phase += 1) {
            $outputColumn = ($frame % $Columns) * 3 + $phase
            $outputRow = [Math]::Floor($frame / $Columns)
            $destination = [System.Drawing.Rectangle]::new(
              $outputColumn * $cellWidth,
              $outputRow * $cellHeight,
              $cellWidth,
              $cellHeight
            )

            if ($Mode -eq 'walk') {
              $nextFrame = (($frame + 1) % $Columns) + $outputRow * $Columns
              if ($phase -eq 0) {
                Draw-Cell $graphics $source $frame $Columns $Rows $destination 1
              } elseif ($phase -eq 1) {
                Draw-Cell $graphics $source $frame $Columns $Rows $destination 1
                Draw-Cell $graphics $source $nextFrame $Columns $Rows $destination 0.33
              } else {
                Draw-Cell $graphics $source $nextFrame $Columns $Rows $destination 1
                Draw-Cell $graphics $source $frame $Columns $Rows $destination 0.33
              }
            } elseif ($frame -eq 0) {
              Draw-Cell $graphics $source 0 $Columns $Rows $destination 1
            } else {
              if ($phase -eq 0) {
                Draw-Cell $graphics $source 0 $Columns $Rows $destination 1
                Draw-Cell $graphics $source $frame $Columns $Rows $destination 0.33
              } elseif ($phase -eq 1) {
                Draw-Cell $graphics $source $frame $Columns $Rows $destination 1
                Draw-Cell $graphics $source 0 $Columns $Rows $destination 0.33
              } else {
                Draw-Cell $graphics $source $frame $Columns $Rows $destination 1
              }
            }
          }
        }
      } finally {
        $graphics.Dispose()
      }
      $output.Save(
        (Join-Path $publicPath $OutputName),
        [System.Drawing.Imaging.ImageFormat]::Png
      )
    } finally {
      $output.Dispose()
    }
  } finally {
    $source.Dispose()
  }
}

$sheets = @(
  @('fio-actions-v3.png', 'fio-actions-smooth-v2.png', 4, 2, 'pose'),
  @('enemy-quick-fist-v3.png', 'enemy-quick-fist-smooth-v2.png', 4, 3, 'pose'),
  @('enemy-long-kick-v3.png', 'enemy-long-kick-smooth-v2.png', 4, 3, 'pose'),
  @('enemy-grappler-v3.png', 'enemy-grappler-smooth-v2.png', 4, 3, 'pose'),
  @('fio-hit-reactions-v3.png', 'fio-hit-reactions-smooth-v2.png', 4, 1, 'pose'),
  @('fio-guards-v2.png', 'fio-guards-smooth-v2.png', 4, 1, 'pose'),
  @('fio-gun-actions-v6.png', 'fio-gun-actions-smooth-v2.png', 4, 1, 'pose'),
  @('kai-gun-actions-v2.png', 'kai-gun-actions-smooth-v2.png', 4, 1, 'pose'),
  @('fio-walk-v3.png', 'fio-walk-smooth-v2.png', 4, 1, 'walk'),
  @('kai-walk-v2.png', 'kai-walk-smooth-v2.png', 4, 1, 'walk'),
  @('enemy-long-kick-walk-v1.png', 'enemy-long-kick-walk-smooth-v2.png', 4, 1, 'walk'),
  @('enemy-grappler-walk-v1.png', 'enemy-grappler-walk-smooth-v2.png', 4, 1, 'walk')
)

foreach ($sheet in $sheets) {
  Build-TripledSheet @sheet
}

Write-Host "Built $($sheets.Count) tripled-frame sprite sheets."
