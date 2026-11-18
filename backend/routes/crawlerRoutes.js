// 뉴스 수집 화면용 API
//   GET    /api/crawler/stream?keywords=a,b&when=1d&limit=10&dryRun=1   수집 실행 + 실시간 진행상황(SSE)
//   POST   /api/crawler/stop                                             수집 중지
//   GET    /api/crawler/status                                           실행 중 여부 + 자동 수집 상태
//   POST   /api/crawler/schedule  { keywords, when, limit, intervalSec } 자동 수집 시작
//   DELETE /api/crawler/schedule                                         자동 수집 중지

const express = require("express");
const crawler = require("../services/crawlerService");

const router = express.Router();

function parseKeywords(value) {
    return String(value || "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 10);
}

router.get("/stream", async (req, res) => {
    const keywords = parseKeywords(req.query.keywords);
    if (keywords.length === 0) {
        return res.status(400).json({ success: false, message: "키워드를 입력하세요." });
    }
    if (crawler.isRunning()) {
        return res.status(409).json({ success: false, message: "이미 수집이 진행 중입니다." });
    }

    // Server-Sent Events: 연결을 열어둔 채로 진행상황을 한 줄씩 보냄
    res.set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Docker(nginx)에서 버퍼링 없이 바로 전달
    });
    res.flushHeaders();

    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);

    // 브라우저 탭을 닫으면 수집도 중지
    let closed = false;
    res.on("close", () => {
        if (res.writableEnded) return;
        closed = true;
        clearInterval(ping);
        crawler.requestStop();
    });

    try {
        await crawler.runCrawl({
            keywords,
            when: req.query.when || null,
            limit: req.query.limit,
            dryRun: req.query.dryRun === "1",
            onEvent: (type, data) => !closed && send(type, data),
        });
    } catch (err) {
        if (!closed) send("fail", { message: err.message });
    } finally {
        clearInterval(ping);
        if (!closed) res.end();
    }
});

router.post("/stop", (req, res) => {
    crawler.requestStop();
    res.json({ success: true });
});

router.get("/status", (req, res) => {
    res.json({ success: true, running: crawler.isRunning(), scheduleEnabled: crawler.isScheduleEnabled(), schedule: crawler.getSchedule() });
});

router.post("/schedule", (req, res) => {
    if (!crawler.isScheduleEnabled()) {
        return res.status(409).json({ success: false, message: "자동 수집을 사용하려면 CRAWLER_PROVIDER=google을 설정하세요." });
    }
    const keywords = parseKeywords(req.body?.keywords);
    if (keywords.length === 0) {
        return res.status(400).json({ success: false, message: "키워드를 입력하세요." });
    }
    const schedule = crawler.startSchedule({ ...req.body, keywords });
    res.json({ success: true, schedule });
});

router.delete("/schedule", (req, res) => {
    crawler.stopSchedule();
    res.json({ success: true });
});

module.exports = router;
