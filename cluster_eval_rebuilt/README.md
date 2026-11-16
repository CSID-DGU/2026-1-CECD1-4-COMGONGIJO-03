# Docker Compose 기사 100건 반복 평가

프로젝트 루트에 `cluster_eval_rebuilt/` 폴더와 `compose.eval.yaml`을 복사하고, 빈 `cluster_eval_results/` 폴더를 만드십시오. `.env.docker`는 기존 프로젝트에만 보관하십시오. 아래 명령은 **PowerShell에서 프로젝트 루트** 기준입니다.

> 주의: 테스트 데이터에 포함된 `expected_related`, `expected_event`는 아직 인간 검증을 거치지 않은 임시 라벨입니다. 출력 정확도/F1은 잠정 수치입니다. 기사 100건의 `published_at`도 모두 null입니다.

먼저 기존 Docker 서비스에서 DB와 Ollama가 실행 중이어야 합니다. 기존 Compose의 환경변수 보간을 위해 모든 명령에 `--env-file .env.docker`를 사용합니다.

```powershell
docker compose --env-file .env.docker up -d db ollama
```

## 최초 한 번만 실행

```powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.eval.yaml --profile eval run --rm -e ALLOW_TEST_DB_CREATE=YES eval /eval/create_test_db.js
docker compose --env-file .env.docker -f compose.yaml -f compose.eval.yaml --profile eval run --rm eval /eval/prepare_test_data.js /eval/test_cases.json
```

`create_test_db.js`는 이미 존재하는 `news_test_db`를 덮어쓰지 않습니다. 생성 중 오류가 발생하여 DB가 부분적으로 생성되면 수동 점검이 필요합니다. 생성 시 root 계정으로 스키마를 생성하고 기존 애플리케이션 사용자에게 **테스트 DB에만** 권한을 부여합니다.

## 반복 평가

```powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.eval.yaml --profile eval run --rm eval /eval/run_eval.js /eval/test_cases.json
```

결과는 호스트의 `cluster_eval_results/evaluation_날짜.json`에 실행별로 별도 저장합니다. 평가 프로세스는 `DB_NAME=news_test_db`를 시작 시점부터 사용하며, 기존 서버나 크롤러를 실행하지 않습니다. 평가 워커는 `news_test_db`만 조회합니다. 분석 결과와 클러스터, 연결, 알림만 삭제하고 원본 기사는 보존합니다.

기존 백엔드가 별도로 `news_db`를 사용하면서 실행 중이어도 테스트 데이터에 개입하지 않습니다. 단, 두 작업이 동시에 Ollama/GPU를 사용하면 성능 측정 시간이 왜곡될 수 있으므로 정확한 속도 비교를 위해서는 운영 분석 부하를 피하십시오.

## 실행 전 확인

- Ollama에 백엔드 `analyzeArticle.js`에서 지정한 `qwen3:8b` 모델이 설치되어 있어야 합니다.
- 기존 임베딩 서비스도 연결되어 있어야 합니다. `host.docker.internal` 연결이 필요한 경우 평가 서비스에도 `extra_hosts`를 추가해야 할 수 있습니다.
- `news_test_db`가 이미 있으면 생성 명령을 재실행하지 마십시오.
- `cluster_eval_results`는 Git에 올리지 않는 것이 좋습니다.
- 코드 문법 검사와 실제 Docker + MySQL + Ollama 통합 실행 검증은 별도입니다.
