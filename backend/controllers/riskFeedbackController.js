const articleRepository = require("../repositories/articleRepository");
const repository = require("../repositories/riskWeightRepository");
const { completeFactors } = require("../services/riskModelService");

async function handleFeedback(req, res, save) {
    const id = Number(req.params.article_id);
    if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: "잘못된 기사 ID입니다." });
    }
    try {
        const article = await articleRepository.findByIdWithAnalysis(id);
        if (!article) return res.status(404).json({ success: false, message: "기사를 찾을 수 없습니다." });
        const raw = completeFactors(article);
        const eligible = Boolean(raw && article.analysis_status === "completed" &&
            article.analysis_id && article.cluster_id && article.risk_model_version &&
            typeof article.risk_score === "number" && Number.isFinite(article.risk_score) &&
            Number(article.spam_override ?? article.target_related) === 1);
        if (save) {
            const { overall_label: label, analysis_id: analysisId } = req.body || {};
            if (Object.keys(req.body || {}).some(key => !["overall_label", "analysis_id"].includes(key)) ||
                typeof label !== "number" || !Number.isFinite(label) || label < 0 || label > 1 ||
                Math.abs(label * 10 - Math.round(label * 10)) > 1e-8) {
                return res.status(400).json({
                    success: false, message: "전체 위험도를 0부터 1까지 0.1 단위로 입력하세요."
                });
            }
            if (!eligible || (analysisId != null && analysisId !== article.analysis_id)) {
                return res.status(409).json({
                    success: false, message: "현재 분석 결과를 다시 열고 사건에 속한 분석 완료 기사에 평가를 입력하세요."
                });
            }
            await repository.saveFeedback(article, label, raw);
        }
        const row = eligible ? await repository.findFeedback(id, article.analysis_id) : null;
        return res.json({
            success: true, eligible, analysis_id: article.analysis_id,
            overall_label: row ? Number(row.overall_label) : null,
            model_score: article.risk_score, model_version: article.risk_model_version,
            raw_factors: raw, updated_at: row?.updated_at ?? null
        });
    } catch (error) {
        console.error("Risk feedback error:", error.message);
        return res.status(500).json({ success: false, message: "위험도 피드백 처리 실패" });
    }
}

exports.get = (req, res) => handleFeedback(req, res, false);
exports.put = (req, res) => handleFeedback(req, res, true);
