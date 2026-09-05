$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$publicPath = Join-Path $PSScriptRoot '..\public'
$stagePath = Join-Path $publicPath 'urban-stage.png'
$stage = [System.Drawing.Bitmap]::FromFile($stagePath)
try {
  $halfWidth = [Math]::Floor($stage.Width / 2)
  $cropX = [Math]::Floor(($stage.Width - $halfWidth) / 2)
  $seamless = [System.Drawing.Bitmap]::new(
    $halfWidth * 2,
    $stage.Height,
    [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
  )
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($seamless)
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $source = [System.Drawing.Rectangle]::new($cropX, 0, $halfWidth, $stage.Height)
      $tile = $stage.Clone($source, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
      try {
        $mirror = $tile.Clone()
        try {
          $mirror.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipX)
          $graphics.DrawImageUnscaled($tile, 0, 0)
          $graphics.DrawImageUnscaled($mirror, $halfWidth, 0)
        } finally {
          $mirror.Dispose()
        }
      } finally {
        $tile.Dispose()
      }
    } finally {
      $graphics.Dispose()
    }
    $seamless.Save(
      (Join-Path $publicPath 'urban-stage-seamless.png'),
      [System.Drawing.Imaging.ImageFormat]::Png
    )
  } finally {
    $seamless.Dispose()
  }
} finally {
  $stage.Dispose()
}

$generatedIcon = 'C:\Users\Huang\.codex\generated_images\01a06ef6-1729-77e2-9a78-a9b57d39e061\exec-572924ef-ea64-4613-a738-f30d1ab37279.png'
$magick = (Get-Command magick -ErrorAction SilentlyContinue).Source
if (-not $magick) {
  $magick = 'C:\Program Files (x86)\ImageMagick-7.0.3-Q16\magick.exe'
}
Copy-Item -LiteralPath $generatedIcon -Destination (Join-Path $publicPath 'neon-karate-icon-master.png') -Force
& $magick $generatedIcon -resize '512x512!' (Join-Path $publicPath 'icon-512.png')
& $magick $generatedIcon -resize '192x192!' (Join-Path $publicPath 'icon-192.png')
& $magick $generatedIcon -resize '180x180!' (Join-Path $publicPath 'apple-touch-icon.png')
& $magick $generatedIcon -resize '384x384!' -gravity center -background '#020617' -extent '512x512' (Join-Path $publicPath 'icon-maskable-512.png')

Write-Host 'Built seamless stage and mobile icons.'
