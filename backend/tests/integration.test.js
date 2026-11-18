const assert = require("node:assert/strict");
const { once } = require("node:events");
const { test } = require("node:test");

test("cluster rules, concurrent deduplication and ntfy failure isolation", async () => {
    const events = [];
    let lock = Promise.resolve();
    let alertId;
    let attempts = 0;
    require.cache[require.resolve("../db")] = {
        exports: {
            async getConnection() {
                let unlock;
                return {
                    async beginTransaction() {},
                    async query(sql) {
                        if (sql.includes("FOR UPDATE")) {
                            const previous = lock;
                            lock = new Promise((resolve) => { unlock = resolve; });
                            await previous;
                            return [[]];
                        }
                        if (sql.includes("FROM alerts")) {
                            return [alertId ? [{ alert_id: alertId }] : []];
                        }
                        assert.match(sql, /INSERT INTO alerts/);
                        alertId = 7;
                        events.push("insert");
                        return [{ insertId: alertId }];
                    },
                    async commit() { events.push("commit"); },
                    async rollback() {},
                    release() { unlock?.(); },
                };
            },
        },
    };
    let failDelivery;
    require.cache[require.resolve("../services/notifyService")] = {
        exports: {
            notifyRiskAlert() {
                attempts++;
                assert.deepEqual(events.slice(0, 2), ["insert", "commit"]);
                return new Promise((resolve, reject) => { failDelivery = reject; });
            },
        },
    };
    const { createClusterAlertIfNeeded } = require("../services/alertService");
    const input = {
        articleId: 1,
        clusterId: 2,
        analysis: { target_related: true, alert_topic: "test" },
        riskScore: 0.6,
    };
    for (const excluded of [
        { ...input, analysis: { ...input.analysis, target_related: false } },
        { ...input, clusterId: null },
        { ...input, riskScore: 0.59 },
        { ...input, analysis: { target_related: true } },
    ]) {
        assert.deepEqual(await createClusterAlertIfNeeded(excluded), { alertCreated: false, alertId: null });
    }
    const results = await Promise.all([
        createClusterAlertIfNeeded(input),
        createClusterAlertIfNeeded({ ...input, articleId: 2 }),
    ]);
    assert.deepEqual(results, [
        { alertCreated: true, alertId: 7 },
        { alertCreated: false, alertId: 7 },
    ]);
    assert.equal(attempts, 1);
    failDelivery(new Error("mock delivery failure"));
    await new Promise(setImmediate);
});

test("crawler streams progress and guards automatic scheduling", async (t) => {
    const express = require("express");
    const envProvider = process.env.CRAWLER_PROVIDER;
    const crawlerModule = require.resolve("../crawler");
    require.cache[crawlerModule] = {
        exports: {
            async crawlOnce(keywords, { onEvent, shouldStop }) {
                onEvent?.("start", { keywords });
                await new Promise(setImmediate);
                assert.equal(shouldStop(), false);
                onEvent?.("progress", { index: 1, total: 1 });
                onEvent?.("done", { stats: { total: 1 } });
                return { stats: { total: 1 } };
            },
        },
    };
    const app = express();
    app.use(express.json());
    app.use("/api/crawler", require("../routes/crawlerRoutes"));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api/crawler`;
    t.after(() => {
        if (envProvider === undefined) delete process.env.CRAWLER_PROVIDER;
        else process.env.CRAWLER_PROVIDER = envProvider;
        server.close();
    });

    for (const provider of ["naver", "none"]) {
        process.env.CRAWLER_PROVIDER = provider;
        const response = await fetch(base + "/schedule", { method: "POST" });
        assert.equal(response.status, 409);
    }
    const stream = await fetch(base + "/stream?keywords=test&dryRun=1");
    assert.match(stream.headers.get("content-type"), /^text\/event-stream/);
    assert.equal(stream.headers.get("x-accel-buffering"), "no");
    assert.match(await stream.text(), /event: start[\s\S]+event: progress[\s\S]+event: done/);

    process.env.CRAWLER_PROVIDER = "google";
    const scheduled = await fetch(base + "/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: ["test"], intervalSec: 20 }),
    });
    assert.equal(scheduled.status, 200);
    assert.equal((await scheduled.json()).schedule.intervalSec, 300);
    t.after(() => require("../services/crawlerService").stopSchedule());
    assert.equal((await fetch(base + "/schedule", { method: "DELETE" })).status, 200);
});
