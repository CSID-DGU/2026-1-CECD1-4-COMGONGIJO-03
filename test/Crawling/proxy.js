// ──────────────────────────────────────────────────────────────
// proxy.js  —  네이버 뉴스 API 프록시 서버
//
// 사용법:
//   1. Node.js 설치 (https://nodejs.org)
//   2. 이 파일이 있는 폴더에서 터미널 열기
//   3. npm install express cors
//   4. NAVER_CLIENT_SECRET=여기에시크릿입력 node proxy.js
//      (Windows PowerShell: $env:NAVER_CLIENT_SECRET="시크릿"; node proxy.js)
//   5. 브라우저에서 naver_news_crawler.html 열기
// ──────────────────────────────────────────────────────────────
const express = require('express');
const cors    = require('cors');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── CORS 설정: 로컬 HTML 파일에서의 요청 허용 ──
app.use(cors({
  origin: '*',
  methods: ['GET'],
}));

// ── 상태 확인 엔드포인트 ──
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    endpoint: '/naver-news',
    port: PORT,
    time: new Date().toISOString(),
  });
});

// ── 네이버 뉴스 검색 프록시 ──
app.get('/naver-news', (req, res) => {
  const { query, display, sort, start, clientId } = req.query;

  // Client ID: 쿼리 파라미터 또는 환경변수
  const naverId     = clientId || process.env.NAVER_CLIENT_ID;
  const naverSecret = process.env.NAVER_CLIENT_SECRET;

  if (!naverId) {
    return res.status(400).json({
      error: 'Client ID가 필요합니다.',
      hint: '브라우저 입력란에 Client ID를 입력하거나 NAVER_CLIENT_ID 환경변수를 설정하세요.',
    });
  }

  if (!naverSecret || naverSecret === 'YOUR_CLIENT_SECRET_HERE') {
    return res.status(500).json({
      error: 'Client Secret이 설정되지 않았습니다.',
      hint: 'NAVER_CLIENT_SECRET=시크릿값 node proxy.js 로 실행하세요.',
    });
  }

  if (!query) {
    return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });
  }

  const params = new URLSearchParams({
    query  : query,
    display: display || '10',
    sort   : sort    || 'date',
    start  : start   || '1',
  });

  const options = {
    hostname: 'openapi.naver.com',
    path    : '/v1/search/news.json?' + params.toString(),
    method  : 'GET',
    headers : {
      'X-Naver-Client-Id'    : naverId,
      'X-Naver-Client-Secret': naverSecret,
      'Accept'               : 'application/json',
    },
  };

  console.log(`[${new Date().toLocaleTimeString()}] 요청: "${query}" (display=${display||10})`);

  const apiReq = https.request(options, apiRes => {
    let body = '';
    apiRes.on('data', chunk => { body += chunk; });
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        console.log(`[${new Date().toLocaleTimeString()}] 응답: ${apiRes.statusCode} — ${parsed.total || 0}건`);
        res.status(apiRes.statusCode).json(parsed);
      } catch(e) {
        console.error('파싱 실패:', body.slice(0, 200));
        res.status(500).json({ error: 'JSON 파싱 실패', raw: body.slice(0, 300) });
      }
    });
  });

  apiReq.on('error', err => {
    console.error('요청 오류:', err.message);
    res.status(500).json({ error: err.message });
  });

  apiReq.setTimeout(10000, () => {
    apiReq.destroy();
    res.status(504).json({ error: '네이버 API 응답 시간 초과' });
  });

  apiReq.end();
});

// ── 서버 시작 ──
app.listen(PORT, () => {
  const secret = process.env.NAVER_CLIENT_SECRET;
  const secretOk = secret && secret !== 'YOUR_CLIENT_SECRET_HERE';

  console.log('');
  console.log('────────────────────────────────────────────────');
  console.log('  🗞  네이버 뉴스 크롤러 — 프록시 서버');
  console.log('────────────────────────────────────────────────');
  console.log(`  ✅ 서버 실행 중: http://localhost:${PORT}`);
  console.log(`  📡 API 엔드포인트: http://localhost:${PORT}/naver-news`);
  console.log('────────────────────────────────────────────────');
  console.log(`  Client Secret: ${secretOk ? '✅ 설정됨' : '❌ 미설정 (NAVER_CLIENT_SECRET 환경변수 필요)'}`);
  console.log('');
  if (!secretOk) {
    console.log('  ⚠️  Client Secret 설정 방법:');
    console.log('  Mac/Linux: NAVER_CLIENT_SECRET=시크릿 node proxy.js');
    console.log('  Windows  : set NAVER_CLIENT_SECRET=시크릿 && node proxy.js');
    console.log('  PowerShell: $env:NAVER_CLIENT_SECRET="시크릿"; node proxy.js');
  }
  console.log('────────────────────────────────────────────────');
  console.log('');
});
