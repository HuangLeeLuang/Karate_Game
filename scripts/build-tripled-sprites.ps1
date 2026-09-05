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
    [ValidateSet('pose', 'walk')][string]$Mode,
    [object[]]$WalkBounds = @()
  )

  $source = [System.Drawing.Bitmap]::FromFile((Join-Path $publicPath $InputName))
  try {
    # Three times as many cells need not mean three times the decoded mobile
    # memory. 72% source cells remain crisp at the game's render size while
    # preserving the exact original aspect ratio in every frame.
    $renderScale = 0.72
    $cellWidth = [Math]::Ceiling(($source.Width / $Columns) * $renderScale)
    $cellHeight = [Math]::Ceiling(($source.Height / $Rows) * $renderScale)

    # Walk sources contain very different amounts of transparent padding. The
    # old blended phases alternated between one and two visible bodies. Keep
    # one fully opaque pose per cell and normalize its height, center and feet.
    if ($Mode -eq 'walk') {
      if ($WalkBounds.Count -ne ($Columns * $Rows)) {
        throw "$InputName needs one opaque-bounds rectangle per source frame."
      }
      $targetVisibleHeight = [Math]::Round($cellHeight * 0.92)
      $widestVisibleFrame = 0
      foreach ($bounds in $WalkBounds) {
        $normalizedWidth = $bounds[2] * ($targetVisibleHeight / $bounds[3])
        $widestVisibleFrame = [Math]::Max($widestVisibleFrame, $normalizedWidth)
      }
      $cellWidth = [Math]::Ceiling($widestVisibleFrame + 20)
    }
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
              $bounds = $WalkBounds[$frame]
              $scale = $targetVisibleHeight / $bounds[3]
              $visibleWidth = [Math]::Round($bounds[2] * $scale)
              $sourceCellWidth = $source.Width / $Columns
              $sourceCellHeight = $source.Height / $Rows
              $sourceRect = [System.Drawing.RectangleF]::new(
                ($frame % $Columns) * $sourceCellWidth + $bounds[0],
                [Math]::Floor($frame / $Columns) * $sourceCellHeight + $bounds[1],
                $bounds[2],
                $bounds[3]
              )
              $normalizedDestination = [System.Drawing.Rectangle]::new(
                $outputColumn * $cellWidth + [Math]::Round(($cellWidth - $visibleWidth) / 2),
                $outputRow * $cellHeight + $cellHeight - $targetVisibleHeight - 4,
                $visibleWidth,
                $targetVisibleHeight
              )
              $graphics.DrawImage(
                $source,
                $normalizedDestination,
                $sourceRect.X,
                $sourceRect.Y,
                $sourceRect.Width,
                $sourceRect.Height,
                [System.Drawing.GraphicsUnit]::Pixel
              )
            } else {
              Draw-Cell $graphics $source $frame $Columns $Rows $destination 1
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
  @('fio-actions-v3.png', 'fio-actions-smooth-v3.png', 4, 2, 'pose'),
  @('enemy-quick-fist-v3.png', 'enemy-quick-fist-smooth-v3.png', 4, 3, 'pose'),
  @('enemy-long-kick-v3.png', 'enemy-long-kick-smooth-v3.png', 4, 3, 'pose'),
  @('enemy-grappler-v3.png', 'enemy-grappler-smooth-v3.png', 4, 3, 'pose'),
  @('fio-hit-reactions-v3.png', 'fio-hit-reactions-smooth-v3.png', 4, 1, 'pose'),
  @('fio-guards-v2.png', 'fio-guards-smooth-v3.png', 4, 1, 'pose'),
  @('fio-gun-actions-v6.png', 'fio-gun-actions-smooth-v3.png', 4, 1, 'pose'),
  @('kai-gun-actions-v2.png', 'kai-gun-actions-smooth-v3.png', 4, 1, 'pose'),
  @('fio-walk-v3.png', 'fio-walk-smooth-v3.png', 4, 1, 'walk', @(
    @(119, 111, 337, 605), @(136, 112, 260, 601),
    @(57, 115, 383, 600), @(57, 115, 314, 600)
  )),
  @('kai-walk-v2.png', 'kai-walk-smooth-v3.png', 4, 1, 'walk', @(
    @(25, 14, 518, 692), @(0, 5, 543, 703),
    @(0, 29, 543, 671), @(0, 10, 491, 699)
  )),
  @('enemy-long-kick-walk-v1.png', 'enemy-long-kick-walk-smooth-v3.png', 4, 1, 'walk', @(
    @(33, 11, 510, 679), @(0, 5, 541, 685),
    @(1, 15, 542, 687), @(0, 11, 513, 682)
  )),
  @('enemy-grappler-walk-v1.png', 'enemy-grappler-walk-smooth-v3.png', 4, 1, 'walk', @(
    @(19, 14, 501, 714), @(1, 0, 519, 726),
    @(0, 4, 519, 718), @(0, 0, 517, 726)
  ))
)

foreach ($sheet in $sheets) {
  Build-TripledSheet @sheet
}

Write-Host "Built $($sheets.Count) tripled-frame sprite sheets."
