# Docker 설치 및 실행 매뉴얼

## 1. 개요

본 프로젝트는 Docker Compose를 이용하여 뉴스 수집 및 AI 분석 시스템을 실행합니다.

Docker를 사용하므로 Node.js, MySQL 등을 PC에 별도로 설치할 필요가 없습니다.

본 매뉴얼은 **최초 설치, 일상적인 실행, 서비스 종료, 재실행 및 문제 해결 방법**을 안내합니다.

## 2. 실행 환경

### 필수 환경

- Windows 10/11
- Docker Desktop
- NVIDIA GPU 및 호환 드라이버
- 인터넷 연결
- 프로젝트 소스 코드 및 Docker 설정 파일

현재 패키지는 NVIDIA GPU가 있는 Windows 데스크톱 환경을 기준으로 구성되어 있습니다.

Intel 내장 GPU 등 다른 GPU 환경에서의 실행은 지원하지 않습니다.

최초 실행 시 Docker 이미지와 AI 모델을 다운로드하므로 충분한 저장 공간과 인터넷 연결이 필요합니다.

## 3. 최초 설치 방법

### 3.1. Docker Desktop 설치

1. [Docker 공식 홈페이지](https://www.docker.com/products/docker-desktop/)에서 Docker Desktop을 다운로드합니다.
2. 설치 안내에 따라 Docker Desktop을 설치합니다.
3. 설치 과정에서 요구하는 WSL2 관련 설정을 완료합니다.
4. 필요하다면 PC를 재부팅합니다.
5. Docker Desktop을 실행합니다.
6. Docker 엔진이 정상적으로 실행되는지 확인합니다.

NVIDIA GPU를 Docker에서 사용하려면 호환 드라이버와 WSL2 GPU 지원 환경이 필요합니다.

### 3.2. 프로젝트 준비

프로젝트 폴더를 준비합니다.

다음 파일 및 폴더가 포함되어 있어야 합니다.

| 파일 또는 폴더 | 용도 |
|---|---|
| `compose.yaml` | Docker 서비스 기본 구성 |
| `compose.gpu.yaml` | NVIDIA GPU 설정 |
| `start.ps1` | 실행 자동화 스크립트 |
| `.env.docker.example` | 환경변수 예제 |
| `backend/` | 백엔드 및 프론트엔드 |
| `test/Crawling/` | 크롤러 |
| `backend/sql/schema2.sql` | MySQL 초기 테이블 생성 |

### 3.3. 환경변수 설정

프로젝트 최상위 폴더의 `.env.docker.example` 파일을 복사하여 `.env.docker` 파일을 생성합니다.

PowerShell에서 다음 명령어를 사용할 수 있습니다.

```powershell
Copy-Item .env.docker.example .env.docker
notepad .env.docker
```

다음 항목에 실제 설정값을 입력합니다.

| 환경변수 | 설명 |
|---|---|
| `DOCKER_DB_USER` | MySQL 사용자 이름 |
| `DOCKER_DB_PASSWORD` | MySQL 사용자 비밀번호 |
| `DOCKER_MYSQL_ROOT_PASSWORD` | MySQL 관리자 비밀번호 |
| `NAVER_CLIENT_ID` | 네이버 API 클라이언트 ID |
| `NAVER_CLIENT_SECRET` | 네이버 API 클라이언트 Secret |

`CHANGE_ME`, `YOUR_NAVER_CLIENT_ID` 등의 예제 값을 실제 값으로 변경해야 합니다.

**주의사항**

- `.env.docker`에는 실제 인증정보가 포함되므로 Git에 업로드하거나 외부에 공유하지 않습니다.
- 기존 MySQL 데이터 볼륨을 재사용한다면 최초 DB 생성 당시 사용한 계정정보와 일치해야 합니다.
- 최초 설치 후에는 일반적으로 환경변수 파일을 다시 작성할 필요가 없습니다.

## 4. 최초 실행 방법

### 4.1. Docker Desktop 실행

Docker Desktop을 실행하고 Docker 엔진이 준비될 때까지 기다립니다.

### 4.2. PowerShell 실행

프로젝트 최상위 폴더에서 PowerShell을 엽니다.

해당 폴더의 파일 탐색기 주소창에 `powershell`을 입력하여 실행할 수도 있습니다.

### 4.3. 실행 스크립트 실행

다음 명령어를 입력합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

스크립트는 다음 작업을 자동으로 수행합니다.

1. Docker 설치 및 실행 상태 확인
2. NVIDIA GPU 확인
3. `.env.docker` 파일 및 Docker Compose 설정 검증
4. Docker 이미지 빌드
5. MySQL, 백엔드, 프론트엔드, 크롤러, Ollama 컨테이너 실행
6. Qwen3 8B, BGE-M3 모델 확인 및 필요시 다운로드
7. 실행된 서비스 상태 출력

최초 실행 시 Docker 이미지 빌드와 AI 모델 다운로드에 시간이 소요될 수 있습니다.

다음 메시지가 출력되면 실행 스크립트가 정상적으로 완료된 것입니다.

```text
Startup completed.
Web: http://localhost:8080
```

이후 웹페이지 접속 및 주요 기능을 확인합니다.

## 5. 최초 설치 이후 재실행 방법

**일반적으로 PC를 켤 때마다 필요한 절차입니다.**

최초 설치를 완료했다면 Docker, MySQL, Node.js, AI 모델을 다시 설치할 필요가 없습니다.

### 5.1. Docker Desktop 실행

Docker Desktop을 실행하고 Docker 엔진이 준비될 때까지 기다립니다.

### 5.2. 프로젝트 폴더에서 PowerShell 실행

프로젝트 최상위 폴더를 열고 PowerShell을 실행합니다.

### 5.3. 시작 명령어 입력

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

이미 생성된 Docker 이미지와 다운로드된 AI 모델은 재사용됩니다.

현재 스크립트는 실행할 때마다 Docker 이미지 빌드를 요청하지만, 변경 사항이 없다면 Docker 빌드 캐시를 재사용합니다.

### 5.4. 웹페이지 접속

브라우저에서 다음 주소를 입력합니다.

```text
http://localhost:8080
```

### 재실행 절차 요약

**Docker Desktop 실행 → 프로젝트 폴더에서 `start.ps1` 실행 → 웹페이지 접속**

매번 환경변수를 다시 설정하거나 AI 모델을 다운로드할 필요는 없습니다.

## 6. 모바일 및 다른 PC에서 접속

같은 네트워크에 연결된 다른 기기에서도 웹페이지에 접속할 수 있습니다.

### 6.1. 서버 PC의 IP 주소 확인

서버 PC에서 PowerShell을 실행하고 다음 명령어를 입력합니다.

```powershell
ipconfig
```

현재 사용 중인 네트워크 어댑터의 IPv4 주소를 확인합니다.

### 6.2. 모바일 접속

모바일 기기를 서버 PC와 동일한 Wi-Fi 또는 접근 가능한 내부 네트워크에 연결합니다.

브라우저에서 다음 주소로 접속합니다.

```text
http://서버PC의_IP주소:8080
```

예를 들어 서버 PC의 IP 주소가 `192.168.0.10`이라면 다음 주소를 사용합니다.

```text
http://192.168.0.10:8080
```

접속되지 않는다면 Windows 방화벽, 네트워크 연결 상태 및 서버 PC의 IP 주소를 확인합니다.

**현재 설정은 내부 네트워크 접속을 전제로 하며, 인터넷에 직접 공개하는 용도로 구성되지 않았습니다.**

## 7. 서비스 종료 방법

### 7.1. 일반적인 종료

프로젝트 폴더에서 PowerShell을 열고 다음 명령어를 실행합니다.

```powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.gpu.yaml down
```

이 명령어는 실행 중인 컨테이너와 관련 네트워크를 종료 및 제거합니다.

MySQL 데이터와 AI 모델이 저장된 Docker 볼륨은 유지됩니다.

### 7.2. 데이터 삭제 주의

다음 명령어는 사용하지 않도록 주의해야 합니다.

```powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.gpu.yaml down -v
```

`-v` 옵션은 프로젝트의 Docker 볼륨까지 제거할 수 있으므로 DB 데이터와 AI 모델이 삭제될 수 있습니다.

## 8. 데이터 보존

프로젝트는 Docker 볼륨을 사용하여 데이터를 보존합니다.

| 볼륨 | 저장 데이터 |
|---|---|
| `mysql_data` | 기사, 클러스터, 분석 결과 등 |
| `ollama_data` | Qwen3 8B, BGE-M3 모델 |

컨테이너를 종료하거나 재생성해도 동일한 볼륨을 사용하면 데이터가 유지됩니다.

실제 테스트에서 컨테이너 제거 및 재생성 후 MySQL 테이블과 기사 115건이 존재하고, 두 AI 모델이 재다운로드 없이 인식되는 것을 확인했습니다.

단, 다른 PC로 프로젝트 폴더만 복사하면 Docker 볼륨 데이터까지 자동으로 이전되지는 않습니다.

기존 데이터를 다른 PC로 이전하려면 별도의 백업 및 복원 절차가 필요합니다.

## 9. 문제 해결

### 9.1. Docker 연결 오류

대표적인 오류 메시지는 다음과 같습니다.

```text
failed to connect to the docker API
```

Docker Desktop이 실행되지 않았거나 Docker 엔진이 준비되지 않았을 수 있습니다.

Docker Desktop을 실행하고 엔진이 준비된 뒤 다시 시도합니다.

### 9.2. NVIDIA GPU 오류

NVIDIA GPU가 감지되지 않는 경우 다음 사항을 확인합니다.

- NVIDIA 그래픽 드라이버 설치 여부
- Docker Desktop의 WSL2 기반 실행 환경
- NVIDIA GPU의 정상 작동 여부

PowerShell에서 다음 명령어로 GPU 상태를 확인할 수 있습니다.

```powershell
nvidia-smi
```

### 9.3. 환경변수 오류

다음과 같은 오류가 발생할 수 있습니다.

```text
required variable DOCKER_DB_PASSWORD is missing
```

`.env.docker` 파일이 존재하는지 확인합니다.

파일이 있다면 필요한 환경변수가 모두 설정되어 있는지 확인합니다.

### 9.4. 웹페이지 접속 실패

다음 사항을 확인합니다.

1. Docker 컨테이너가 실행 중인지 확인합니다.
2. `start.ps1` 실행 중 오류가 발생하지 않았는지 확인합니다.
3. `http://localhost:8080` 주소가 올바른지 확인합니다.
4. 다른 프로그램에서 8080 포트를 사용하고 있는지 확인합니다.

서비스 상태는 다음 명령어로 확인할 수 있습니다.

```powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.gpu.yaml ps
```

### 9.5. AI 모델 관련 오류

AI 모델이 정상적으로 설치되어 있는지 확인하려면 다음 명령어를 실행합니다.

```powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.gpu.yaml exec ollama ollama list
```

모델 목록에 `qwen3:8b`와 `bge-m3`가 표시되어야 합니다.

### 9.6. 모바일 접속 실패

다음 사항을 확인합니다.

- 서버 PC와 모바일 기기가 접근 가능한 동일 네트워크에 연결되어 있는지 확인합니다.
- 서버 PC의 IPv4 주소가 올바른지 확인합니다.
- Windows 방화벽에서 8080 포트의 접근이 차단되어 있는지 확인합니다.
- 서버 PC에서 웹페이지가 정상적으로 열리는지 먼저 확인합니다.

## 10. 운영 시 주의사항

1. 서비스를 사용하려면 서버 PC가 켜져 있어야 합니다.
2. Docker Desktop과 필요한 컨테이너가 실행 중이어야 합니다.
3. 서버 PC가 절전 모드로 전환되면 서비스가 중단될 수 있습니다.
4. `.env.docker` 파일의 인증정보를 외부에 공개하지 않습니다.
5. 데이터 손실에 대비하려면 Docker 볼륨과 별개로 정기적인 DB 백업이 필요합니다.
6. 현재 구성은 NVIDIA GPU 기반 로컬 서버 운영을 기준으로 합니다.

## 11. 빠른 실행 요약

### 처음 설치할 때

1. Docker Desktop과 NVIDIA GPU 실행 환경을 준비합니다.
2. 프로젝트 폴더를 준비합니다.
3. `.env.docker.example`을 복사하여 `.env.docker`를 작성합니다.
4. Docker Desktop을 실행합니다.
5. `start.ps1`을 실행합니다.
6. 웹페이지에 접속합니다.

### 평소 다시 실행할 때

1. Docker Desktop을 실행합니다.
2. 프로젝트 폴더에서 PowerShell을 엽니다.
3. 다음 명령어를 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

4. `http://localhost:8080`에 접속합니다.

### 종료할 때

```powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.gpu.yaml down
```

**종료 후 다시 실행해도 기존 DB 데이터와 AI 모델은 유지됩니다.**