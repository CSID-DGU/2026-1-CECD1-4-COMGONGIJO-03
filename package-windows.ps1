param()

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Only tracked runtime paths and the files listed explicitly below go into the ZIP.
$tracked = git -c core.quotepath=false ls-files -- backend test/Crawling
if ($LASTEXITCODE -ne 0) { throw 'Run packaging from the Git worktree.' }
$runtime = @($tracked | Where-Object {
    $_ -match '^backend/(ai|controllers|crawler|repositories|routes|services)/[^/]+\.js$' -or
    $_ -match '^backend/frontend/src/.+\.(css|jsx?|json)$' -and $_ -notmatch '\.test\.js$' -or
    $_ -match '^backend/(\.dockerignore|Dockerfile|app\.js|db\.js|server\.js|package(-lock)?\.json|sql/schema2\.sql)$' -or
    $_ -match '^backend/frontend/(\.dockerignore|Dockerfile|index\.html|nginx\.conf|vite\.config\.js|package(-lock)?\.json)$' -or
    $_ -match '^test/Crawling/(\.dockerignore|Dockerfile(\.worker)?|package(-lock)?\.json|proxy\.js|worker\.js)$'
})
$runtime += @('compose.yaml','compose.gpu.yaml','.env.docker.example','start.ps1','backend/verify-ollama.js')
$launch = @('Install.bat','Start.bat','Stop.bat','사용설명서.txt')
$release = Join-Path $PSScriptRoot 'release'
[void][IO.Directory]::CreateDirectory($release)
$zip = Join-Path $release 'SeoulMetro-NewsAI-Windows.zip'
$tmpZip = Join-Path $release ("package-$PID.tmp")
try {
    $archive = [IO.Compression.ZipFile]::Open($tmpZip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($path in $launch) {
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $PSScriptRoot $path), "SeoulMetro-NewsAI/$path")
        }
        foreach ($path in $runtime | Sort-Object -Unique) {
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $PSScriptRoot $path), "SeoulMetro-NewsAI/system/$path")
        }
    } finally { $archive.Dispose() }
    Move-Item -LiteralPath $tmpZip -Destination $zip -Force
} finally { [IO.File]::Delete($tmpZip) }
Get-Item -LiteralPath $zip
