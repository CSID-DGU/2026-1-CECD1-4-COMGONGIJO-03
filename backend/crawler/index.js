// 구글 뉴스 RSS 크롤러 실행 진입점
//
// 사용 예)
//   node crawler/index.js "서울교통공사"                     # 수집 후 백엔드(/api/articles)로 전송
//   node crawler/index.js "서울교통공사" --dry-run --out out.json  # 전송 없이 JSON 파일로만 저장
//   node crawler/index.js "서울교통공사,지하철 파업" --when 1d --limit 20
//   node crawler/index.js "서울교통공사" --watch 600         # 600초(10분)마다 반복 수집
//
// 환경변수 (.env)
//   BACKEND_URL=http://localhost:3000     기사 저장 API 주소
//   CRAWL_DELAY_MS=1500                   기사 간 요청 간격(구글 429 방지)

try { require("dotenv").config(); } catch { /* dotenv 없으면 환경변수만 사용 */ }
const fs = require("fs");
const path = require("path");

const { fetchGoogleNews } = require("./googleNewsRss");
const { decodeGoogleNewsUrl, getArticleId } = require("./googleNewsDecoder");
const { fetchArticle } = require("./articleExtractor");
const { sleep } = require("./httpClient");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const DELAY_MS = Number(process.env.CRAWL_DELAY_MS || 1500);
const SEEN_FILE = process.env.CRAWL_SEEN_FILE || path.join(__dirname, ".seen.json");

// ---------- 이미 처리한 기사 기록 (재실행 시 중복 디코딩/요청 방지) ----------
function loadSeen() {
    try {
        return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")));
    } catch {
        return new Set();
    }
}
function saveSeen(seen) {
    // 너무 커지지 않도록 최근 5000건만 보관
    fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen].slice(-5000)));
}

/** MySQL DATETIME 형식(한국시간)으로 변환: 2026-11-14 16:30:00 */
function toMysqlDatetime(value) {
    const d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return null;
    return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * RSS 항목 1개 → 원문까지 채운 기사 객체
 */
async function enrichItem(item, keyword) {
    const originalUrl = await decodeGoogleNewsUrl(item.google_url);

    let extracted = {};
    let crawlError = null;

    if (originalUrl) {
        try {
            extracted = await fetchArticle(originalUrl);
        } catch (err) {
            crawlError = err.message;
        }
    } else {
        crawlError = "원문 URL 디코딩 실패";
    }

    const content = extracted.content || "";

    return {
        // ---- 기존 POST /api/articles 가 받는 필드 ----
        title: item.title || extracted.title,
        content: content || extracted.summary || item.rss_snippet, // 본문이 없으면 요약이라도 분석에 사용
        url: originalUrl || item.google_url,
        source: item.source || extracted.publisher,
        author: extracted.author || null,
        published_at: toMysqlDatetime(item.published_at || extracted.published_at),

        // ---- 추가 정보 (DB 컬럼 추가 시 저장 가능, 아래 schema 참고) ----
        summary: extracted.summary || item.rss_snippet || "",
        summary_source: extracted.summary_source || "rss",
        reporter_email: extracted.reporter_email || null,
        category: extracted.category || null,
        news_keywords: extracted.keywords || [],
        image_url: extracted.image_url || null,
        modified_at: toMysqlDatetime(extracted.modified_at),
        google_news_url: item.google_url,
        source_homepage: item.source_url,
        related_articles: item.related_articles, // 같은 사건을 다룬 다른 언론사 기사 (클러스터링 참고용)
        search_keyword: keyword,
        content_length: content.length,
        extract_method: extracted.extract_method || "none",
        crawl_status: content.length > 150 ? "full" : originalUrl ? "partial" : "rss_only",
        crawl_error: crawlError,
    };
}

async function sendToBackend(article) {
    const res = await fetch(`${BACKEND_URL}/api/articles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(article),
        signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));

    let result = "saved";
    if (res.status === 409) result = "duplicate";
    else if (!res.ok || data.success !== true) result = "failed";
    return { status: res.status, result, data };
}

/**
 * @param {string[]} keywords
 * @param {object} opts
 *   dryRun     true 면 DB 저장 안 함
 *   limit, when
 *   useSeen    이미 처리한 기사 건너뛰기 (기본 true)
 *   onEvent    (type, data) => void   화면(SSE)으로 진행상황 전달용
 *   shouldStop () => boolean          중지 버튼
 */
async function crawlOnce(keywords, opts = {}) {
    const emit = opts.onEvent || (() => {});
    const useSeen = opts.useSeen !== false;
    const seen = useSeen ? loadSeen() : new Set();
    const results = [];
    const stats = { total: 0, full: 0, partial: 0, rss_only: 0, saved: 0, duplicate: 0, failed: 0, skipped: 0 };

    emit("start", { keywords, dryRun: !!opts.dryRun });

    for (const keyword of keywords) {
        if (opts.shouldStop && opts.shouldStop()) break;

        console.log(`\n🔎 [${keyword}] 구글 뉴스 RSS 조회...`);
        let items;
        try {
            items = await fetchGoogleNews(keyword, { when: opts.when, limit: opts.limit });
        } catch (err) {
            console.error(`  ❌ RSS 실패: ${err.message}`);
            emit("rss", { keyword, count: 0, error: err.message });
            continue;
        }
        console.log(`  → ${items.length}건`);

        const fresh = items.filter((it) => !seen.has(getArticleId(it.google_url) || it.guid));
        stats.skipped += items.length - fresh.length;
        emit("rss", { keyword, count: items.length, fresh: fresh.length });

        for (let i = 0; i < fresh.length; i++) {
            if (opts.shouldStop && opts.shouldStop()) break;
            const item = fresh[i];
            const id = getArticleId(item.google_url) || item.guid;
            if (seen.has(id)) {
                stats.skipped++;
                continue;
            }

            emit("progress", { keyword, index: i + 1, total: fresh.length, title: item.title, source: item.source });

            const article = await enrichItem(item, keyword);
            stats.total++;
            stats[article.crawl_status]++;

            const tag = { full: "✅", partial: "⚠️ ", rss_only: "❌" }[article.crawl_status];
            console.log(`  ${tag} [${article.source}] ${article.title.slice(0, 40)} (본문 ${article.content_length}자, ${article.extract_method})`);

            if (!opts.dryRun) {
                try {
                    const r = await sendToBackend(article);
                    article.save_result = r.result;
                    article.save_status = r.status;
                    article.article_id = r.data.article_id || null;
                    stats[r.result]++;
                    if (r.result !== "failed") seen.add(id);
                    if (r.result === "duplicate") console.log("     ↳ 이미 저장된 기사");
                    else if (r.result === "failed") console.log(`     ↳ 저장 실패 (HTTP ${r.status})`, r.data.message || "");
                    else console.log("     ↳ 저장 완료 (AI 분석 대기열에 등록)");
                } catch (err) {
                    article.save_result = "failed";
                    article.save_error = err.message;
                    stats.failed++;
                    console.error(`     ↳ 백엔드 전송 실패: ${err.message}`);
                }
            }

            results.push(article);
            emit("article", article);
            await sleep(DELAY_MS);
        }
    }

    if (useSeen && !opts.dryRun) saveSeen(seen);

    if (opts.out) {
        fs.writeFileSync(opts.out, JSON.stringify(results, null, 2));
        console.log(`\n💾 ${results.length}건 저장 → ${opts.out}`);
    }

    const stopped = !!(opts.shouldStop && opts.shouldStop());
    emit("done", { stats, stopped });
    return { results, stats, stopped };
}

// ---------- CLI ----------
function parseArgs(argv) {
    const opts = { keywords: [], dryRun: false, limit: 20, when: null, out: null, watch: 0 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dry-run") opts.dryRun = true;
        else if (a === "--limit") opts.limit = Number(argv[++i]);
        else if (a === "--when") opts.when = argv[++i];
        else if (a === "--out") opts.out = argv[++i];
        else if (a === "--watch") opts.watch = Number(argv[++i]);
        else opts.keywords.push(...a.split(",").map((s) => s.trim()).filter(Boolean));
    }
    return opts;
}

if (require.main === module) {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.keywords.length === 0) {
        console.log('사용법: node crawler/index.js "키워드1,키워드2" [--when 1d] [--limit 20] [--dry-run] [--out out.json] [--watch 600]');
        process.exit(1);
    }

    const run = () => crawlOnce(opts.keywords, opts).catch((e) => console.error(e));
    run();
    if (opts.watch > 0) {
        console.log(`⏱  ${opts.watch}초마다 반복 수집합니다. (Ctrl+C 로 종료)`);
        setInterval(run, opts.watch * 1000);
    }
}

module.exports = { crawlOnce, enrichItem, toMysqlDatetime, sendToBackend };
