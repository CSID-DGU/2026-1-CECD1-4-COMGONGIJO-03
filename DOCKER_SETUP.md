# Windows 실행 및 배포

사용자에게는 `release/SeoulMetro-NewsAI-Windows.zip`을 전달합니다. ZIP의 사용설명서는 [사용설명서.txt](사용설명서.txt)입니다.

## 실행

팀원은 기존 작업 폴더를 유지한 채 GitHub 브랜치를 별도 폴더에 복제할 수 있습니다.

```powershell
git clone --branch packaging/windows-launcher --single-branch https://github.com/CSID-DGU/2026-1-CECD1-4-COMGONGIJO-03.git SeoulMetro-NewsAI
Set-Location SeoulMetro-NewsAI
```

압축을 푼 폴더나 소스 작업 트리에서 최초 설치는 `Install.bat`, 일반 실행은 `Start.bat`, 종료는 `Stop.bat`을 더블클릭합니다. Windows PowerShell의 실행 정책은 해당 프로세스에서만 지정합니다. 설정 파일은 소스에서는 루트, 배포본에서는 `system` 아래에 생성됩니다.

개발자 명령은 `start.ps1`이 있는 폴더에서 실행합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Action Install -Mode CPU -NoBrowser
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Action Update -NoBrowser
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Action Stop
```

- `Install`은 신규 DB 비밀번호를 생성하고 이미지를 빌드한 뒤 웹과 AI를 검사합니다. 기존 환경 변수 파일은 읽기만 합니다.
- `Start`는 기존 앱 이미지를 사용하며, MySQL/Ollama 이미지 또는 모델이 없을 때만 가져옵니다. 정상 확인 기록이 없거나 CPU/GPU 모드가 바뀌면 AI 응답을 다시 검사합니다.
- `Update`는 기존 설치와 같은 경로에 배포 파일을 덮어쓴 후 사용합니다. 업데이트 전에 종료하고 DB를 백업하세요. `.env.docker`와 Docker 볼륨은 유지합니다. 팀의 스키마 변경이 포함된 릴리스는 별도의 마이그레이션이 필요할 수 있습니다.
- `Auto`는 NVIDIA 드라이버를 확인하고 Docker가 GPU 할당으로 Ollama를 시작할 수 있는지 봅니다. 할당 또는 시작 실패 시 CPU로 재시도합니다. `CPU`는 CPU를 강제하고 `GPU`는 GPU 시작 실패를 오류로 처리합니다.
- 설치 AI 검사는 짧은 `qwen3:8b` 생성과 `bge-m3:latest` 임베딩 요청입니다. 실제 기사 분석에는 더 긴 입력과 120초 요청 제한이 적용되므로 대표 기사로 성능을 별도로 확인합니다.
- 이 런처는 DB와 Ollama 준비 및 모델 확인 후 백엔드, 프론트엔드, 크롤러를 시작합니다. 기존 `server.js`가 분석 워커와 Google 예약 수집을 시작합니다. 기사 API와 React HTML 확인이 끝난 뒤 기본 브라우저를 엽니다.
- `Stop`은 해당 경로와 Compose 프로젝트 라벨을 모두 확인해 프로젝트 컨테이너를 중지합니다. 컨테이너, 이미지, DB 및 모델 볼륨은 보존됩니다. Docker 엔진이 이미 내려가 있으면 시작하지 않습니다.

## 기존 설치와 네트워크 설정

신규 프로젝트 이름은 `start.ps1` 폴더의 절대 경로로 결정됩니다. 같은 경로에서 실행하고 업데이트해야 동일한 Docker 볼륨을 사용합니다. 설치된 폴더 이동 및 다른 PC 이전에는 DB 백업과 복원이 필요합니다. 기존 Compose가 해당 폴더의 기본 프로젝트 이름으로 만든 MySQL 볼륨은 자동으로 감지합니다. 기존 컨테이너가 이미 제거되었거나 사용자 지정 프로젝트를 썼다면 실제 볼륨과 경로를 먼저 확인하고 모든 작업에 동일한 `-ProjectName`을 지정합니다. 설정을 잃어버렸다면 원래 DB 자격 증명을 복원해야 합니다.

신규 설치의 Google 수집은 키가 필요 없습니다. 기존 네이버 설정은 `CRAWLER_PROVIDER=naver`와 두 자격 증명을 사용합니다. ntfy는 조직의 서버와 토픽 및 필요 시 토큰을 설정합니다. 새 설치의 `CRAWL_KEYWORDS`와 `NTFY_TOPIC`은 비어 있습니다.

신규 설치의 웹은 이 PC의 `localhost:8080`에서 열리고 네이버 프록시는 로컬 `3001`을 사용합니다. 기존 파일에 `FRONTEND_BIND` 설정이 없으면 기존 Compose의 웹 내부망 접속 동작을 유지합니다. 충돌 시 `FRONTEND_PORT` 또는 `CRAWLER_PROXY_PORT`를 변경하세요. 모바일에서 기사 링크까지 열려면 조직에서 승인한 HTTPS 프록시와 접근 제어를 준비하고 `DASHBOARD_URL`을 설정합니다. Windows 호스트의 프록시는 루프백을 사용합니다. 별도의 내부망 바인딩이 승인된 환경에서는 `FRONTEND_BIND=0.0.0.0`을 설정할 수 있습니다.

Docker Desktop이 없으면 공식 설치 안내로 연결합니다. 사내 사용 라이선스, WSL2 활성화, 가상화 설정 및 재부팅은 전산 담당자와 확인합니다. [Docker 공식 Windows 설치 안내](https://docs.docker.com/desktop/setup/install/windows-install/)

로그는 `logs`에 단계, 종료 코드, AI 응답 검사 시간 등으로 저장됩니다. Compose 출력과 컨테이너 로그에는 비밀 값이 들어갈 수 있어 런처 기록에서 생략됩니다.

## ZIP 다시 만들기

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\package-windows.ps1
```

팀원은 같은 커밋의 깨끗한 작업 폴더에서 위 명령을 실행해 `release/SeoulMetro-NewsAI-Windows.zip`을 만듭니다. ZIP의 파일 구성과 내용은 재현할 수 있으며, ZIP 엔트리 타임스탬프에 따라 파일 자체의 해시는 달라질 수 있습니다.

패키징 스크립트는 Git이 추적 중인 실행 소스의 허용 목록과 런처·설정 예제·사용설명서를 담습니다. 앱 의존성, 이미지, 모델은 최초 설치 시 내려받습니다. 패키징 전에 배포할 코드와 예제 설정을 검토하세요. ZIP은 필요할 때 생성하여 별도로 전달하고, Git에는 소스와 패키징 스크립트를 보관합니다. `release`는 Git에서 제외하는 로컬 생성물 폴더입니다.
