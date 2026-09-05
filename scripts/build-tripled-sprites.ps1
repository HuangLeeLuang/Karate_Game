$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class SpriteAlphaBounds {
  public static Rectangle Find(Bitmap bitmap, Rectangle area) {
    var full = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
    var data = bitmap.LockBits(full, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    try {
      int stride = Math.Abs(data.Stride);
      byte[] pixels = new byte[stride * bitmap.Height];
      Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
      int minX = area.Right, minY = area.Bottom, maxX = -1, maxY = -1;
      for (int y = area.Top; y < area.Bottom; y++) {
        int row = data.Stride >= 0 ? y * stride : (bitmap.Height - 1 - y) * stride;
        for (int x = area.Left; x < area.Right; x++) {
          if (pixels[row + x * 4 + 3] <= 8) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (maxX < minX || maxY < minY) return Rectangle.Empty;
      return new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
    } finally {
      bitmap.UnlockBits(data);
    }
  }
}
'@

$publicPath = Join-Path $PSScriptRoot '..\public'
$intermediatePath = Join-Path $PSScriptRoot '..\assets\sprite-intermediates'

function Get-CellRectangle {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [int]$Index,
    [int]$Columns,
    [int]$Rows
  )

  $column = $Index % $Columns
  $row = [Math]::Floor($Index / $Columns)
  $left = [Math]::Floor($column * $Bitmap.Width / $Columns)
  $right = [Math]::Floor(($column + 1) * $Bitmap.Width / $Columns)
  $top = [Math]::Floor($row * $Bitmap.Height / $Rows)
  $bottom = [Math]::Floor(($row + 1) * $Bitmap.Height / $Rows)
  return [System.Drawing.Rectangle]::new($left, $top, $right - $left, $bottom - $top)
}

function Get-FrameBounds {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [int]$Index,
    [int]$Columns,
    [int]$Rows
  )

  $cell = Get-CellRectangle $Bitmap $Index $Columns $Rows
  $bounds = [SpriteAlphaBounds]::Find($Bitmap, $cell)
  if ($bounds.IsEmpty) { throw "Frame $Index has no opaque pixels." }
  return $bounds
}

function Draw-Cell {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Bitmap]$Source,
    [int]$SourceIndex,
    [int]$Columns,
    [int]$Rows,
    [System.Drawing.Rectangle]$Destination
  )

  $sourceRect = Get-CellRectangle $Source $SourceIndex $Columns $Rows
  $Graphics.DrawImage(
    $Source,
    $Destination,
    $sourceRect.X,
    $sourceRect.Y,
    $sourceRect.Width,
    $sourceRect.Height,
    [System.Drawing.GraphicsUnit]::Pixel
  )
}

function Draw-NormalizedFrame {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Bitmap]$Source,
    [int]$SourceIndex,
    [int]$Columns,
    [int]$Rows,
    [System.Drawing.Rectangle]$CellDestination,
    [double]$VisibleHeight,
    [double]$FeetY
  )

  $bounds = Get-FrameBounds $Source $SourceIndex $Columns $Rows
  $scale = $VisibleHeight / $bounds.Height
  $width = [Math]::Max(1, [Math]::Round($bounds.Width * $scale))
  $height = [Math]::Max(1, [Math]::Round($bounds.Height * $scale))
  $destination = [System.Drawing.Rectangle]::new(
    $CellDestination.X + [Math]::Round(($CellDestination.Width - $width) / 2),
    [Math]::Round($FeetY - $height),
    $width,
    $height
  )
  $Graphics.DrawImage(
    $Source,
    $destination,
    $bounds.X,
    $bounds.Y,
    $bounds.Width,
    $bounds.Height,
    [System.Drawing.GraphicsUnit]::Pixel
  )
}

function Build-TripledSheet {
  param(
    [string]$InputName,
    [string]$IntermediateName,
    [string]$OutputName,
    [int]$Columns,
    [int]$Rows,
    [ValidateSet('pose', 'walk')][string]$Mode
  )

  $source = [System.Drawing.Bitmap]::FromFile((Join-Path $publicPath $InputName))
  $intermediate = [System.Drawing.Bitmap]::FromFile((Join-Path $intermediatePath $IntermediateName))
  try {
    $renderScale = 0.72
    $sourceCellWidth = $source.Width / $Columns
    $sourceCellHeight = $source.Height / $Rows
    $cellWidth = [Math]::Ceiling($sourceCellWidth * $renderScale)
    $cellHeight = [Math]::Ceiling($sourceCellHeight * $renderScale)
    $frameCount = $Columns * $Rows

    if ($Mode -eq 'walk') {
      $targetVisibleHeight = [Math]::Round($cellHeight * 0.92)
      $widestVisibleFrame = 0
      foreach ($sheet in @($source, $intermediate)) {
        for ($frame = 0; $frame -lt $frameCount; $frame += 1) {
          $bounds = Get-FrameBounds $sheet $frame $Columns $Rows
          $normalizedWidth = $bounds.Width * ($targetVisibleHeight / $bounds.Height)
          $widestVisibleFrame = [Math]::Max($widestVisibleFrame, $normalizedWidth)
        }
      }
      $cellWidth = [Math]::Ceiling($widestVisibleFrame + 20)
    } else {
      $sourceNeutral = Get-FrameBounds $source 0 $Columns $Rows
      $intermediateNeutral = Get-FrameBounds $intermediate 0 $Columns $Rows
      $targetNeutralHeight = $sourceNeutral.Height * ($cellHeight / $sourceCellHeight)
      $intermediateScale = $targetNeutralHeight / $intermediateNeutral.Height
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

        for ($frame = 0; $frame -lt $frameCount; $frame += 1) {
          $outputRow = [Math]::Floor($frame / $Columns)
          for ($phase = 0; $phase -lt 3; $phase += 1) {
            $outputColumn = ($frame % $Columns) * 3 + $phase
            $destination = [System.Drawing.Rectangle]::new(
              $outputColumn * $cellWidth,
              $outputRow * $cellHeight,
              $cellWidth,
              $cellHeight
            )

            if ($Mode -eq 'walk') {
              $feetY = $destination.Y + $cellHeight - 4
              if ($phase -eq 0) {
                Draw-NormalizedFrame $graphics $source $frame $Columns $Rows $destination $targetVisibleHeight $feetY
              } elseif ($phase -eq 1) {
                Draw-NormalizedFrame $graphics $intermediate $frame $Columns $Rows $destination $targetVisibleHeight $feetY
              } else {
                $nextFrame = (($frame + 1) % $Columns) + $outputRow * $Columns
                Draw-NormalizedFrame $graphics $source $nextFrame $Columns $Rows $destination $targetVisibleHeight $feetY
              }
            } elseif ($phase -eq 0) {
              Draw-Cell $graphics $source 0 $Columns $Rows $destination
            } elseif ($phase -eq 2) {
              Draw-Cell $graphics $source $frame $Columns $Rows $destination
            } else {
              $intermediateBounds = Get-FrameBounds $intermediate $frame $Columns $Rows
              $finalBounds = Get-FrameBounds $source $frame $Columns $Rows
              $visibleHeight = $intermediateBounds.Height * $intermediateScale
              $feetY = $destination.Y + $finalBounds.Bottom * ($cellHeight / $sourceCellHeight)
              Draw-NormalizedFrame $graphics $intermediate $frame $Columns $Rows $destination $visibleHeight $feetY
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
    $intermediate.Dispose()
    $source.Dispose()
  }
}

$sheets = @(
  @('fio-actions-v3.png', 'fio-actions-intermediates-v1.png', 'fio-actions-smooth-v4.png', 4, 2, 'pose'),
  @('enemy-quick-fist-v3.png', 'enemy-quick-fist-intermediates-v1.png', 'enemy-quick-fist-smooth-v4.png', 4, 3, 'pose'),
  @('enemy-long-kick-v3.png', 'enemy-long-kick-intermediates-v1.png', 'enemy-long-kick-smooth-v4.png', 4, 3, 'pose'),
  @('enemy-grappler-v3.png', 'enemy-grappler-intermediates-v1.png', 'enemy-grappler-smooth-v4.png', 4, 3, 'pose'),
  @('fio-hit-reactions-v3.png', 'fio-hit-reactions-intermediates-v1.png', 'fio-hit-reactions-smooth-v4.png', 4, 1, 'pose'),
  @('fio-guards-v2.png', 'fio-guards-intermediates-v1.png', 'fio-guards-smooth-v4.png', 4, 1, 'pose'),
  @('fio-gun-actions-v6.png', 'fio-gun-actions-intermediates-v1.png', 'fio-gun-actions-smooth-v4.png', 4, 1, 'pose'),
  @('kai-gun-actions-v2.png', 'kai-gun-actions-intermediates-v1.png', 'kai-gun-actions-smooth-v4.png', 4, 1, 'pose'),
  @('fio-walk-v3.png', 'fio-walk-intermediates-v1.png', 'fio-walk-smooth-v4.png', 4, 1, 'walk'),
  @('kai-walk-v2.png', 'kai-walk-intermediates-v1.png', 'kai-walk-smooth-v4.png', 4, 1, 'walk'),
  @('enemy-long-kick-walk-v1.png', 'enemy-long-kick-walk-intermediates-v1.png', 'enemy-long-kick-walk-smooth-v4.png', 4, 1, 'walk'),
  @('enemy-grappler-walk-v1.png', 'enemy-grappler-walk-intermediates-v1.png', 'enemy-grappler-walk-smooth-v4.png', 4, 1, 'walk')
)

foreach ($sheet in $sheets) {
  Build-TripledSheet @sheet
}

Write-Host "Built $($sheets.Count) tripled-frame sprite sheets with true transition poses."
