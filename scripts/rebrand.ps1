Write-Host "Starting rebranding to PINNACLE AI AGENT"
# Paths to the master brand images
$wordmarkPath = "D:\OPENCODE\MCPs\Pinnacle-Logo.png"
$symbolPath   = "D:\OPENCODE\MCPs\Pinnacle sympol logo.png"
$wordmarkBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($wordmarkPath))
$symbolBase64   = [Convert]::ToBase64String([IO.File]::ReadAllBytes($symbolPath))

function Get-PngSize($p) {
  $b = [IO.File]::ReadAllBytes($p)
  $w = ($b[16] * 16777216) + ($b[17] * 65536) + ($b[18] * 256) + $b[19]
  $h = ($b[20] * 16777216) + ($b[21] * 65536) + ($b[22] * 256) + $b[23]
  return @($w, $h)
}
$symbolSize = Get-PngSize $symbolPath
$wordmarkSize = Get-PngSize $wordmarkPath

# Replace the data URIs and dimensions in the asset file (constant names stay unchanged)
$assetFile = "D:\OPENCODE\MCPs\deepseek-harness\packages\client\ui-primitives\src\tbyaan-assets.ts"
$content = Get-Content -Path $assetFile -Raw
$content = $content -replace "(?s)export const TBYAAN_SYMBOL_DATA_URI =.*?;", "export const TBYAAN_SYMBOL_DATA_URI = `n  'data:image/png;base64,$symbolBase64';"
$content = $content -replace "(?s)export const TBYAAN_WORDMARK_DATA_URI =.*?;", "export const TBYAAN_WORDMARK_DATA_URI = `n  'data:image/png;base64,$wordmarkBase64';"
$content = $content -replace "(?s)export const TBYAAN_SYMBOL_DIMENSIONS = \{.*?\}", "export const TBYAAN_SYMBOL_DIMENSIONS = {`n  width: $($symbolSize[0]),`n  height: $($symbolSize[1]),`n}"
$content = $content -replace "(?s)export const TBYAAN_WORDMARK_DIMENSIONS = \{.*?\}", "export const TBYAAN_WORDMARK_DIMENSIONS = {`n  width: $($wordmarkSize[0]),`n  height: $($wordmarkSize[1]),`n}"
Set-Content -Path $assetFile -Value $content -Encoding UTF8
Write-Host "Updated asset file $assetFile"

# Helper function to replace text in source files (build outputs and dependencies excluded)
function Replace-InFiles($pattern, $replacement) {
  Get-ChildItem -Path "D:\OPENCODE\MCPs\deepseek-harness" -Recurse -Include *.ts,*.tsx,*.json,*.html,*.yml,*.yaml,*.webmanifest -File |
    Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|dist|lib|\.dsh-build|vendor)\\' } |
    ForEach-Object {
      $text = Get-Content -Path $_.FullName -Raw
      if ($text -match $pattern) {
        $new = $text -replace $pattern, $replacement
        Set-Content -Path $_.FullName -Value $new -Encoding UTF8
        Write-Host "Replaced in $($_.FullName)"
      }
    }
}

Replace-InFiles 'TBYAAN HARNESS' 'PINNACLE AI AGENT'

Write-Host "Rebranding complete. Favicon/PWA/desktop icons are generated from the symbol PNG separately."