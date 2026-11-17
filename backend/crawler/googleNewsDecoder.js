// 구글 뉴스 RSS 링크(news.google.com/rss/articles/CBMi...) → 실제 언론사 기사 URL 변환
//
// 2024년 이후 구글 뉴스 링크는 원문 URL이 그대로 들어있지 않은 "서명된 ID"라서
// 오프라인 디코딩이 불가능합니다. 구글 뉴스 화면이 내부적으로 쓰는 방식을 그대로 따라합니다.
//   1) 기사 페이지에서 서명값(data-n-a-sg)과 타임스탬프(data-n-a-ts)를 읽는다
//   2) batchexecute(rpcid: Fbv4je, "garturlreq") 엔드포인트에 POST 해서 원문 URL을 받는다
//
// ※ 비공식 내부 API라 구글이 바꾸면 깨질 수 있습니다. 실패 시 null 을 반환하고,
//   호출 측에서는 구글 링크를 그대로 저장하도록 처리했습니다.
// ※ 너무 빠르게 호출하면 429(요청 과다)가 나므로 크롤러에서 요청 간 딜레이를 둡니다.

const { httpRequest } = require("./httpClient");

const cache = new Map(); // 같은 기사 ID를 다시 디코딩하지 않도록

function getArticleId(googleUrl) {
    try {
        const { pathname } = new URL(googleUrl);
        const parts = pathname.split("/");
        const idx = parts.findIndex((p) => p === "articles" || p === "read");
        return idx >= 0 ? parts[idx + 1] : null;
    } catch {
        return null;
    }
}

/**
 * 예전 형식(2024년 이전) ID는 base64 안에 URL이 그대로 들어있어서 오프라인 디코딩 가능
 */
function tryOfflineDecode(articleId) {
    try {
        const buf = Buffer.from(articleId, "base64url");
        // protobuf 구조: 0x08 0x13 0x22 <길이(varint)> <URL 바이트> ...
        if (buf[0] !== 0x08 || buf[1] !== 0x13 || buf[2] !== 0x22) return null;

        let pos = 3, len = 0, shift = 0;
        while (pos < buf.length) {
            const b = buf[pos++];
            len |= (b & 0x7f) << shift;
            if ((b & 0x80) === 0) break;
            shift += 7;
        }
        const url = buf.subarray(pos, pos + len).toString("utf8");
        return /^https?:\/\//.test(url) ? url : null; // 새 형식은 "AU_yqL..." → null
    } catch {
        return null;
    }
}

function extractDecodingParams(html) {
    const sg = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1];
    const ts = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1];
    return sg && ts ? { signature: sg, timestamp: ts } : null;
}

function buildBatchExecuteBody(articleId, timestamp, signature) {
    const inner = [
        "garturlreq",
        [
            ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1,
                null, null, null, null, null, 0, 1],
            "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0,
        ],
        articleId,
        Number(timestamp),
        signature,
    ];
    const req = [[["Fbv4je", JSON.stringify(inner), null, "generic"]]];
    return "f.req=" + encodeURIComponent(JSON.stringify(req));
}

/**
 * 응답 예시
 *   )]}'
 *
 *   [["wrb.fr","Fbv4je","[\"garturlres\",\"https://www.yna.co.kr/view/AKR...\",1]",null,null,null,"generic"],...]
 */
function parseBatchExecuteResponse(text) {
    // 응답을 줄 단위로 보면서 "wrb.fr" 로 시작하는 JSON 배열을 찾는다
    for (const line of text.split("\n")) {
        const start = line.indexOf('[["wrb.fr"');
        if (start < 0) continue;
        try {
            const outer = JSON.parse(line.slice(start));
            for (const entry of outer) {
                if (entry[0] !== "wrb.fr" || typeof entry[2] !== "string") continue;
                const payload = JSON.parse(entry[2]);
                if (payload[0] === "garturlres" && /^https?:/.test(payload[1])) {
                    return payload[1];
                }
            }
        } catch {
            /* 다음 줄 시도 */
        }
    }
    return null;
}

/**
 * @param {string} googleUrl  RSS <link> 값
 * @returns {Promise<string|null>} 원문 URL (실패 시 null)
 */
async function decodeGoogleNewsUrl(googleUrl) {
    if (!/news\.google\.com/.test(googleUrl)) return googleUrl; // 이미 원문 URL

    const articleId = getArticleId(googleUrl);
    if (!articleId) return null;
    if (cache.has(articleId)) return cache.get(articleId);

    // 예전 형식이면 네트워크 없이 바로 해결
    const offline = tryOfflineDecode(articleId);
    if (offline && !offline.includes("news.google.com")) {
        cache.set(articleId, offline);
        return offline;
    }

    try {
        // 1단계: 서명값 얻기 (/articles/ 가 막히면 /rss/articles/ 로 재시도)
        let params = null;
        for (const path of [`/articles/${articleId}`, `/rss/articles/${articleId}`]) {
            const page = await httpRequest(`https://news.google.com${path}`, { retries: 1 });
            if (page.status === 200) params = extractDecodingParams(page.text);
            if (params) break;
        }
        if (!params) return null;

        // 2단계: batchexecute 호출
        const res = await httpRequest(
            "https://news.google.com/_/DotsSplashUi/data/batchexecute",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    Referer: "https://news.google.com/",
                },
                body: buildBatchExecuteBody(articleId, params.timestamp, params.signature),
                retries: 2,
                retryDelay: 3000,
            }
        );
        if (res.status !== 200) return null;

        const url = parseBatchExecuteResponse(res.text);
        if (url) cache.set(articleId, url);
        return url;
    } catch (err) {
        console.warn("[decoder] 디코딩 실패:", err.message);
        return null;
    }
}

module.exports = {
    decodeGoogleNewsUrl,
    getArticleId,
    tryOfflineDecode,
    extractDecodingParams,
    buildBatchExecuteBody,
    parseBatchExecuteResponse,
};
