param(
    [switch]$Stop
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker CLI was not found. Install Docker Desktop with Docker Compose."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker engine is unavailable. Start Docker Desktop and wait until it is ready."
}

if (-not (Test-Path -LiteralPath ".env.docker")) {
    throw "Copy .env.docker.example to .env.docker and set the database credentials."
}

$composeArgs = @("--env-file", ".env.docker", "-f", "compose.yaml")

if ($Stop) {
    docker compose @composeArgs stop
    exit $LASTEXITCODE
}

$envLines = Get-Content -LiteralPath ".env.docker"

foreach ($key in @("DOCKER_DB_USER", "DOCKER_DB_PASSWORD", "DOCKER_MYSQL_ROOT_PASSWORD")) {
    $assignment = $envLines | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -Last 1

    if (-not $assignment -or $assignment -match '=\s*(?:["'']?CHANGE_ME["'']?)?\s*(?:#.*)?$') {
        throw "Set $key in .env.docker before starting."
    }
}

docker compose @composeArgs config --quiet
if ($LASTEXITCODE -ne 0) {
    throw "Compose configuration failed. Check .env.docker and Compose support."
}

docker compose @composeArgs up -d --wait --wait-timeout 180 db ollama
if ($LASTEXITCODE -ne 0) {
    throw "DB or Ollama failed to start. Check Docker resources and Compose logs."
}

foreach ($model in @("qwen3:8b", "bge-m3")) {
    docker compose @composeArgs exec -T ollama ollama show $model *> $null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Downloading Ollama model $model. This may take several minutes."

        docker compose @composeArgs exec -T ollama ollama pull $model

        if ($LASTEXITCODE -ne 0) {
            throw "Could not prepare model $model. Check the network and free disk space."
        }
    }
}

docker compose @composeArgs up -d --build --wait --wait-timeout 120 backend frontend
if ($LASTEXITCODE -ne 0) {
    throw "Web or backend did not become ready. Use docker compose --env-file .env.docker logs --tail 80 backend frontend db."
}

Write-Host "Web: http://localhost:8080"
Write-Host "Phone on the same Wi-Fi: http://<this-PC-IPv4>:8080"
Write-Host "Stop and keep data: powershell -ExecutionPolicy Bypass -File .\start.ps1 -Stop"

docker compose @composeArgs ps