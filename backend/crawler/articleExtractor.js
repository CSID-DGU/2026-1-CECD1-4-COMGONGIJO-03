// 언론사 원문 페이지 HTML → 본문 / 언론사 / 기자 / 요약 / 발행일 / 이미지 / 키워드 추출
//
// 추출 우선순위
//   1) JSON-LD (schema.org NewsArticle) 의 articleBody  ← 가장 깨끗함
//   2) 주요 언론사·공통 CMS 의 본문 영역 (id/class 기반)
//   3) @mozilla/readability + jsdom (설치되어 있으면 자동 사용, 선택사항)
//   4) <p> 문단 모으기 (최후의 수단)
// 요약문은 언론사가 직접 쓴 og:description / meta description 을 우선 사용하고,
// 없으면 본문 앞 2~3문장(리드문)을 사용합니다. (AI 요약은 기존 analyzeArticle 에서 생성)

const { httpRequest } = require("./httpClient");
const { decodeEntities } = require("./googleNewsRss");

// ---------------------------------------------------------------------------
// 본문 영역 후보 (위에서부터 순서대로 시도). 팀에서 자주 나오는 언론사를 계속 추가하세요.
// ---------------------------------------------------------------------------
const BODY_SELECTORS = [
    { attr: "id", value: "dic_area" },                   // 네이버 뉴스
    { attr: "id", value: "newsct_article" },             // 네이버 뉴스(구)
    { attr: "id", value: "article-view-content-div" },   // 지역·인터넷 언론사 공통 CMS(엔디소프트)
    { attr: "itemprop", value: "articleBody" },          // schema.org 마크업
    { attr: "class", value: "story-news" },              // 연합뉴스
    { attr: "id", value: "article_body" },               // 중앙일보 등
    { attr: "id", value: "articleBody" },                // 경향/국민 등
    { attr: "id", value: "articletxt" },                 // 한국경제
    { attr: "id", value: "textBody" },                   // 머니투데이
    { attr: "id", value: "articles_detail" },            // 뉴스1
    { attr: "id", value: "cont_newstext" },              // KBS
    { attr: "class", value: "news_cnt_detail_wrap" },    // 매일경제
    { attr: "class", value: "article-text" },            // 한겨레
    { attr: "class", value: "article_txt" },             // 동아일보
    { attr: "class", value: "news_view" },               // 동아/다음
    { attr: "class", value: "article_view" },            // 다음
    { attr: "class", value: "viewer" },                  // 뉴시스
    { attr: "class", value: "news_txt" },                // MBC
    { attr: "class", value: "text_area" },               // SBS
    { attr: "class", value: "art_body" },                // 경향
    { attr: "class", value: "article_body" },
    { attr: "class", value: "article-body" },
    { attr: "class", value: "articleBody" },
    { attr: "class", value: "news_body" },
    { attr: "class", value: "view_con" },
];

// 본문 끝에 붙는 저작권/광고 문구 제거용
const NOISE_LINE = /무단\s*전재|재배포\s*금지|저작권자|Copyright|ⓒ|©|All rights reserved|기사제보|구독하기|좋아요|많이 본 뉴스|관련기사|▶|☞/i;

// ---------------------------------------------------------------------------
// HTML 유틸
// ---------------------------------------------------------------------------
function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 시작 태그 위치부터 같은 이름의 태그 깊이를 세어서 짝이 맞는 닫는 태그까지 잘라냄 */
function sliceBalancedElement(html, startIndex, tagName) {
    const openEnd = html.indexOf(">", startIndex) + 1;
    const re = new RegExp(`<(/?)${tagName}\\b[^>]*?(/?)>`, "gi");
    re.lastIndex = openEnd;

    let depth = 1, m;
    while ((m = re.exec(html))) {
        if (m[2] === "/") continue;              // <div /> 같은 self-closing
        depth += m[1] === "/" ? -1 : 1;
        if (depth === 0) return html.slice(openEnd, m.index);
    }
    return html.slice(openEnd);                  // 닫는 태그가 없으면 끝까지
}

function findElementInnerHtml(html, { attr, value }) {
    const v = escapeRe(value);
    const pattern =
        attr === "class"
            ? `<([a-z0-9]+)\\b[^>]*\\bclass\\s*=\\s*["'](?:[^"']*\\s)?${v}(?:\\s[^"']*)?["'][^>]*>`
            : `<([a-z0-9]+)\\b[^>]*\\b${attr}\\s*=\\s*["']${v}["'][^>]*>`;
    const m = new RegExp(pattern, "i").exec(html);
    return m ? sliceBalancedElement(html, m.index, m[1]) : null;
}

/** HTML 조각 → 문단 단위 줄바꿈이 살아있는 평문 */
function htmlToText(fragment) {
    let s = fragment
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(script|style|noscript|iframe|button|form|select|figure|figcaption|table|aside|nav|footer)\b[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|h[1-6]|section|article)>/gi, "\n")
        .replace(/<[^>]+>/g, "");

    s = decodeEntities(s).replace(/ /g, " ");

    return s
        .split("\n")
        .map((l) => l.replace(/[ \t]+/g, " ").trim())
        .filter((l) => l && !NOISE_LINE.test(l))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// ---------------------------------------------------------------------------
// 메타데이터
// ---------------------------------------------------------------------------
function extractMeta(html) {
    const meta = {};
    const re = /<meta\s+[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
        const tag = m[0];
        const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
        const content = (tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i) || [])[2];
        if (key && content && !meta[key.toLowerCase()]) {
            meta[key.toLowerCase()] = decodeEntities(content).trim();
        }
    }
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    if (title) meta._title = decodeEntities(title).trim();
    return meta;
}

function extractJsonLdArticle(html) {
    const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
        let data;
        try {
            data = JSON.parse(m[1].trim());
        } catch {
            continue;
        }
        const nodes = [].concat(data).flatMap((d) => (d && d["@graph"] ? d["@graph"] : d));
        const article = nodes.find((n) =>
            n && /NewsArticle|^Article$|ReportageNewsArticle|AnalysisNewsArticle/.test([].concat(n["@type"]).join(","))
        );
        if (article) return article;
    }
    return null;
}

function nameOf(x) {
    if (!x) return "";
    if (typeof x === "string") return x;
    if (Array.isArray(x)) return x.map(nameOf).filter(Boolean).join(", ");
    return x.name || "";
}

/** 본문에서 "홍길동 기자" / "(서울=연합뉴스) 홍길동 기자 =" 패턴으로 기자명 찾기 */
function findReporterInText(text) {
    const head = text.slice(0, 300);
    const tail = text.slice(-300);
    const re = /([가-힣]{2,4})\s*(?:선임|수석|객원|인턴)?\s*기자/;
    const m = head.match(re) || tail.match(re);
    return m ? `${m[1]} 기자` : "";
}

function findEmail(text) {
    return (text.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0] || "";
}

function leadSentences(text, count = 3) {
    const body = text.replace(/^\([^)]*=[^)]*\)\s*[가-힣\s]*기자\s*=\s*/, ""); // "(서울=연합뉴스) 홍길동 기자 =" 제거
    const sentences = body.replace(/\n+/g, " ").match(/[^.!?。]+[.!?。]+/g) || [body];
    return sentences.slice(0, count).join(" ").trim().slice(0, 400);
}

// ---------------------------------------------------------------------------
// 선택: Readability 가 설치되어 있으면 사용 (npm i @mozilla/readability jsdom)
// ---------------------------------------------------------------------------
let Readability = null, JSDOM = null;
try {
    ({ Readability } = require("@mozilla/readability"));
    ({ JSDOM } = require("jsdom"));
} catch {
    /* 설치 안 되어 있으면 내장 방식만 사용 */
}

function readabilityExtract(html, url) {
    if (!Readability || !JSDOM) return null;
    try {
        const dom = new JSDOM(html, { url });
        const r = new Readability(dom.window.document).parse();
        return r && r.textContent ? { text: htmlToText(r.content), byline: r.byline } : null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------
function extractFromHtml(html, url = "") {
    const meta = extractMeta(html);
    const ld = extractJsonLdArticle(html) || {};

    // ---- 본문 ----
    let content = "", method = "";

    if (typeof ld.articleBody === "string" && ld.articleBody.length > 200) {
        content = htmlToText(ld.articleBody);
        method = "json-ld";
    }

    if (!content) {
        for (const sel of BODY_SELECTORS) {
            const inner = findElementInnerHtml(html, sel);
            const text = inner ? htmlToText(inner) : "";
            if (text.length > 150) {
                content = text;
                method = `${sel.attr}=${sel.value}`;
                break;
            }
        }
    }

    let readabilityByline = "";
    if (!content) {
        const r = readabilityExtract(html, url);
        if (r && r.text.length > 150) {
            content = r.text;
            readabilityByline = r.byline || "";
            method = "readability";
        }
    }

    if (!content) {
        const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
            .map((p) => htmlToText(p[1]))
            .filter((t) => t.length > 40);
        content = paragraphs.join("\n");
        method = content ? "paragraphs" : "none";
    }

    // ---- 나머지 메타 ----
    const author =
        nameOf(ld.author) ||
        meta["dable:author"] ||
        meta["article:author"] ||
        meta["author"] ||
        meta["byl"] ||
        readabilityByline ||
        findReporterInText(content);

    const description = ld.description || meta["og:description"] || meta["description"] || meta["twitter:description"] || "";

    const keywords = []
        .concat(ld.keywords || meta["news_keywords"] || meta["keywords"] || [])
        .flatMap((k) => String(k).split(","))
        .map((k) => k.trim())
        .filter(Boolean);

    const image = meta["og:image"] || nameOf(ld.image) || (ld.image && ld.image.url) || (Array.isArray(ld.image) ? ld.image[0] : "") || "";

    return {
        title: ld.headline || meta["og:title"] || meta["twitter:title"] || meta._title || "",
        content,
        summary: description || leadSentences(content),
        summary_source: description ? "publisher" : "lead",   // 언론사 제공 요약인지, 리드문인지
        publisher: nameOf(ld.publisher) || meta["og:site_name"] || "",
        author,
        reporter_email: findEmail(content.slice(-400)),
        published_at: ld.datePublished || meta["article:published_time"] || meta["og:article:published_time"] || meta["pubdate"] || null,
        modified_at: ld.dateModified || meta["article:modified_time"] || null,
        category: ld.articleSection ? nameOf(ld.articleSection) : meta["article:section"] || "",
        keywords,
        image_url: typeof image === "string" ? image : "",
        canonical_url: (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) || [])[1] || url,
        extract_method: method,
    };
}

async function fetchArticle(url) {
    const res = await httpRequest(url, {
        headers: { Accept: "text/html,application/xhtml+xml" },
        timeout: 12000,
        retries: 1,
    });
    if (res.status !== 200) throw new Error(`원문 요청 실패 (HTTP ${res.status})`);
    return extractFromHtml(res.text, res.url || url);
}

module.exports = { fetchArticle, extractFromHtml, htmlToText, BODY_SELECTORS };
