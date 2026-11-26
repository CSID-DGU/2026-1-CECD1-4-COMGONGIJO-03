param(
    [ValidateSet('Install','Start','Stop','Update')][string]$Action = 'Start',
    [ValidateSet('Auto','CPU','GPU')][string]$Mode = 'Auto',
    [ValidatePattern('^[a-z0-9][a-z0-9_-]*$')][string]$ProjectName,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$envPath = Join-Path $PSScriptRoot '.env.docker'
$setupUrl = 'https://docs.docker.com/desktop/setup/install/windows-install/'
$log = $null
$lock = $null
$exitCode = 0

function Say([string]$Message) {
    Write-Host $Message
    if ($log) { [IO.File]::AppendAllText($log, "$(Get-Date -Format HH:mm:ss) $Message" + [Environment]::NewLine, $utf8) }
}

# Native output can include environment values. Record stage, outcome and exit code only.
function Docker([string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    $output = & $dockerExe @Arguments 2>$null
    [pscustomobject]@{ Code = $LASTEXITCODE; Lines = @($output) }
}

function Compose([string[]]$Arguments) { Docker ($composeArgs + $Arguments) }

function Check($Result, [string]$Message) {
    if ($Result.Code -ne 0) { throw "$Message (종료 코드 $($Result.Code))" }
}

function Engine([int]$TimeoutMilliseconds = 15000) {
    $p = [Diagnostics.Process]::new()
    $p.StartInfo.FileName = $dockerExe
    $p.StartInfo.Arguments = 'info --format "{{.OSType}}"'
    $p.StartInfo.UseShellExecute = $false
    $p.StartInfo.CreateNoWindow = $true
    $p.StartInfo.RedirectStandardOutput = $true
    $p.StartInfo.RedirectStandardError = $true
    try {
        [void]$p.Start()
        $result = $p.StandardOutput.ReadToEndAsync()
        [void]$p.StandardError.ReadToEndAsync()
        if (-not $p.WaitForExit($TimeoutMilliseconds)) {
            if (-not $p.HasExited) { $p.Kill() }
            return
        }
        if ($p.ExitCode -eq 0) { $result.GetAwaiter().GetResult().Trim() }
    } finally { $p.Dispose() }
}

function Check-Windows {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Say '일반 사용자 권한입니다. WSL2 또는 가상화 활성화가 필요하면 전산 담당자에게 문의하세요.'
    }
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $pc = Get-CimInstance Win32_ComputerSystem
        $cpu = Get-CimInstance Win32_Processor
        $wsl = Get-CimInstance Win32_OptionalFeature -Filter "Name='VirtualMachinePlatform'"
        $ram = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
        $free = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
        Say "Windows RAM $ram GiB 중 $free GiB 사용 가능"
        if ($ram -lt 16) { Say 'RAM이 16 GiB 미만이면 CPU 분석이 느리거나 메모리 부족으로 실패할 수 있습니다.' }
        if (-not $pc.HypervisorPresent -and -not ($cpu.VirtualizationFirmwareEnabled -contains $true)) {
            Say '펌웨어 가상화를 확인하지 못했습니다. Docker가 시작되지 않으면 BIOS/UEFI 설정을 확인하세요.'
        }
        if ($wsl.InstallState -ne 1 -or -not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
            Say 'WSL2 환경을 확인하지 못했습니다. Docker가 시작되지 않으면 WSL2 설정과 재부팅 여부를 확인하세요.'
        }
    } catch { Say 'Windows 메모리 또는 가상화 정보를 조회하지 못했습니다.' }
    try {
        $drives = @((Get-Item -LiteralPath $PSScriptRoot).PSDrive.Name, $env:LOCALAPPDATA.Substring(0, 1)) | Select-Object -Unique
        foreach ($name in $drives) {
            $drive = Get-PSDrive -Name $name
            if ($null -eq $drive.Free) { continue }
            $space = [math]::Round($drive.Free / 1GB, 1)
            Say "$($name): 드라이브 여유 공간 $space GiB"
            if ($space -lt 20) { Say 'Docker 데이터 저장 드라이브에 여유 공간 20 GiB를 권장합니다.' }
        }
    } catch { Say '드라이브 여유 공간을 조회하지 못했습니다.' }
}

function New-Password {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

function Wait-Web([string]$Url) {
    $deadline = (Get-Date).AddMinutes(2)
    do {
        try {
            $page = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 5
            $api = Invoke-WebRequest "$Url/api/articles" -UseBasicParsing -TimeoutSec 5
            if ($page.StatusCode -eq 200 -and $page.Content -match '<div id="root"' -and
                $api.StatusCode -eq 200 -and $api.Headers['Content-Type'] -match 'application/json' -and
                ($api.Content | ConvertFrom-Json).success -eq $true) { return }
        } catch {
            # nginx and the backend may still be starting.
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw '웹 화면 또는 기사 API가 응답하지 않습니다. 전산 담당자에게 frontend, backend, db 상태를 확인해 달라고 요청하세요.'
}

try {
    $logs = Join-Path $PSScriptRoot 'logs'
    [void][IO.Directory]::CreateDirectory($logs)
    $log = Join-Path $logs "$(Get-Date -Format yyyyMMdd-HHmmss)-$PID.log"
    try {
        $lock = [IO.File]::Open((Join-Path $logs 'launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    } catch [IO.IOException] { throw '이 폴더에서 이미 설치, 실행 또는 종료 작업을 진행 중입니다. 해당 창이 끝날 때까지 기다려 주세요.' }
    Say '실행 환경을 확인하고 있습니다.'
    $desktop = @(
        "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    $cli = Get-Command docker.exe -CommandType Application -ErrorAction SilentlyContinue
    $dockerExe = if ($cli) { $cli.Source } elseif ($desktop) { Join-Path (Split-Path $desktop) 'resources/bin/docker.exe' }
    if (-not $dockerExe -or -not (Test-Path -LiteralPath $dockerExe -PathType Leaf)) {
        throw "Docker Desktop을 찾을 수 없습니다. 전산 담당자와 설치 권한 및 라이선스를 확인한 뒤 설치하세요. $setupUrl"
    }
    Check (Docker @('compose','version')) "Docker Compose를 사용할 수 없습니다. Docker Desktop을 업데이트하세요. $setupUrl"
    if ($Action -eq 'Install') { Check-Windows }

    $endpoint = Docker @('context','inspect','--format','{{.Endpoints.docker.Host}}')
    Check $endpoint 'Docker 연결을 확인할 수 없습니다. Docker Desktop에서 로컬 Linux 엔진을 선택하세요.'
    $hostEndpoint = if ($env:DOCKER_HOST -and -not $env:DOCKER_CONTEXT) { $env:DOCKER_HOST } else { $endpoint.Lines -join '' }
    if ($hostEndpoint -notmatch '^npipe:/+\./pipe/(docker_engine|dockerDesktopLinuxEngine)$') {
        throw 'Docker 연결이 이 PC의 Docker Desktop을 가리키지 않습니다. 로컬 엔진을 선택하세요.'
    }
    $engineType = if ($Action -eq 'Stop') { Engine 30000 } else { Engine }
    if (-not $engineType -and $Action -eq 'Stop') {
        throw 'Docker 엔진에 연결할 수 없습니다. Docker Desktop에서 엔진 상태를 확인하세요.'
    }
    if (-not $engineType) {
        if (-not $desktop) { throw "Docker Desktop 실행 파일을 찾을 수 없습니다. 시작 메뉴에서 직접 실행하세요. $setupUrl" }
        Say 'Docker Desktop을 시작합니다. 동의 화면이나 WSL2 안내가 나타나면 확인하세요.'
        Start-Process -FilePath $desktop -WindowStyle Hidden
        $deadline = (Get-Date).AddMinutes(3)
        do {
            Start-Sleep -Seconds 3
            $engineType = Engine
        } until ($engineType -or (Get-Date) -ge $deadline)
    }
    if ($engineType -ne 'linux') {
        throw 'Docker Linux 엔진이 준비되지 않았습니다. Docker Desktop에서 동의, WSL2, 가상화, 재부팅 안내를 확인하고 Linux 컨테이너를 선택하세요.'
    }

    $volumes = Docker @('volume','ls','--format','{{.Name}}')
    Check $volumes '기존 Docker 데이터 볼륨을 확인할 수 없습니다.'
    $usingLegacyName = $false
    if (-not $ProjectName) {
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            $hash = [BitConverter]::ToString($sha.ComputeHash($utf8.GetBytes($PSScriptRoot.ToLowerInvariant())))
        } finally { $sha.Dispose() }
        $ProjectName = 'seoulmetro-news-' + $hash.Replace('-', '').Substring(0, 16).ToLowerInvariant()
        $legacy = ((Split-Path -Leaf $PSScriptRoot).ToLowerInvariant() -replace '[^a-z0-9_-]', '') -replace '^[-_]+', ''
        if ($legacy -and $volumes.Lines -contains ($legacy + '_mysql_data')) {
            if ($volumes.Lines -contains ($ProjectName + '_mysql_data')) {
                throw '이 폴더에 해당하는 MySQL 볼륨이 두 개 있습니다. 전산 담당자에게 프로젝트 확인을 요청하세요.'
            }
            $ProjectName = $legacy
            $usingLegacyName = $true
            Say '이 폴더 이름으로 만든 기존 MySQL 볼륨을 확인했습니다.'
        }
    }

    $containers = Docker @('ps','-aq','--filter',"label=com.docker.compose.project=$ProjectName")
    Check $containers '현재 프로젝트의 컨테이너 상태를 확인할 수 없습니다.'
    $details = @()
    if ($containers.Lines.Count) {
        $inspection = Docker (@('inspect','--type','container','--format','{{json .Config.Labels}}|{{.State.Status}}|{{.Id}}') + $containers.Lines)
        Check $inspection '현재 프로젝트의 컨테이너 소유권을 확인할 수 없습니다.'
        $details = $inspection.Lines
    }
    if ($usingLegacyName -and -not $details -and (Test-Path -LiteralPath $envPath) -and $Action -ne 'Stop') {
        throw '같은 이름의 기존 MySQL 볼륨을 찾았지만 설치 폴더를 확인할 수 없습니다. 전산 담당자가 볼륨을 확인한 뒤 -ProjectName을 지정해야 합니다.'
    }
    $knownServices = @('frontend','crawler-worker','crawler-proxy','backend','db','ollama')
    $runningIds = @()
    foreach ($line in $details) {
        $json, $state, $id = $line -split '\|', 3
        $labels = $json | ConvertFrom-Json
        $owner = $labels.'com.docker.compose.project.working_dir'
        $service = $labels.'com.docker.compose.service'
        if ($owner.Replace('/', '\').TrimEnd('\') -ne $PSScriptRoot.TrimEnd('\')) {
            throw '같은 이름의 Docker 프로젝트가 다른 폴더에 있습니다. 원래 폴더에서 실행하거나 전산 담당자에게 문의하세요.'
        }
        if ($state -in @('running','restarting') -and $service -in $knownServices) { $runningIds += $id }
    }
    if ($Action -eq 'Stop') {
        if ($runningIds.Count) {
            Say '프로젝트 서비스를 종료하고 있습니다.'
            Check (Docker (@('stop','--time','30') + $runningIds)) '일부 서비스를 종료하지 못했습니다. Docker Desktop에서 상태를 확인하세요.'
        }
        Say '프로그램이 종료되었습니다. 기사 데이터와 AI 모델이 보존됩니다.'
        return
    }

    if (-not (Test-Path -LiteralPath $envPath)) {
        if ($volumes.Lines -contains ($ProjectName + '_mysql_data')) {
            throw '기존 MySQL 볼륨에 연결할 설정 파일이 없습니다. 최초 설치 당시의 .env.docker를 복원하세요.'
        }
        if ($Action -ne 'Install') { throw '처음 사용하려면 Install.bat을 실행하세요.' }
        $template = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '.env.docker.example'))
        $template = $template.Replace('DOCKER_DB_PASSWORD=CHANGE_ME', "DOCKER_DB_PASSWORD=$(New-Password)")
        $template = $template.Replace('DOCKER_MYSQL_ROOT_PASSWORD=CHANGE_ME', "DOCKER_MYSQL_ROOT_PASSWORD=$(New-Password)")
        $pending = "$envPath.pending-$PID"
        try {
            [IO.File]::WriteAllText($pending, $template, $utf8)
            [IO.File]::Move($pending, $envPath)
        } finally { [IO.File]::Delete($pending) }
        Say '새 설치용 DB 계정 설정을 생성했습니다.'
    }

    foreach ($key in @('DOCKER_DB_USER','DOCKER_DB_PASSWORD','DOCKER_MYSQL_ROOT_PASSWORD','CRAWLER_PROVIDER',
        'FRONTEND_PORT','FRONTEND_BIND','CRAWLER_PROXY_PORT')) {
        [Environment]::SetEnvironmentVariable($key, $null, 'Process')
    }
    $composeArgs = @('compose','--project-name',$ProjectName,'--project-directory',$PSScriptRoot,'--env-file',$envPath,'-f','compose.yaml')
    $config = Compose @('config','--format','json')
    Check $config '.env.docker의 DB 사용자, 비밀번호 및 포트 설정을 확인하세요.'
    try { $services = ($config.Lines -join [Environment]::NewLine | ConvertFrom-Json).services }
    catch { throw 'Docker Compose 설정을 읽을 수 없습니다. Docker Desktop을 업데이트하세요.' }
    foreach ($key in @('MYSQL_USER','MYSQL_PASSWORD','MYSQL_ROOT_PASSWORD')) {
        $value = $services.db.environment.$key
        if ([string]::IsNullOrWhiteSpace($value) -or $value -eq 'CHANGE_ME') {
            throw 'DB 계정 정보를 확인하세요. 기존 DB가 있으면 최초 설치 때 사용한 설정을 복원해야 합니다.'
        }
    }
    $provider = $services.backend.environment.CRAWLER_PROVIDER
    if ($provider -cnotin @('google','naver','none')) { throw 'CRAWLER_PROVIDER는 google, naver, none 중 하나여야 합니다.' }
    if ($provider -eq 'naver') {
        foreach ($key in @('NAVER_CLIENT_ID','NAVER_CLIENT_SECRET')) {
            $value = $services.'crawler-proxy'.environment.$key
            if ([string]::IsNullOrWhiteSpace($value) -or $value -eq "YOUR_$key") {
                throw "네이버 수집을 사용하려면 .env.docker에 $key 값을 입력하세요. Google 수집은 CRAWLER_PROVIDER=google을 선택하세요."
            }
        }
    }
    if (-not $services.backend.environment.NTFY_TOPIC) { Say '모바일 알림은 ntfy 토픽을 설정한 뒤 사용할 수 있습니다.' }

    $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    $webPort = [int]$services.frontend.ports[0].published
    $proxyPort = [int]$services.'crawler-proxy'.ports[0].published
    if ($webPort -eq $proxyPort) { throw '웹과 크롤러의 포트 번호를 서로 다르게 설정하세요.' }
    foreach ($mapping in @(@('frontend',80,$webPort), @('crawler-proxy',3001,$proxyPort))) {
        $port = $mapping[2]
        if ($port -lt 1 -or $port -gt 65535) { throw '.env.docker에 1~65535 범위의 포트를 설정하세요.' }
        if ($listeners.Port -notcontains $port) { continue }
        $current = Compose @('port',$mapping[0],[string]$mapping[1])
        if ($current.Code -ne 0 -or ($current.Lines -join '') -notmatch ":$port$") {
            throw "$port 포트를 다른 프로그램이 사용 중입니다. 해당 프로그램을 종료하거나 전산 담당자에게 문의하세요."
        }
    }

    $gpu = $false
    if ($Mode -ne 'CPU' -and (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue)) {
        $ErrorActionPreference = 'Continue'
        & nvidia-smi.exe -L *> $null
        $gpu = $LASTEXITCODE -eq 0
        $ErrorActionPreference = 'Stop'
    }
    if ($Mode -eq 'GPU' -and -not $gpu) { throw 'NVIDIA GPU 또는 호환 드라이버를 사용할 수 없습니다. CPU 모드를 사용하거나 드라이버를 확인하세요.' }

    Say 'MySQL과 Ollama를 준비하고 있습니다. 첫 실행에는 이미지 다운로드가 필요할 수 있습니다.'
    foreach ($image in @($services.db.image, $services.ollama.image)) {
        if ((Docker @('image','inspect',$image)).Code -ne 0) {
            Say "Docker 이미지를 내려받고 있습니다. $image"
            Check (Docker @('pull',$image)) "Docker 이미지를 내려받지 못했습니다. 인터넷 연결 및 디스크 공간을 확인하세요. $image"
        }
    }
    if ($gpu) {
        $cpuArgs = $composeArgs
        $composeArgs += @('-f','compose.gpu.yaml')
        $result = Compose @('up','-d','--wait','--wait-timeout','90','--no-build','--pull','never','ollama')
        if ($result.Code -ne 0) {
            if ($Mode -eq 'GPU') { Check $result 'Docker GPU 모드로 Ollama를 시작하지 못했습니다. WSL2와 NVIDIA 드라이버를 확인하세요.' }
            Say 'Docker에서 GPU 모드로 시작하지 못해 CPU로 전환합니다.'
            $composeArgs = $cpuArgs
            $gpu = $false
        }
    }
    $selectedMode = if ($gpu) { 'NVIDIA GPU' } else { 'CPU' }
    $verified = Join-Path $logs "$ProjectName-verified-mode.txt"
    $previousMode = if (Test-Path -LiteralPath $verified) { [IO.File]::ReadAllText($verified) }
    $checkAi = $Action -in @('Install','Update') -or $previousMode -ne $selectedMode
    if ($checkAi) { [IO.File]::Delete($verified) }
    Say "AI 실행 모드 $selectedMode"
    Check (Compose @('up','-d','--wait','--wait-timeout','240','--no-build','--pull','never','db','ollama')) 'MySQL 또는 Ollama가 준비되지 않았습니다. DB 설정과 Docker 디스크 공간을 확인하세요.'
    foreach ($model in @('qwen3:8b','bge-m3:latest')) {
        if ((Compose @('exec','-T','ollama','ollama','show',$model)).Code -eq 0) {
            Say "기존 AI 모델을 사용합니다. $model"
            continue
        }
        Say "AI 모델을 내려받고 있습니다. $model"
        Check (Compose @('exec','-T','ollama','ollama','pull',$model)) "모델 다운로드에 실패했습니다. 인터넷 연결 및 디스크 공간을 확인하세요. $model"
    }

    $build = '--no-build'
    if ($Action -in @('Install','Update')) {
        $build = '--build'
        Say '프로그램 이미지를 준비하고 있습니다. 첫 실행에는 시간이 걸릴 수 있습니다.'
    }
    Say '웹 화면, 기사 수집 및 분석 서비스를 시작하고 있습니다.'
    Check (Compose @('up','-d',$build,'--pull','never','--wait','--wait-timeout','180')) '서비스를 시작하지 못했습니다. 처음이라면 Install.bat을 실행하세요. 포트와 Docker Desktop 상태도 확인하세요.'
    $url = "http://localhost:$webPort"
    Wait-Web $url
    if ($checkAi) {
        Say 'AI 생성 및 임베딩 응답을 확인하고 있습니다.'
        $timer = [Diagnostics.Stopwatch]::StartNew()
        $result = Compose @('exec','-T','backend','node','/app/verify-ollama.js')
        Say "AI 응답 검사에 $([math]::Round($timer.Elapsed.TotalSeconds, 1))초가 걸렸습니다."
        Check $result 'AI 응답 검사에 실패했습니다. Docker 메모리 및 GPU 설정을 확인한 뒤 Install.bat을 다시 실행하세요.'
        [IO.File]::WriteAllText($verified, $selectedMode, $utf8)
    }
    Say "프로그램이 준비되었습니다. $url"
    if (-not $NoBrowser) {
        try { Start-Process -FilePath $url } catch { Say "기본 브라우저를 열 수 없습니다. 주소를 직접 여세요. $url" }
    }
} catch {
    $message = $_.Exception.Message
    if ($_.FullyQualifiedErrorId -ne $message) {
        $message = "실행 중 오류가 발생했습니다. 오류 종류 $($_.Exception.GetType().Name). 사용설명서 또는 설정을 확인하세요."
    }
    Say $message
    if ($log) { Write-Host '진행 기록은 system 또는 실행 파일 폴더 안의 logs에 있습니다.' }
    $exitCode = 1
} finally {
    if ($lock) { $lock.Dispose() }
}
exit $exitCode
