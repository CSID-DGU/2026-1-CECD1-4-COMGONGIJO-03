// 구글 뉴스 RSS 검색 결과를 가져와서 기사 목록으로 파싱합니다.
//
// RSS 주소 형식
//   https://news.google.com/rss/search?q=검색어&hl=ko&gl=KR&ceid=KR:ko
//
// 검색어 연산자 예시 (q 에 그대로 넣으면 됨)
//   "서울교통공사"          → 정확히 일치
//   서울교통공사 when:1d    → 최근 1일 (1h, 7d 등 가능)
//   서울교통공사 -채용      → '채용' 포함 기사 제외
//   서울교통공사 site:yna.co.kr → 특정 언론사만

const { httpRequest } = require("./httpClient");

function buildSearchUrl(query, { hl = "ko", gl = "KR", when } = {}) {
    const q = when ? `${query} when:${when}` : query;
    const params = new URLSearchParams({ q, hl, gl, ceid: `${gl}:${hl}` });
    return `https://news.google.com/rss/search?${params.toString()}`;
}

// ---------- 아주 작은 XML 헬퍼 (구글 뉴스 RSS 구조가 단순해서 충분함) ----------

function decodeEntities(str = "") {
    return str
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&amp;/g, "&");
}

function getTag(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
    return m ? decodeEntities(m[2]).trim() : "";
}

function getAttr(xml, tag, attr) {
    const m = xml.match(new RegExp(`<${tag}\\s[^>]*${attr}="([^"]*)"`, "i"));
    return m ? decodeEntities(m[1]) : "";
}

function stripHtml(html = "") {
    return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * 구글 뉴스 제목은 "기사 제목 - 언론사" 형태이므로 언론사 부분을 떼어냅니다.
 */
function splitTitle(rawTitle, sourceName) {
    if (sourceName && rawTitle.endsWith(` - ${sourceName}`)) {
        return rawTitle.slice(0, -(sourceName.length + 3)).trim();
    }
    const idx = rawTitle.lastIndexOf(" - ");
    return idx > 0 ? rawTitle.slice(0, idx).trim() : rawTitle;
}

/**
 * description 안에는 대표 기사 + '관련 기사' 목록(<ol><li>)이 HTML 로 들어있습니다.
 * 같은 사건을 다룬 다른 언론사 기사들이라 클러스터링 힌트로 쓸 수 있습니다.
 */
function parseRelated(descriptionHtml) {
    const related = [];
    const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(?:[\s\S]*?<font[^>]*>([\s\S]*?)<\/font>)?/gi;
    let m;
    while ((m = re.exec(descriptionHtml))) {
        related.push({
            google_url: decodeEntities(m[1]),
            title: stripHtml(m[2]),
            source: stripHtml(m[3] || ""),
        });
    }
    return related;
}

function parseRss(xml) {
    const items = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let m;

    while ((m = itemRe.exec(xml))) {
        const block = m[1];
        const sourceName = getTag(block, "source");
        const rawTitle = getTag(block, "title");
        const descriptionHtml = getTag(block, "description");
        const pubDate = getTag(block, "pubDate");

        items.push({
            title: splitTitle(rawTitle, sourceName),
            google_url: getTag(block, "link"),
            guid: getTag(block, "guid"),
            source: sourceName,                         // 언론사 이름
            source_url: getAttr(block, "source", "url"),// 언론사 홈페이지
            published_at: pubDate ? new Date(pubDate) : null,
            rss_snippet: stripHtml(descriptionHtml),
            related_articles: parseRelated(descriptionHtml).slice(1), // 첫 번째는 자기 자신
        });
    }
    return items;
}

async function fetchGoogleNews(query, options = {}) {
    const url = buildSearchUrl(query, options);
    const res = await httpRequest(url, { headers: { Accept: "application/rss+xml" } });

    if (res.status !== 200) {
        throw new Error(`구글 뉴스 RSS 요청 실패 (HTTP ${res.status})`);
    }

    const items = parseRss(res.text);
    return options.limit ? items.slice(0, options.limit) : items;
}

module.exports = { fetchGoogleNews, parseRss, buildSearchUrl, decodeEntities, stripHtml };
