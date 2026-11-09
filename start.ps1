$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$composeArgs = @(
    "--env-file", ".env.docker",
    "-f", "compose.yaml",
    "-f", "compose.gpu.yaml"
)

# 1. Docker 설치 확인
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Docker is not installed."
    exit 1
}

# 2. Docker 엔진 확인
docker info *> $null

if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker Desktop is not running."
    exit 1
}

# 3. 환경변수 파일 확인
if (-not (Test-Path ".env.docker")) {
    Write-Host ".env.docker is missing."
    exit 1
}

# 4. NVIDIA GPU 확인
if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
    Write-Host "NVIDIA GPU driver was not found."
    exit 1
}

nvidia-smi *> $null

if ($LASTEXITCODE -ne 0) {
    Write-Host "NVIDIA GPU is unavailable."
    exit 1
}

# 5. Compose 설정 검증
docker compose @composeArgs config --quiet

if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker Compose configuration is invalid."
    exit 1
}

# 6. 서비스 실행
Write-Host "Starting Docker services..."

docker compose @composeArgs up -d --build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to start Docker services."
    exit 1
}

# 7. Ollama 모델 준비
foreach ($model in @("qwen3:8b", "bge-m3")) {
    Write-Host "Checking model: $model"

    docker compose @composeArgs exec -T ollama ollama show $model 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Downloading model: $model"

        docker compose @composeArgs exec -T ollama ollama pull $model

        if ($LASTEXITCODE -ne 0) {
            Write-Host "Failed to download model: $model"
            exit 1
        }
    }
}

Write-Host ""
Write-Host "Startup completed."
Write-Host "Web: http://localhost:8080"

docker compose @composeArgs ps