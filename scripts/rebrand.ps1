# Refresh the Pinnacle brand artwork embedded in the client asset module.
# Product-name strings live in the harness locale files; this script only rewrites the PNG data URIs.
$ErrorActionPreference = 'Stop'

$wordmarkPath = 'D:\OPENCODE\MCPs\Pinnacle-Logo.png'
$symbolPath = 'D:\OPENCODE\MCPs\Pinnacle sympol logo.png'
$wordmarkBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($wordmarkPath))
$symbolBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($symbolPath))

function Get-PngSize($path) {
  $bytes = [IO.File]::ReadAllBytes($path)
  $width = ($bytes[16] * 16777216) + ($bytes[17] * 65536) + ($bytes[18] * 256) + $bytes[19]
  $height = ($bytes[20] * 16777216) + ($bytes[21] * 65536) + ($bytes[22] * 256) + $bytes[23]
  return @($width, $height)
}

$symbolSize = Get-PngSize $symbolPath
$wordmarkSize = Get-PngSize $wordmarkPath

$assetFile = 'D:\OPENCODE\MCPs\deepseek-harness\packages\client\ui-primitives\src\pinnacle-assets.ts'
$content = Get-Content -Path $assetFile -Raw
$content = $content -replace '(?s)export const PINNACLE_SYMBOL_DATA_URI =.*?;', "export const PINNACLE_SYMBOL_DATA_URI = `n  'data:image/png;base64,$symbolBase64';"
$content = $content -replace '(?s)export const PINNACLE_WORDMARK_DATA_URI =.*?;', "export const PINNACLE_WORDMARK_DATA_URI = `n  'data:image/png;base64,$wordmarkBase64';"
$content = $content -replace '(?s)export const PINNACLE_SYMBOL_DIMENSIONS = \{.*?\}', "export const PINNACLE_SYMBOL_DIMENSIONS = {`n  width: $($symbolSize[0]),`n  height: $($symbolSize[1]),`n}"
$content = $content -replace '(?s)export const PINNACLE_WORDMARK_DIMENSIONS = \{.*?\}', "export const PINNACLE_WORDMARK_DIMENSIONS = {`n  width: $($wordmarkSize[0]),`n  height: $($wordmarkSize[1]),`n}"
Set-Content -Path $assetFile -Value $content -Encoding UTF8

Write-Host "Updated $assetFile. Favicon, PWA, and desktop icons are generated from the symbol PNG separately."
