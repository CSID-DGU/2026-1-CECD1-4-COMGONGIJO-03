const RISK_WEIGHTS = Object.freeze({
    media_influence: 0.0462,
    issue_severity: 0.2264,
    target_responsibility: 0.2738,
    norm_violation: 0.3485,
    similar_crisis_history: 0.1050
});

const WEIGHT_SUM =
    Object.values(RISK_WEIGHTS)
        .reduce((sum, value) => sum + value, 0);

function clamp01(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return 0;
    }

    return Math.max(0, Math.min(1, number));
}

function calculateRiskScore(analysis) {
    const weightedScore =
        clamp01(analysis.media_influence) *
            RISK_WEIGHTS.media_influence +
        clamp01(analysis.issue_severity) *
            RISK_WEIGHTS.issue_severity +
        clamp01(analysis.target_responsibility) *
            RISK_WEIGHTS.target_responsibility +
        clamp01(analysis.norm_violation) *
            RISK_WEIGHTS.norm_violation +
        clamp01(analysis.similar_crisis_history) *
            RISK_WEIGHTS.similar_crisis_history;

    return weightedScore / WEIGHT_SUM;
}

module.exports = {
    RISK_WEIGHTS,
    calculateRiskScore
};