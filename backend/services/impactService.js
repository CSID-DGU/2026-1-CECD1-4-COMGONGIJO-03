const config = require("../config/impactModel.json");
const { lookupMediaInfluence } = require("../config/mediaInfluence");

function clamp01(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

function validateMediaScore(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function assertWeights(weights) {
    const values = Object.values(weights);
    if (!values.length || values.some(w => !Number.isFinite(w) || w < 0) ||
        Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 1e-7) {
        throw new Error("파급력 가중치는 음수가 아니며 합계가 1이어야 합니다.");
    }
}
assertWeights(config.initialWeights);
assertWeights(config.observedWeights);

function calculateInitialImpact({ riskScore, analysis, source, mediaOverride = null }) {
    const publicRelevance = clamp01(analysis.public_relevance);
    const titleSensationalism = clamp01(analysis.title_sensationalism);
    const mapped = lookupMediaInfluence(source);
    const userScore = validateMediaScore(mediaOverride);
    const llmScore = validateMediaScore(analysis.media_influence);
    // 확인되지 않은 언론사도 파급력 평가를 중단하지 않도록 보수적인 임시값 사용.
    // 실제 평가값과 구분하기 위해 origin을 fallback으로 기록합니다.
    const mediaInfluence = userScore !== null ? userScore
        : mapped !== null ? mapped
        : llmScore !== null ? llmScore
        : config.unknownMediaFallback;
    const mediaOrigin = userScore !== null ? "user"
        : mapped !== null ? "reference"
        : llmScore !== null ? "llm" : "fallback";
    const factors = {
        risk_score: clamp01(riskScore),
        public_relevance: publicRelevance,
        title_sensationalism: titleSensationalism,
        media_influence: mediaInfluence
    };
    const complete = Object.values(factors).every(v => v !== null);
    const spread = complete
        ? Object.entries(config.initialWeights).reduce((sum, [key, weight]) => sum + weight * factors[key], 0)
        : null;
    return {
        ...factors,
        initial_spread_score: spread,
        initial_impact_score: spread === null ? null : spread * factors.risk_score,
        media_influence_origin: mediaOrigin,
        impact_model_version: config.version,
        complete
    };
}

function normalizeLog(value, cap) {
    if (!Number.isFinite(cap) || cap <= 1) throw new Error("로그 정규화 상한 오류");
    return Math.max(0, Math.min(1, Math.log(Math.max(1, value)) / Math.log(cap)));
}
function normalizeLinear(value, cap) {
    if (!Number.isFinite(cap) || cap <= 0) throw new Error("선형 정규화 상한 오류");
    return Math.max(0, Math.min(1, Math.max(0, value) / cap));
}

function parseTime(value) {
    if (!value) return null;
    // DB의 DATETIME은 타임존 정보가 없으므로 같은 환경에서 일관된 UTC/KST
    // 설정을 사용해야 합니다. mysql2가 반환한 Date는 JS 날짜 그대로 사용합니다.
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
}

// 발행일이 누락된 기사의 날짜는 정확한 관측값과 구별하여 임시 추정합니다.
// 보완 우선순위: 같은 클러스터 대표기사 -> 같은 클러스터 다른 기사 ->
// 함께 조회된 연결 클러스터 기사 -> 해당 클러스터 최초 탐지일.
// 추정 날짜를 사용한 결과는 표시할 수 있지만 학습용 정답으로 자동 확정하지 않습니다.
function fillMissingPublishedDates(articles) {
    const knownByCluster = new Map();
    const allKnown = [];
    for (const a of articles) {
        const timestamp = parseTime(a.published_at);
        if (timestamp === null) continue;
        const id = Number(a.cluster_id);
        if (!knownByCluster.has(id)) knownByCluster.set(id, []);
        knownByCluster.get(id).push(timestamp);
        allKnown.push({ clusterId: id, timestamp });
    }
    function median(values) {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor((sorted.length - 1) / 2)];
    }
    const fallbackCounts = {
        cluster_representative: 0,
        same_cluster: 0,
        linked_cluster: 0,
        cluster_detected: 0
    };
    let missingDates = 0;
    let unresolvedDates = 0;
    const resolved = [];
    for (const a of articles) {
        const original = parseTime(a.published_at);
        if (original !== null) {
            resolved.push({ ...a, timestamp: original, date_source: "published_at" });
            continue;
        }
        missingDates++;
        const id = Number(a.cluster_id);
        let timestamp = parseTime(a.representative_published_at);
        let dateSource = timestamp === null ? null : "cluster_representative";
        if (timestamp === null) {
            timestamp = median(knownByCluster.get(id) || []);
            if (timestamp !== null) dateSource = "same_cluster";
        }
        if (timestamp === null) {
            // 연결 클러스터는 findClusterIds(includeLinked=true)로 조회된 경우만
            // 이 배열에 포함되므로, 조회되지 않은 사건의 날짜는 참조하지 않습니다.
            timestamp = median(allKnown.filter(x => x.clusterId !== id).map(x => x.timestamp));
            if (timestamp !== null) dateSource = "linked_cluster";
        }
        if (timestamp === null) {
            timestamp = parseTime(a.cluster_first_detected);
            if (timestamp !== null) dateSource = "cluster_detected";
        }
        if (timestamp === null) {
            unresolvedDates++;
            continue;
        }
        fallbackCounts[dateSource]++;
        resolved.push({ ...a, timestamp, date_source: dateSource });
    }
    return { resolved, missingDates, unresolvedDates, fallbackCounts };
}

function calculateObservedImpact(articles, { now = new Date(), configOverride = config } = {}) {
    const days = configOverride.observationDays;
    const windowMs = days * 24 * 3600000;
    const unique = [];
    const allIds = new Set();
    for (const a of articles) {
        if (allIds.has(a.article_id)) continue;
        allIds.add(a.article_id);
        unique.push(a);
    }
    const { resolved: valid, missingDates, unresolvedDates, fallbackCounts } =
        fillMissingPublishedDates(unique);
    valid.sort((a, b) => a.timestamp - b.timestamp || Number(a.article_id) - Number(b.article_id));
    const estimatedDates = missingDates - unresolvedDates;
    if (!valid.length) {
        return { status: "incomplete", reason: "published_at_missing", counts: null,
            normalized: null, observed_spread_score: null, observed_impact_score: null,
            first_published_at: null, missing_dates: missingDates, unresolved_dates: unresolvedDates,
            estimated_dates: estimatedDates, date_fallbacks: fallbackCounts, missing_sources: 0,
            normalization_version: configOverride.normalizationVersion, observation_days: days };
    }
    const firstTime = valid[0].timestamp;
    const until = firstTime + windowMs;
    const windowArticles = valid.filter(a => a.timestamp >= firstTime && a.timestamp < until);
    const sources = new Set();
    const { normalizeSource } = require("../config/mediaInfluence");
    let missingSources = 0;
    for (const a of windowArticles) {
        const key = normalizeSource(a.source);
        if (key) sources.add(key);
        else missingSources++;
    }
    const last = windowArticles[windowArticles.length - 1].timestamp;
    const counts = {
        news_count: windowArticles.length,
        source_count: sources.size,
        duration_hours: (last - firstTime) / 3600000,
        first_24h_count: windowArticles.filter(a => a.timestamp < firstTime + 86400000).length
    };
    const caps = configOverride.observedCaps;
    const normalized = {
        news_count: normalizeLog(counts.news_count, caps.news_count),
        source_count: normalizeLog(counts.source_count, caps.source_count),
        duration_hours: normalizeLinear(counts.duration_hours, caps.duration_hours),
        first_24h_count: normalizeLog(counts.first_24h_count, caps.first_24h_count)
    };
    const spread = Object.entries(configOverride.observedWeights)
        .reduce((sum, [key, weight]) => sum + weight * normalized[key], 0);
    const firstRisk = clamp01(valid[0].risk_score);
    const nowTime = parseTime(now);
    const elapsed = nowTime !== null && nowTime >= until;
    // 누락을 모두 보완했더라도 추정 날짜는 별도 수동 검토를 요구합니다.
    // 미해결 누락이나 언론사 미확인은 학습 정답으로 확정할 수 없습니다.
    const status = unresolvedDates || missingSources ? "incomplete"
        : !elapsed ? "observing"
        : estimatedDates ? "estimated_review" : "ready_for_review";
    return {
        status,
        reason: missingDates ? "published_at_missing" : missingSources ? "source_missing" : null,
        counts, normalized,
        observed_spread_score: spread,
        observed_impact_score: firstRisk === null ? null : firstRisk * spread,
        first_article_id: valid[0].article_id,
        first_risk_score: firstRisk,
        first_published_at: new Date(firstTime).toISOString(),
        observation_ends_at: new Date(until).toISOString(),
        missing_dates: missingDates,
        unresolved_dates: unresolvedDates,
        estimated_dates: estimatedDates,
        date_fallbacks: fallbackCounts,
        missing_sources: missingSources,
        normalization_version: configOverride.normalizationVersion,
        observation_days: days,
        data_coverage_verified: false
    };
}

module.exports = { calculateInitialImpact, calculateObservedImpact, normalizeLog, normalizeLinear, assertWeights };
