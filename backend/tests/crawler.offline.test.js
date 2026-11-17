const assert = require("assert");
const { parseRss, buildSearchUrl } = require("../crawler/googleNewsRss");
const dec = require("../crawler/googleNewsDecoder");
const { extractFromHtml, htmlToText } = require("../crawler/articleExtractor");
const { decodeBody } = require("../crawler/httpClient");
const { toMysqlDatetime } = require("../crawler");

// 1. RSS 파싱 (실제 구글 뉴스 RSS 형식)
const rss = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>"서울교통공사" - Google 뉴스</title>
<item><title>서울교통공사, 지하철 2호선 운행 지연 사과 - 연합뉴스</title><link>https://news.google.com/rss/articles/CBMiVkFVX3lxTE1hYmNkZWY?oc=5</link><guid isPermaLink="false">CBMiVkFVX3lxTE1hYmNkZWY</guid><pubDate>Sat, 14 Nov 2026 06:30:00 GMT</pubDate><description>&lt;ol&gt;&lt;li&gt;&lt;a href="https://news.google.com/rss/articles/CBMiVkFVX3lxTE1hYmNkZWY?oc=5" target="_blank"&gt;서울교통공사, 지하철 2호선 운행 지연 사과&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;연합뉴스&lt;/font&gt;&lt;/li&gt;&lt;li&gt;&lt;a href="https://news.google.com/rss/articles/CBMiXYZ?oc=5" target="_blank"&gt;2호선 출근길 대란&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;KBS 뉴스&lt;/font&gt;&lt;/li&gt;&lt;/ol&gt;</description><source url="https://www.yna.co.kr">연합뉴스</source></item>
<item><title>Q&amp;A: 파업 언제까지? - 한겨레</title><link>https://news.google.com/rss/articles/CBMiABC?oc=5</link><guid>CBMiABC</guid><pubDate>Fri, 13 Nov 2026 23:00:00 GMT</pubDate><description>x</description><source url="https://www.hani.co.kr">한겨레</source></item>
</channel></rss>`;
const items = parseRss(rss);
assert.strictEqual(items.length, 2);
assert.strictEqual(items[0].title, "서울교통공사, 지하철 2호선 운행 지연 사과");
assert.strictEqual(items[0].source, "연합뉴스");
assert.strictEqual(items[0].source_url, "https://www.yna.co.kr");
assert.strictEqual(items[0].related_articles.length, 1);
assert.strictEqual(items[0].related_articles[0].source, "KBS 뉴스");
assert.strictEqual(items[1].title, "Q&A: 파업 언제까지?");
assert.strictEqual(toMysqlDatetime(items[0].published_at), "2026-11-14 15:30:00");
console.log("✔ RSS 파싱", items[0]);
console.log("✔ URL:", buildSearchUrl('"서울교통공사"', { when: "1d" }));

// 2. 디코더
assert.strictEqual(dec.getArticleId("https://news.google.com/rss/articles/CBMiVkFV?oc=5"), "CBMiVkFV");
// 예전 형식 ID 직접 만들어서 오프라인 디코딩 확인
const u = "https://www.yna.co.kr/view/AKR20261114000100004";
const oldId = Buffer.concat([Buffer.from([0x08,0x13,0x22,u.length]), Buffer.from(u), Buffer.from([0xd2,0x01,0x00])]).toString("base64url");
assert.strictEqual(dec.tryOfflineDecode(oldId), u);
// 새 형식(AU_yqL...)은 null
const newId = Buffer.concat([Buffer.from([0x08,0x13,0x22,10]), Buffer.from("AU_yqLabcd")]).toString("base64url");
assert.strictEqual(dec.tryOfflineDecode(newId), null);
// 서명 추출
const page = `<c-wiz><div jscontroller="aLI87" data-n-a-sg="AZ5r3eT_sig" data-n-a-ts="1763100000" data-n-a-id="CBMi"></div></c-wiz>`;
assert.deepStrictEqual(dec.extractDecodingParams(page), { signature: "AZ5r3eT_sig", timestamp: "1763100000" });
// 요청 바디 형태
const body = decodeURIComponent(dec.buildBatchExecuteBody("CBMiX", "1763100000", "SIG").slice(6));
const parsedReq = JSON.parse(body); const inner = JSON.parse(parsedReq[0][0][1]);
assert.strictEqual(parsedReq[0][0][0], "Fbv4je"); assert.strictEqual(inner[0], "garturlreq");
assert.strictEqual(inner[2], "CBMiX"); assert.strictEqual(inner[3], 1763100000); assert.strictEqual(inner[4], "SIG");
// 응답 파싱
const target = "https://www.hani.co.kr/arti/society/1234567.html?x=1&y=2";
const resp = `)]}'\n\n` + JSON.stringify([["wrb.fr","Fbv4je",JSON.stringify(["garturlres",target,1]),null,null,null,"generic"],["di",42]]) + `\n25\n[["e",4,null,null,123]]`;
assert.strictEqual(dec.parseBatchExecuteResponse(resp), target);
console.log("✔ 디코더 (오프라인/서명/요청/응답)");

// 3. 본문 추출 - 공통 CMS(엔디소프트) + EUC-KR
const cmsHtml = `<html><head><meta charset="euc-kr"><title>지하철 파업 - 서울신문</title>
<meta property="og:title" content="지하철 파업 3일째, 시민 불편 가중">
<meta property="og:description" content="서울교통공사 노조 파업이 3일째 이어지면서 출근길 시민 불편이 커지고 있다.">
<meta property="og:site_name" content="서울신문"><meta property="og:image" content="https://img.example.com/a.jpg">
<meta property="article:published_time" content="2026-11-14T09:00:00+09:00"><meta name="news_keywords" content="파업,지하철,서울교통공사">
</head><body><div class="header">메뉴</div>
<div id="article-view-content-div" class="article-body"><div class="ad"><script>ad()</script></div>
<p>(서울=뉴스) 김철수 기자 = 서울교통공사 노동조합의 파업이 3일째 이어지면서 출근길 시민들의 불편이 가중되고 있다.</p>
<figure><img src="x.jpg"><figcaption>사진 설명입니다</figcaption></figure>
<p>공사는 14일 비상수송대책을 가동해 운행률을 평시 대비 80% 수준으로 유지하고 있다고 밝혔다. <br>그러나 2호선 일부 구간은 배차 간격이 크게 늘어났다.</p>
<div><p>시민 이모(34)씨는 "평소보다 30분 일찍 나왔는데도 지각했다"고 말했다.</p></div>
<p>김철수 기자 kcs@example.com</p><p>ⓒ 서울신문 무단전재 및 재배포 금지</p></div>
<div class="related">관련기사 목록</div></body></html>`;
const buf = new TextEncoder().encode(cmsHtml); // utf-8로 인코딩 후 euc-kr 디코딩 테스트는 아래 별도
const r1 = extractFromHtml(cmsHtml, "https://www.seoul.co.kr/news/1");
assert.strictEqual(r1.extract_method, "id=article-view-content-div");
assert.ok(r1.content.includes("비상수송대책") && r1.content.includes("지각했다"));
assert.ok(!r1.content.includes("무단전재") && !r1.content.includes("사진 설명") && !r1.content.includes("관련기사"));
assert.strictEqual(r1.author, "김철수 기자");
assert.strictEqual(r1.reporter_email, "kcs@example.com");
assert.strictEqual(r1.publisher, "서울신문");
assert.strictEqual(r1.summary_source, "publisher");
assert.deepStrictEqual(r1.keywords, ["파업","지하철","서울교통공사"]);
console.log("✔ CMS 본문 추출\n", r1);

// EUC-KR 디코딩
const eucBytes = Buffer.from([0xbc,0xad,0xbf,0xef]); // "서울"
assert.strictEqual(decodeBody(eucBytes, "text/html; charset=EUC-KR"), "서울");
assert.strictEqual(decodeBody(Buffer.concat([Buffer.from('<meta charset="ks_c_5601-1987">'), eucBytes]), "").endsWith("서울"), true);
console.log("✔ EUC-KR 디코딩");

// 4. JSON-LD 우선
const ldHtml = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"NewsArticle","headline":"교통공사 사장 사과","articleBody":"${"서울교통공사 사장이 14일 기자회견을 열고 사고에 대해 공식 사과했다. ".repeat(6)}","author":[{"@type":"Person","name":"이영희"}],"publisher":{"@type":"Organization","name":"한겨레"},"datePublished":"2026-11-14T10:00:00+09:00","articleSection":"사회"}]}</script></head><body><p>짧음</p></body></html>`;
const r2 = extractFromHtml(ldHtml);
assert.strictEqual(r2.extract_method, "json-ld"); assert.strictEqual(r2.author, "이영희");
assert.strictEqual(r2.publisher, "한겨레"); assert.strictEqual(r2.summary_source, "lead"); assert.strictEqual(r2.category, "사회");
console.log("✔ JSON-LD 추출 / 요약(리드문):", r2.summary);

// 5. 네이버 뉴스 dic_area + 중첩 div
const nv = `<article id="dic_area" class="go_trans _article_content"><div><div>${"내용 문장입니다. ".repeat(20)}</div></div><br>끝 문장.</article><div>바깥</div>`;
const r3 = extractFromHtml(nv);
assert.strictEqual(r3.extract_method, "id=dic_area"); assert.ok(r3.content.endsWith("끝 문장.")); assert.ok(!r3.content.includes("바깥"));
// 6. fallback paragraphs
const r4 = extractFromHtml(`<div><p>${"가".repeat(50)}</p><p>짧다</p><p>${"나".repeat(60)}</p></div>`);
assert.strictEqual(r4.extract_method, "paragraphs"); assert.strictEqual(r4.content.split("\n").length, 2);
console.log("✔ 네이버/폴백 추출\n\n모든 테스트 통과");
