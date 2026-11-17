// 공통 HTTP 유틸: 타임아웃, 재시도, 한글 인코딩(EUC-KR 등) 자동 판별
// 외부 패키지 없이 Node 18+ 내장 fetch / TextDecoder 만 사용합니다.

const DEFAULT_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Content-Type 헤더 → <meta charset> 순서로 문자셋을 찾아 디코딩합니다.
 * 한국 언론사 중 일부는 아직 EUC-KR(CP949)을 쓰기 때문에 필요합니다.
 */
function decodeBody(buffer, contentType = "") {
    let charset = (contentType.match(/charset=["']?([\w-]+)/i) || [])[1];

    if (!charset) {
        // 앞부분만 latin1로 읽어서 meta 태그의 charset 확인
        const head = Buffer.from(buffer).subarray(0, 4096).toString("latin1");
        charset =
            (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
    }

    charset = charset.toLowerCase();
    if (["ks_c_5601-1987", "cp949", "x-windows-949", "ksc5601"].includes(charset)) {
        charset = "euc-kr";
    }

    try {
        return new TextDecoder(charset).decode(buffer);
    } catch (e) {
        return new TextDecoder("utf-8").decode(buffer);
    }
}

/**
 * 재시도 + 타임아웃이 있는 fetch
 * @returns {Promise<{status:number, url:string, text:string, headers:Headers}>}
 */
async function httpRequest(url, options = {}) {
    const {
        method = "GET",
        headers = {},
        body,
        timeout = 10000,
        retries = 2,
        retryDelay = 1500,
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                method,
                body,
                redirect: "follow",
                signal: AbortSignal.timeout(timeout),
                headers: {
                    "User-Agent": DEFAULT_UA,
                    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
                    ...headers,
                },
            });

            // 429(요청 과다), 5xx 는 잠시 후 재시도
            if ((res.status === 429 || res.status >= 500) && attempt < retries) {
                await sleep(retryDelay * (attempt + 1));
                continue;
            }

            const buffer = new Uint8Array(await res.arrayBuffer());
            const text = decodeBody(buffer, res.headers.get("content-type") || "");

            return { status: res.status, url: res.url, text, headers: res.headers };
        } catch (err) {
            lastError = err;
            if (attempt < retries) await sleep(retryDelay * (attempt + 1));
        }
    }

    throw lastError;
}

module.exports = { httpRequest, decodeBody, sleep, DEFAULT_UA };
