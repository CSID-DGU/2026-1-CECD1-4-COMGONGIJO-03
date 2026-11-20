const articleRepository =
    require("../repositories/articleRepository");

const feedbackRepository =
    require("../repositories/riskFeedbackRepository");

const {
    RISK_FACTORS,
    RISK_WEIGHTS,
    calibrateFactors,
    scoreCalibratedFactors
} = require("../services/riskService");

function parseLabels(raw) {
    if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw)
    ) {
        throw new Error("factor_labels must be an object");
    }

    const labels = {};

    for (const [key, value] of Object.entries(raw)) {
        if (!RISK_FACTORS.includes(key)) {
            throw new Error(`Unknown factor: ${key}`);
        }

        if (
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            value < 0 ||
            value > 1 ||
            Math.abs(value * 10 - Math.round(value * 10)) > 1e-8
        ) {
            throw new Error(
                `Invalid label: ${key} (0..1, step 0.1)`
            );
        }

        labels[key] = value;
    }

    return labels;
}

function parseOverall(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1 ||
        Math.abs(value * 10 - Math.round(value * 10)) > 1e-8
    ) {
        throw new Error(
            "overall_label must be null or 0..1, step 0.1"
        );
    }

    return value;
}

async function handleFeedback(req, res, shouldSave) {
    const id = Number(req.params.article_id);

    if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({
            success: false,
            message: "잘못된 기사 ID입니다."
        });
    }

    try {
        const article =
            await articleRepository.findByIdWithAnalysis(id);

        if (!article) {
            return res.status(404).json({
                success: false,
                message: "기사를 찾을 수 없습니다."
            });
        }

        if (article.analysis_id == null) {
            return res.status(409).json({
                success: false,
                message: "AI 분석 완료 후 평가할 수 있습니다."
            });
        }

        if (shouldSave) {
            const keys = Object.keys(req.body || {});

            if (keys.some(key =>
                !["factor_labels", "overall_label"].includes(key)
            )) {
                return res.status(400).json({
                    success: false,
                    message: "허용되지 않은 피드백 필드입니다."
                });
            }

            const factorLabels =
                parseLabels(req.body.factor_labels ?? {});

            const overallLabel =
                parseOverall(req.body.overall_label);

            if (
                Object.keys(factorLabels).length === 0 &&
                overallLabel == null
            ) {
                return res.status(400).json({
                    success: false,
                    message: "최소 하나의 정답이 필요합니다."
                });
            }

            await feedbackRepository.save(
                id,
                factorLabels,
                overallLabel
            );
        }

        const row =
            await feedbackRepository.findByArticleId(id);

        const storedLabels = row?.factor_labels;

        const factorLabels =
            typeof storedLabels === "string"
                ? JSON.parse(storedLabels)
                : storedLabels || {};

        const calibrated = article.risk_calibrated_factors;

        const calibratedFactors =
            typeof calibrated === "string"
                ? JSON.parse(calibrated)
                : calibrated || calibrateFactors(article);

        const previewFactors = {
            ...calibratedFactors,
            ...factorLabels
        };

        return res.json({
            success: true,
            factor_labels: factorLabels,
            overall_label:
                row?.overall_label == null
                    ? null
                    : Number(row.overall_label),
            raw_factors: Object.fromEntries(
                RISK_FACTORS.map(key => [
                    key,
                    Number(article[key]) || 0
                ])
            ),
            calibrated_factors: calibratedFactors,
            preview_score:
                scoreCalibratedFactors(previewFactors),
            model_score: Number(article.risk_score) || 0,
            weights: RISK_WEIGHTS,
            model_version:
                article.risk_model_version || "legacy",
            updated_at: row?.updated_at || null
        });
    } catch (error) {
        if (
            error.message.startsWith("Unknown factor") ||
            error.message.startsWith("Invalid label") ||
            error.message.includes("must be")
        ) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        console.error("Risk feedback error:", error);

        return res.status(500).json({
            success: false,
            message: "위험도 피드백 처리 실패"
        });
    }
}

exports.get = (req, res) =>
    handleFeedback(req, res, false);

exports.put = (req, res) =>
    handleFeedback(req, res, true);