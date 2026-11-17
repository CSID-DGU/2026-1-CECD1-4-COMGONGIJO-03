// 화면에서 실행하는 뉴스 수집 관리
//  - 수동 실행: 한 번에 하나만 실행 (구글 요청 과다 방지)
//  - 자동 수집: 설정한 간격마다 반복 실행 (서버가 켜져 있는 동안)
//      화면에서 켜거나, .env 에 CRAWL_KEYWORDS 를 넣으면 서버 시작 시 자동으로 켜짐
//        CRAWL_KEYWORDS=서울교통공사,지하철 파업
//        CRAWL_INTERVAL_SEC=600   (기본 600초, 최소 300초)
//        CRAWL_WHEN=1d            (기본 1d)
//        CRAWL_LIMIT=10           (키워드당 기사 수, 기본 10)

const { crawlOnce } = require("../crawler");

const state = {
    running: false,
    stopRequested: false,
    schedule: null, // { keywords, when, limit, intervalSec, nextRunAt, lastRunAt, lastStats, timer }
};

function isRunning() {
    return state.running;
}

function requestStop() {
    if (state.running) state.stopRequested = true;
}

async function runCrawl({ keywords, when, limit, dryRun, onEvent }) {
    if (state.running) throw new Error("이미 수집이 진행 중입니다. 끝난 뒤 다시 시도하세요.");

    state.running = true;
    state.stopRequested = false;
    try {
        return await crawlOnce(keywords, {
            when: when || null,
            limit: Number(limit) || 10,
            dryRun: !!dryRun,
            useSeen: !dryRun, // 미리보기는 매번 새로 보여주고, 저장 모드만 중복 건너뛰기
            onEvent,
            shouldStop: () => state.stopRequested,
        });
    } finally {
        state.running = false;
        state.stopRequested = false;
    }
}

// ---------------------------------------------------------------------------
// 자동 수집
// ---------------------------------------------------------------------------
function getSchedule() {
    if (!state.schedule) return null;
    const { timer, ...rest } = state.schedule;
    return rest;
}

async function scheduledTick() {
    const s = state.schedule;
    if (!s) return;

    s.nextRunAt = new Date(Date.now() + s.intervalSec * 1000).toISOString();
    if (state.running) return; // 수동 수집 중이면 이번 회차는 건너뜀

    try {
        const { stats } = await runCrawl({ keywords: s.keywords, when: s.when, limit: s.limit, dryRun: false });
        s.lastStats = stats;
        s.lastError = null;
    } catch (err) {
        s.lastError = err.message;
    }
    s.lastRunAt = new Date().toISOString();
}

function startSchedule({ keywords, when, limit, intervalSec }) {
    stopSchedule();
    const sec = Math.max(300, Number(intervalSec) || 600); // 최소 5분
    state.schedule = {
        keywords,
        when: when || "1d",
        limit: Number(limit) || 10,
        intervalSec: sec,
        startedAt: new Date().toISOString(),
        nextRunAt: new Date().toISOString(),
        lastRunAt: null,
        lastStats: null,
        lastError: null,
        timer: setInterval(scheduledTick, sec * 1000),
    };
    scheduledTick(); // 시작하자마자 1회 실행
    return getSchedule();
}

function stopSchedule() {
    if (state.schedule) clearInterval(state.schedule.timer);
    state.schedule = null;
}

/** 서버 시작 시 .env 의 CRAWL_KEYWORDS 가 있으면 자동 수집 시작 */
function startScheduleFromEnv() {
    const keywords = String(process.env.CRAWL_KEYWORDS || "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
    if (keywords.length === 0) return null;

    const schedule = startSchedule({
        keywords,
        when: process.env.CRAWL_WHEN,
        limit: process.env.CRAWL_LIMIT,
        intervalSec: process.env.CRAWL_INTERVAL_SEC,
    });
    console.log(`[CRAWLER] 자동 수집 시작: ${keywords.join(", ")} (${schedule.intervalSec}초 간격)`);
    return schedule;
}

module.exports = {
    runCrawl,
    requestStop,
    isRunning,
    getSchedule,
    startSchedule,
    stopSchedule,
    startScheduleFromEnv,
};
