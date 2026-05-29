# News Risk Monitor Frontend

React + Vite 기반 프론트엔드입니다. AI/OpenAI/LLM API를 직접 호출하지 않고 백엔드 REST API만 사용합니다.

## 설치

```bash
cd frontend
npm install
```

PowerShell 실행 정책으로 `npm.ps1` 오류가 나면 아래처럼 실행하세요.

```bash
npm.cmd install
```

## 실행

백엔드:

```bash
cd ..
node server.js
```

프론트엔드:

```bash
cd frontend
npm.cmd run dev
```

기본 접속 주소는 `http://localhost:5173`입니다.

## API 주소 설정

`frontend/.env`

```env
VITE_API_BASE_URL=/api
```

개발 서버에서는 Vite proxy가 `/api` 요청을 백엔드로 전달합니다. proxy target의 포트는 `frontend/vite.config.js`에서 `../.env`의 `PORT` 값을 읽어 사용합니다. 현재 백엔드 `.env`의 `PORT=3306`이므로 개발 중 API proxy target은 `http://localhost:3306`입니다.

백엔드 `server.js`가 다른 포트에서 실행되도록 되어 있다면, 백엔드 `.env`의 `PORT` 값과 실제 Express listen 포트를 동일하게 맞춰야 합니다.

## 사용하는 백엔드 API

- `GET /api/articles`: 전체 기사 조회와 제목 검색
- `GET /api/articles/analyzed/list`: 분석 완료 기사 목록
- `GET /api/articles/risky/list`: 위험 기사 목록
- `GET /api/alerts`: 알림 목록
- `GET /api/articles/by-url/search?url=...`: URL 기반 기사 조회
- `POST /api/articles`: 기사 등록 및 백엔드 분석 요청
- `GET /api/articles/:article_id`: 목록에서 선택한 기사의 상세 정보 보강
