
const PROXY_BASE = process.env.PROXY_BASE || "http://crawler-proxy:3001/naver-news";
const BACKEND_BASE = process.env.BACKEND_BASE || "http://backend:3000";

const MAX_INTERVAL = 1800;
const INTERVAL_STEP = 60;

const keywords = [
  { name: "서울교통공사", isMain: true, interval: 30 },
  { name: "지하철 파업", interval: 60 },
  { name: "서울 지하철 사고", interval: 60 },
  { name: "지하철 연착", interval: 60 },
  { name: "서울 지하철 파업", interval: 60 },
  { name: "지하철 노조", interval: 60 },
  { name: "도시철도 안전", interval: 60 },
  { name: "지하철 혼잡", interval: 60 },
  { name: "서울 전동차", interval: 60 },
  { name: "지하철 요금 인상", interval: 60 },
  { name: "지하철 스크린도어", interval: 60 }
].map((kw, i) => ({
  ...kw,
  nextAt: Date.now() + i * 3000,
  prevCount: 0,
  seen: new Set()
}));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function cleanText(value = "") {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function extractSource(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "언론사 미상";
  }
}

async function fetchNews(keyword) {
  const params = new URLSearchParams({
    query: keyword,
    display: "10",
    sort: "date"
  });

  const response = await fetch(`${PROXY_BASE}?${params}`, {
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`Naver API HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data.items || [];
}

async function saveArticle(item) {
  const url = item.originallink || item.link;

  const response = await fetch(`${BACKEND_BASE}/api/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: cleanText(item.title),
      content: cleanText(item.description),
      url,
      source: extractSource(url),
      author: null,
      published_at: null
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (response.status === 409) return "duplicate";

  if (!response.ok) {
    throw new Error(`Backend HTTP ${response.status}: ${await response.text()}`);
  }

  return "saved";
}

async function crawl(kw) {
  console.log(`[CRAWL] ${kw.name}`);

  try {
    const items = await fetchNews(kw.name);
    const currentUrls = new Set(
      items.map(item => item.originallink || item.link)
    );

    const added = [...currentUrls].filter(
      url => !kw.seen.has(url)
    ).length;

    let saved = 0;
    let duplicates = 0;
    let failed = 0;

    for (const item of items) {
      try {
        const result = await saveArticle(item);

        if (result === "saved") saved++;
        else duplicates++;
      } catch (error) {
        failed++;
        console.error(`[SAVE ERROR] ${kw.name}: ${error.message}`);
      }
    }

    if (failed === 0) {
      if (kw.isMain) {
        kw.interval = items.length > kw.prevCount ? 20 : 30;
      } else if (added > 0 && items.length >= kw.prevCount) {
        kw.interval = kw.interval > 60 ? 60 : 30;
      } else if (added === 0 && items.length <= kw.prevCount) {
        kw.interval = Math.min(
          kw.interval + INTERVAL_STEP,
          MAX_INTERVAL
        );
      }

      kw.prevCount = items.length;
      kw.seen = currentUrls;
    }

    console.log(
      `[RESULT] ${kw.name}: saved=${saved}, duplicate=${duplicates}, failed=${failed}, next=${kw.interval}s`
    );
  } catch (error) {
    console.error(`[CRAWL ERROR] ${kw.name}: ${error.message}`);
  } finally {
    kw.nextAt = Date.now() + kw.interval * 1000;
  }
}

async function main() {
  if (!process.env.NAVER_CLIENT_ID) {
    throw new Error("NAVER_CLIENT_ID 환경변수가 필요합니다.");
  }

  console.log("[START] 자동 뉴스 수집 시작");

  while (true) {
    const now = Date.now();

    const target = keywords
      .filter(kw => kw.nextAt <= now)
      .sort((a, b) => a.nextAt - b.nextAt)[0];

    if (target) {
      await crawl(target);
      await sleep(2500);
    } else {
      await sleep(1000);
    }
  }
}

main().catch(error => {
  console.error("[FATAL]", error);
  process.exit(1);
});
