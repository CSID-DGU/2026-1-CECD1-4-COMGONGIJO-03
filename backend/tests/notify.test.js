// 알림(ntfy) 테스트 - DB 와 ntfy 서버를 가짜로 바꿔서 실행
const assert = require("assert");
const path = require("path");

const queries = [];
require.cache[path.resolve(__dirname, "../db.js")] = {
    exports: {
        query: async (sql, params) => {
            queries.push([sql, params]);
            if (sql.includes("FROM articles")) return [[{ title: "2호선 <사고>", source: "연합뉴스", url: "https://www.yna.co.kr/1" }]];
            return [[]];
        },
    },
};

const sent = [];
let failNext = false;
global.fetch = async (url, opt) => {
    sent.push({ url, headers: opt.headers, body: JSON.parse(opt.body) });
    if (failNext) return { ok: false, status: 500, text: async () => "boom" };
    return { ok: true, status: 200 };
};

Object.assign(process.env, { NTFY_TEST_ENABLED: "true", NTFY_SERVER: "https://ntfy.sh", NTFY_TOPIC: "comgongijo-test", NTFY_TOKEN: "tk", DASHBOARD_URL: "https://demo.example/" });
const notify = require("../services/notifyService");

(async () => {
    // 1) 위험 알림: DB 에서 기사 정보를 채우고, 발송 후 sent 로 갱신
    await notify.notifyRiskAlert({ alert_id: 7, article_id: 42, alert_topic: "2호선 사고 책임 논란", alert_message: "공사 책임론 확산", risk_score: 0.88 });
    const b = sent[0].body;
    assert.strictEqual(sent[0].url, "https://ntfy.sh");
    assert.strictEqual(sent[0].headers.Authorization, "Bearer tk");
    assert.strictEqual(b.topic, "comgongijo-test");
    assert.strictEqual(b.title, "🔴 [심각] 2호선 사고 책임 논란");
    assert.ok(b.message.startsWith("[연합뉴스] 2호선 <사고>"));
    assert.strictEqual(b.priority, 5);
    assert.strictEqual(b.click, "https://demo.example/?page=alerts&article=42");
    assert.strictEqual(b.actions[0].url, "https://www.yna.co.kr/1");
    assert.deepStrictEqual(queries.at(-1)[1], ["sent", 7]);

    // 2) 발송 실패 시 failed 로 갱신
    failNext = true;
    await notify.notifyRiskAlert({ alert_id: 8, article_id: 1, title: "t", risk_score: 0.65 });
    assert.deepStrictEqual(queries.at(-1)[1], ["failed", 8]);
    assert.strictEqual(sent.at(-1).body.priority, 3);
    failNext = false;

    // 3) 테스트 알림은 DB 를 쓰지 않음
    const before = queries.length;
    await notify.sendTestNotification();
    assert.strictEqual(queries.length, before);
    assert.ok(sent.at(-1).body.title.includes("테스트 알림"));

    console.log("✔ 알림(ntfy) 테스트 통과");
})().catch((e) => { console.error(e); process.exit(1); });
