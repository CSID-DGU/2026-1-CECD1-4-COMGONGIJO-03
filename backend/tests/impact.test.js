const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateInitialImpact, calculateObservedImpact, normalizeLog, normalizeLinear } = require("../services/impactService");
const { lookupMediaInfluence } = require("../config/mediaInfluence");
const { readFileSync } = require("node:fs");
const path = require("node:path");

function article(id, published_at, source, risk_score = 0.8) {
    return { article_id: id, published_at, source, risk_score };
}

test("초기 파급력: 위험도*초기 확산규모, 알려진 언론사 고정 매핑", () => {
    const result = calculateInitialImpact({ riskScore: 0.8, source: "MBC",
        analysis: { public_relevance: 0.6, title_sensationalism: 0.4, media_influence: 0.1 } });
    assert.equal(result.media_influence, 1);
    assert.equal(result.media_influence_origin, "reference");
    assert.equal(result.initial_spread_score, 0.7);
    assert.ok(Math.abs(result.initial_impact_score - 0.56) < 1e-10);
});

test("사용자 언론사 평가가 고정표보다 우선", () => {
    const result = calculateInitialImpact({ riskScore: 0.5, source: "KBS", mediaOverride: 0.6,
        analysis: { public_relevance: 0.5, title_sensationalism: 0.5, media_influence: 0.8 } });
    assert.equal(result.media_influence, 0.6);
    assert.equal(result.media_influence_origin, "user");
});

test("일반 지표 누락은 null 유지, 미확인 언론사만 임시 0.3 적용", () => {
    const result = calculateInitialImpact({ riskScore: 0.5, source: "", analysis: {
        public_relevance: null, title_sensationalism: 0.5, media_influence: null
    }});
    assert.equal(result.complete, false);
    assert.equal(result.initial_spread_score, null);
    assert.equal(result.public_relevance, null);
    assert.equal(result.media_influence, 0.3);
    assert.equal(result.media_influence_origin, "fallback");
});

test("미등록 언론사를 LLM도 평가하지 못해도 초기 파급력이 계산됨", () => {
    const result = calculateInitialImpact({ riskScore: 0.8, source: "알려지지 않은 언론", analysis: {
        public_relevance: 0.6, title_sensationalism: 0.4, media_influence: null
    }});
    assert.equal(result.media_influence, 0.3);
    assert.equal(result.media_influence_origin, "fallback");
    assert.equal(result.complete, true);
    assert.ok(Math.abs(result.initial_spread_score - 0.525) < 1e-10);
    assert.ok(Math.abs(result.initial_impact_score - 0.42) < 1e-10);
});

test("미등록 언론사의 유효한 LLM 점수는 임시값보다 우선", () => {
    const result = calculateInitialImpact({ riskScore: 0.5, source: "새로운매체", analysis: {
        public_relevance: 0.5, title_sensationalism: 0.5, media_influence: 0.7
    }});
    assert.equal(result.media_influence, 0.7);
    assert.equal(result.media_influence_origin, "llm");
});

test("LLM이 범위 밖 점수를 주면 임시값 적용, 정상 0점은 유지", () => {
    for (const value of ["unknown", -0.5, 1.5]) {
        const bad = calculateInitialImpact({ riskScore: 0.5, source: "미등록매체", analysis: {
            public_relevance: 0.5, title_sensationalism: 0.5, media_influence: value
        }});
        assert.equal(bad.media_influence, 0.3);
        assert.equal(bad.media_influence_origin, "fallback");
    }
    const zero = calculateInitialImpact({ riskScore: 0.5, source: "미등록매체", analysis: {
        public_relevance: 0.5, title_sensationalism: 0.5, media_influence: 0
    }});
    assert.equal(zero.media_influence, 0);
    assert.equal(zero.media_influence_origin, "llm");
});

test("언론사 등급 매핑은 연합뉴스와 연합뉴스TV를 혼동하지 않음", () => {
    assert.equal(lookupMediaInfluence("연합뉴스TV"), 0.8);
    assert.equal(lookupMediaInfluence("연합뉴스"), null);
    assert.equal(lookupMediaInfluence("네이버"), null);
});

test("로그/선형 정규화의 경계값", () => {
    assert.equal(normalizeLog(1, 30), 0);
    assert.equal(normalizeLog(30, 30), 1);
    assert.equal(normalizeLog(300, 30), 1);
    assert.equal(normalizeLinear(0, 168), 0);
    assert.equal(normalizeLinear(168, 168), 1);
});

test("7일 이내 기사만 계산, 24시간 시간 경계 제외, 언론사 중복 제거", () => {
    const result = calculateObservedImpact([
        article(1, "2026-11-01T00:00:00Z", "MBC"),
        article(2, "2026-11-01T12:00:00Z", "MBC"),
        article(3, "2026-11-02T00:00:00Z", "SBS"),
        article(4, "2026-11-07T00:00:00Z", "JTBC"),
        article(5, "2026-11-08T00:00:00Z", "YTN")
    ], { now: new Date("2026-11-12T00:00:00Z") });
    assert.equal(result.counts.news_count, 4);
    assert.equal(result.counts.source_count, 3);
    assert.equal(result.counts.first_24h_count, 2);
    assert.equal(result.counts.duration_hours, 144);
    assert.equal(result.status, "ready_for_review");
});

test("관측 기간 진행 중에는 학습 정답 확정 대상이 아님", () => {
    const r = calculateObservedImpact([article(1, "2026-11-20T00:00:00Z", "MBC")],
        { now: new Date("2026-11-21T00:00:00Z") });
    assert.equal(r.status, "observing");
});

test("발행일·언론사 누락은 학습 불완전으로 분류", () => {
    const r = calculateObservedImpact([
        article(1, "2026-11-01T00:00:00Z", "MBC"),
        article(2, null, "SBS"),
        article(3, "2026-11-01T12:00:00Z", null)
    ], { now: new Date("2026-11-12T00:00:00Z") });
    assert.equal(r.status, "incomplete");
    assert.equal(r.missing_dates, 1);
    assert.equal(r.missing_sources, 1);
});

test("발행일이 없는 기사는 같은 클러스터의 발행일을 우선 사용하지만 학습 확정은 금지", () => {
    const r = calculateObservedImpact([
        { ...article(1, "2026-11-01T00:00:00Z", "MBC"), cluster_id: 10 },
        { ...article(2, null, "SBS"), cluster_id: 10 },
        { ...article(3, "2026-11-01T12:00:00Z", "YTN"), cluster_id: 20 }
    ], { now: new Date("2026-11-12T00:00:00Z") });
    assert.equal(r.counts.news_count, 3);
    assert.equal(r.missing_dates, 1);
    assert.equal(r.estimated_dates, 1);
    assert.equal(r.unresolved_dates, 0);
    assert.equal(r.date_fallbacks.same_cluster, 1);
    assert.equal(r.status, "estimated_review");
});

test("같은 클러스터의 날짜가 없으면 함께 조회된 연결 클러스터의 날짜를 참조", () => {
    const r = calculateObservedImpact([
        { ...article(1, null, "MBC"), cluster_id: 20 },
        { ...article(2, "2026-11-01T00:00:00Z", "SBS"), cluster_id: 10 }
    ], { now: new Date("2026-11-12T00:00:00Z") });
    assert.equal(r.counts.news_count, 2);
    assert.equal(r.date_fallbacks.linked_cluster, 1);
    assert.equal(r.status, "estimated_review");
});

test("원본 날짜가 모두 없으면 클러스터 최초 탐지일로 임시 계산", () => {
    const r = calculateObservedImpact([
        { ...article(1, null, "MBC"), cluster_id: 10, cluster_first_detected: "2026-11-01T00:00:00Z" },
        { ...article(2, null, "SBS"), cluster_id: 10, cluster_first_detected: "2026-11-01T00:00:00Z" }
    ], { now: new Date("2026-11-12T00:00:00Z") });
    assert.equal(r.counts.news_count, 2);
    assert.equal(r.date_fallbacks.cluster_detected, 2);
    assert.equal(r.estimated_dates, 2);
    assert.equal(r.status, "estimated_review");
});

test("대표기사 발행일이 있으면 연결 클러스터 날짜보다 우선", () => {
    const r = calculateObservedImpact([
        { ...article(1, null, "MBC"), cluster_id: 20, representative_published_at: "2026-11-01T10:00:00Z" },
        { ...article(2, "2026-11-01T00:00:00Z", "SBS"), cluster_id: 10 }
    ], { now: new Date("2026-11-12T00:00:00Z") });
    assert.equal(r.counts.news_count, 2);
    assert.equal(r.date_fallbacks.cluster_representative, 1);
});

test("발행일과 추정 기준이 모두 없다면 계산에서 제외하고 누락 여부 유지", () => {
    const r = calculateObservedImpact([
        { ...article(1, null, "MBC"), cluster_id: 10 }
    ], { now: new Date("2026-11-12T00:00:00Z") });
    assert.equal(r.counts, null);
    assert.equal(r.unresolved_dates, 1);
    assert.equal(r.estimated_dates, 0);
});

test("발행일자를 보완해도 언론사가 누락되면 학습 검토 불가", () => {
    const r = calculateObservedImpact([
        { ...article(1, "2026-11-01T00:00:00Z", "MBC"), cluster_id: 10 },
        { ...article(2, null, null), cluster_id: 10 }
    ], { now: new Date("2026-11-12T00:00:00Z") });
    assert.equal(r.status, "incomplete");
    assert.equal(r.estimated_dates, 1);
    assert.equal(r.missing_sources, 1);
});

test("추정 날짜가 있고 관측 기간이 진행 중이면 observing", () => {
    const r = calculateObservedImpact([
        { ...article(1, "2026-11-20T00:00:00Z", "MBC"), cluster_id: 10 },
        { ...article(2, null, "SBS"), cluster_id: 10 }
    ], { now: new Date("2026-11-21T00:00:00Z") });
    assert.equal(r.status, "observing");
    assert.equal(r.estimated_dates, 1);
});

test("기존 SQL의 INSERT 변수 개수와 값 개수 확인", async () => {
    const dbPath = require.resolve("../db");
    const repositoryPath = require.resolve("../repositories/analysisRepository");
    const dbStub = { query: async (sql, values) => {
        const statement = sql.slice(sql.indexOf("VALUES"));
        assert.equal((statement.match(/\?/g) || []).length, values.length);
        return [{ insertId: 3 }];
    }};
    const previousDb = require.cache[dbPath];
    const previousRepo = require.cache[repositoryPath];
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
    delete require.cache[repositoryPath];
    try {
        const repo = require("../repositories/analysisRepository");
        await repo.insertFullAnalysis({ articleId: 1, clusterId: 2,
            analysis: { target_related: true }, riskScore: 0.2, clusterKey: "x",
            calibratedFactors: {}, riskModelVersion: "v1", articleEmbedding: null,
            impact: { media_influence: 0.5, public_relevance: 0.5, title_sensationalism: 0.5,
                initial_spread_score: 0.5, initial_impact_score: 0.1,
                media_influence_origin: "llm", impact_model_version: "test" }
        });
    } finally {
        if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
        if (previousRepo) require.cache[repositoryPath] = previousRepo; else delete require.cache[repositoryPath];
    }
});
