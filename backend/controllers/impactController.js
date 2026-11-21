const articleRepository = require("../repositories/articleRepository");
const repository = require("../repositories/impactRepository");
const { calculateInitialImpact } = require("../services/impactService");
const { evaluateClusterImpact } = require("../services/clusterImpactService");
const config = require("../config/impactModel.json");

function parseId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function validStep(value) {
    return typeof value === "number" && Number.isFinite(value) &&
        value >= 0 && value <= 1 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;
}
function parseBoolean(value) { return value === "true" || value === true; }

async function feedback(req, res, save) {
    const id = parseId(req.params.article_id);
    if (!id) return res.status(400).json({ success: false, message: "올바르지 않은 기사 ID입니다." });
    try {
        const article = await articleRepository.findByIdWithAnalysis(id);
        if (!article) return res.status(404).json({ success: false, message: "기사가 없습니다." });
        if (article.analysis_id == null) return res.status(409).json({ success: false, message: "분석이 필요합니다." });
        if (save) {
            const keys = Object.keys(req.body || {});
            if (keys.some(k => k !== "factor_labels") ||
                !req.body?.factor_labels || typeof req.body.factor_labels !== "object" ||
                Array.isArray(req.body.factor_labels)) {
                return res.status(400).json({ success: false, message: "factor_labels 객체가 필요합니다." });
            }
            const labels = req.body.factor_labels;
            const allowed = ["public_relevance", "title_sensationalism", "media_influence"];
            if (!Object.keys(labels).length || Object.entries(labels).some(([k, v]) => !allowed.includes(k) || !validStep(v))) {
                return res.status(400).json({ success: false, message: "허용된 지표를 0.1 단위로 입력해야 합니다." });
            }
            if (labels.media_influence !== undefined && !article.source) {
                return res.status(400).json({ success: false, message: "언론사 정보가 없습니다." });
            }
            const previous = await repository.getFeedback(id);
            const previousLabels = previous?.factor_labels
                ? (typeof previous.factor_labels === "string" ? JSON.parse(previous.factor_labels) : previous.factor_labels)
                : {};
            await repository.saveFeedback(id, { ...previousLabels, ...labels });
            if (labels.media_influence !== undefined) {
                await repository.saveMediaOverride(article.source, labels.media_influence);
            }
        }
        const row = await repository.getFeedback(id);
        const labels = row?.factor_labels ? (typeof row.factor_labels === "string" ? JSON.parse(row.factor_labels) : row.factor_labels) : {};
        const preview = calculateInitialImpact({
            riskScore: article.risk_score,
            source: article.source,
            analysis: {
                public_relevance: labels.public_relevance ?? article.public_relevance,
                title_sensationalism: labels.title_sensationalism ?? article.title_sensationalism,
                media_influence: labels.media_influence ?? article.media_influence
            },
            mediaOverride: labels.media_influence ?? await repository.getMediaOverride(article.source)
        });
        return res.json({ success: true, factor_labels: labels,
            raw: { public_relevance: article.public_relevance,
                title_sensationalism: article.title_sensationalism,
                media_influence: article.media_influence },
            preview, model_score: article.initial_impact_score,
            updated_at: row?.updated_at || null });
    } catch (error) {
        console.error("Impact feedback:", error);
        return res.status(500).json({ success: false, message: "파급력 피드백 처리 실패" });
    }
}

async function clusterImpact(req, res, persist = false) {
    const id = parseId(req.params.cluster_id);
    if (!id) return res.status(400).json({ success: false, message: "올바르지 않은 클러스터 ID입니다." });
    try {
        const includeLinked = parseBoolean((persist ? req.body : req.query)?.include_linked);
        const result = await evaluateClusterImpact(id, { includeLinked, persist });
        if (!result) return res.status(404).json({ success: false, message: "클러스터가 없습니다." });
        return res.json({ success: true, ...result });
    } catch (error) {
        console.error("Cluster impact:", error);
        return res.status(500).json({ success: false, message: "사후 파급력 조회 실패" });
    }
}

async function confirm(req, res) {
    const id = parseId(req.params.cluster_id);
    if (!id) return res.status(400).json({ success: false, message: "올바르지 않은 클러스터 ID입니다." });
    if (req.body?.confirm !== true) return res.status(400).json({ success: false, message: "confirm: true가 필요합니다." });
    try {
        const includeLinked = parseBoolean(req.body.include_linked);
        const result = await evaluateClusterImpact(id, { includeLinked, persist: true });
        if (!result) return res.status(404).json({ success: false, message: "클러스터가 없습니다." });
        if (!["ready_for_review", "estimated_review"].includes(result.metrics.status)) {
            return res.status(409).json({ success: false, message: "관측 기간과 발행 시각·언론사 정보를 먼저 확인해야 합니다.", status: result.metrics.status });
        }
        if (result.metrics.status === "estimated_review" && req.body?.accept_estimated_dates !== true) {
            return res.status(409).json({
                success: false,
                message: "발행일자 추정값이 포함되어 있습니다. 원본 보도와 클러스터 범위를 수동 검토한 뒤 명시적으로 승인해야 합니다.",
                estimated_dates: result.metrics.estimated_dates
            });
        }
        const confirmed = await repository.confirmSnapshot(id, config.observationDays);
        return res.json({ success: confirmed, message: confirmed ? "검토된 관측값을 학습용으로 확정했습니다." : "확정할 스냅샷이 없습니다." });
    } catch (error) {
        console.error("Impact confirm:", error);
        return res.status(500).json({ success: false, message: "학습용 관측값 확정 실패" });
    }
}

module.exports = {
    getFeedback: (req, res) => feedback(req, res, false),
    putFeedback: (req, res) => feedback(req, res, true),
    getClusterImpact: (req, res) => clusterImpact(req, res),
    recalculateClusterImpact: (req, res) => clusterImpact(req, res, true),
    confirmClusterImpact: confirm
};
