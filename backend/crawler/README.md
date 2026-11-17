# 구글 뉴스 크롤러 + 모바일 알림(ntfy)

네이버 검색 API 크롤러를 대체하는 **구글 뉴스 RSS 크롤러**와, 위험 기사를 휴대폰으로 알려주는 **ntfy 알림** 기능입니다. 추가 npm 패키지는 필요 없습니다(Node 18+).

## 실행 (한 번에)

```bash
cd backend
npm run dev
```

- 백엔드 서버와 프론트 화면이 한 창에서 같이 켜지고, 브라우저(http://localhost:5173)가 자동으로 열립니다.
- 처음 실행이면 `npm install`을 자동으로 합니다.
- 종료는 `Ctrl + C`입니다. 서버와 화면이 둘 다 꺼집니다.
- **MySQL과 Ollama**는 따로 켜져 있어야 "저장 + AI 분석"이 동작합니다. 뉴스 수집 미리보기와 테스트 알림은 없어도 동작합니다.

| 명령 | 설명 |
|---|---|
| `npm run dev` | 서버 + 화면 같이 실행 (개발용) |
| `npm start` | 서버만 실행 |
| `npm run crawl -- "서울교통공사" --dry-run --out out.json` | 화면 없이 크롤링만 해서 결과를 파일로 저장 |
| `npm run notify:test` | 휴대폰 테스트 알림 (서버 없이 가능) |
| `npm test` | 크롤러/알림 테스트 (네트워크, DB 불필요) |

## 화면

상단 메뉴에 두 화면이 추가됐습니다.

- **뉴스 수집**
  - 키워드, 기간, 기사 수를 정하고 실행 방식을 고릅니다. 미리보기는 DB에 저장하지 않고, 저장 + AI 분석은 DB에 저장한 뒤 분석까지 합니다.
  - 진행률이 실시간으로 보이고, 기사 상세에서 전문, 기자, 요약, 키워드를 볼 수 있습니다. 자동 수집도 이 화면에서 켜고 끕니다.
- **모바일 알림**
  - ntfy 연결 상태와 설정 방법을 보여 주고, 테스트 알림을 보낼 수 있습니다.

## 설정 (backend/.env)

`backend/.env.example`을 복사해 `.env`를 만들고 필요한 값만 채우세요.

```ini
NTFY_TOPIC=comgongijo-risk-8f3k2    # 휴대폰 ntfy 앱에서 같은 이름을 구독
CRAWL_KEYWORDS=서울교통공사          # (선택) 넣으면 서버 시작 시 자동 수집
CRAWL_INTERVAL_SEC=600              # (선택) 자동 수집 간격, 최소 300
```

### 휴대폰 알림 받기
1. 휴대폰에 **ntfy** 앱을 설치합니다 (Play 스토어 / App Store).
2. 앱에서 **+** 버튼을 누르고, `.env`의 `NTFY_TOPIC`과 **똑같은 이름**을 입력한 뒤 **Subscribe**를 누릅니다.
3. 서버를 다시 실행하고, **모바일 알림** 화면에서 **테스트 알림 보내기**를 누릅니다.

- 토픽 이름을 아는 사람은 누구나 알림을 볼 수 있으니 추측하기 어렵게 정하세요.
- 같은 토픽을 구독하면 팀원 모두가 같은 알림을 받습니다.

## 동작 흐름

```
구글 뉴스 RSS ─▶ 원문 URL 변환 ─▶ 언론사 원문 크롤링 ─▶ POST /api/articles
                                                       │
                     (기존) 분석 작업자: AI 위험도 분석 → 클러스터링
                                                       │
            위험도 0.6 이상 & 클러스터 첫 알림 → alerts 저장 → ntfy 발송 (alert_status: sent/failed)
```

## 파일 구성

| 파일 | 역할 |
|---|---|
| `crawler/googleNewsRss.js` | RSS 조회/파싱. 제목에서 " - 언론사" 분리, 관련 기사 추출 |
| `crawler/googleNewsDecoder.js` | 구글 뉴스 링크(`news.google.com/rss/articles/CBMi...`) → 실제 기사 URL |
| `crawler/articleExtractor.js` | 원문 HTML → 본문/기자/요약/발행일/키워드/이미지 (EUC-KR 자동 처리) |
| `crawler/httpClient.js` | 타임아웃, 재시도, 문자셋 판별 |
| `crawler/index.js` | 수집 전체 흐름 + CLI |
| `services/crawlerService.js`, `routes/crawlerRoutes.js` | 화면용 수집 API (실시간 진행상황 SSE, 자동 수집) |
| `services/notifyService.js`, `routes/notifyRoutes.js` | ntfy 발송, 상태/테스트 API |
| `services/alertService.js` | 알림 생성 시 `notifyRiskAlert` 호출 (추가된 부분) |
| `scripts/dev.js` | `npm run dev` (서버 + 화면 동시 실행) |
| `frontend/src/pages/CrawlerPage.jsx`, `NotifySettingsPage.jsx` | 화면 |

### API
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/crawler/stream?keywords=a,b&when=1d&limit=10&dryRun=1` | 수집 실행 + 진행상황(SSE) |
| POST | `/api/crawler/stop` | 수집 중지 |
| GET | `/api/crawler/status` | 실행 중 여부, 자동 수집 상태 |
| POST / DELETE | `/api/crawler/schedule` | 자동 수집 시작 / 중지 |
| GET | `/api/notify/status` | ntfy 설정 상태 |
| POST | `/api/notify/test` | 테스트 알림 발송 |

## 수집 정보와 주의사항

- **수집 필드:** 제목, 언론사, 발행일, 원문 URL, 기사 전문, 요약문(언론사 제공 요약 → 없으면 본문 앞 3문장), 기자명·이메일, 분류, 키워드, 대표 이미지, 같은 사건의 관련 기사.
  - 현재 DB에는 `title, content, url, source, author, published_at`만 저장됩니다.
- **원문 URL 변환:** 구글의 비공식 내부 API를 사용합니다. 구글이 바꾸면 실패할 수 있고, 실패하면 RSS 정보만 저장합니다(`crawl_status: rss_only`).
- **요청 간격:** 너무 빠르게 요청하면 구글이 막습니다(429). 기사 간 간격(`CRAWL_DELAY_MS`, 기본 1500ms)을 줄이지 마세요.
- **본문이 안 잡히는 언론사:** `crawler/articleExtractor.js`의 `BODY_SELECTORS`에 추가하세요.
