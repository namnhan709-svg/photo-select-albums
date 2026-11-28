param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist')
)

if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $OutDir 'css') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $OutDir 'js') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $OutDir 'photowedding\logo') -Force | Out-Null

$topFiles = @(
    'index.html',
    'portfolio.html',
    'albums.html',
    'login.html',
    'studio-contracts.html',
    'studio-invoices.html',
    'studio-photographers.html',
    'studio-customers.html',
    'studio-reports.html',
    '404.html',
    '.nojekyll'
)

foreach ($f in $topFiles) {
    $src = Join-Path $Root $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $OutDir $f) -Force }
}

Copy-Item (Join-Path $Root 'css\*') (Join-Path $OutDir 'css') -Recurse -Force
Copy-Item (Join-Path $Root 'js\*') (Join-Path $OutDir 'js') -Recurse -Force
Copy-Item (Join-Path $Root 'photowedding\index.js') (Join-Path $OutDir 'photowedding\index.js') -Force
Copy-Item (Join-Path $Root 'photowedding\logo\*') (Join-Path $OutDir 'photowedding\logo') -Recurse -Force

Write-Host "Built static GitHub Pages bundle at: $OutDir"
Get-ChildItem -Recurse -File $OutDir | Select-Object FullName, Length
