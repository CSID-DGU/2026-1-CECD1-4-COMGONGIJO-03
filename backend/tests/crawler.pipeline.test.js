// 네트워크 없이 전체 파이프라인 검증: fetch 를 가짜로 교체
const assert = require("assert");
const posted = [];
const ART = "https://www.yna.co.kr/view/AKR1";
global.fetch = async (url, opt = {}) => {
  const mk = (status, body, ct = "text/html; charset=utf-8") =>
    ({ ok: status < 300, status, url, headers: new Map([["content-type", ct]]), arrayBuffer: async () => new TextEncoder().encode(body), json: async () => JSON.parse(body) });
  if (url.includes("/rss/search")) return mk(200, `<rss><channel><item><title>2호선 사고 - 연합뉴스</title><link>https://news.google.com/rss/articles/CBMiNEW?oc=5</link><guid>CBMiNEW</guid><pubDate>Sat, 14 Nov 2026 06:30:00 GMT</pubDate><description>x</description><source url="https://www.yna.co.kr">연합뉴스</source></item></channel></rss>`);
  if (url.includes("/articles/CBMiNEW")) return mk(200, `<div data-n-a-sg="SIG" data-n-a-ts="123"></div>`);
  if (url.includes("batchexecute")) { assert.ok(opt.body.startsWith("f.req=")); return mk(200, `)]}'\n\n` + JSON.stringify([["wrb.fr","Fbv4je",JSON.stringify(["garturlres",ART,1])]])); }
  if (url === ART) return mk(200, `<meta property="og:description" content="요약문"><div class="story-news article"><p>(서울=연합뉴스) 박민수 기자 = ${"2호선에서 사고가 발생했다. ".repeat(10)}</p></div>`);
  if (url.endsWith("/api/articles")) { posted.push(JSON.parse(opt.body)); return mk(202, JSON.stringify({ success: true, article_id: 42, analysis_status: "pending" }), "application/json"); }
  throw new Error("unexpected " + url);
};
process.env.CRAWL_DELAY_MS = "0";
const fs = require("fs");
const path = require("path");
const tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "crawler-test-"));
process.env.CRAWL_SEEN_FILE = path.join(tempDir, "seen.json");
const { crawlOnce } = require("../crawler");
crawlOnce(["서울교통공사"], { limit: 5 }).then((res) => {
  const a = posted[0];
  assert.strictEqual(a.url, ART); assert.strictEqual(a.source, "연합뉴스"); assert.strictEqual(a.author, "박민수 기자");
  assert.strictEqual(a.summary, "요약문"); assert.strictEqual(a.crawl_status, "full"); assert.strictEqual(a.published_at, "2026-11-14 15:30:00");
  console.log("\n전송된 기사:", { ...a, content: a.content.slice(0, 50) + "..." });
  assert.strictEqual(res.stats.saved, 1);
  assert.strictEqual(res.results[0].article_id, 42);
  console.log("✔ 전체 파이프라인 통과");
}).finally(() => {
  fs.unlinkSync(process.env.CRAWL_SEEN_FILE);
  fs.rmdirSync(tempDir);
});
