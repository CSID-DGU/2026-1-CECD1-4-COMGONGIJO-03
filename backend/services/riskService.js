const model = require("../config/riskModel.json");

const RISK_FACTORS = Object.freeze([
    "issue_severity",
    "target_responsibility",
    "norm_violation",
    "similar_crisis_history"
]);

function clamp01(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
}

function assertModel(config) {
    const sum = RISK_FACTORS.reduce((total, key) => {
        const weight = config.weights?.[key];
        const params = config.factors?.[key];

        if (
            !Number.isFinite(weight) || weight < 0 ||
            !params ||
            !Number.isFinite(params.a) || params.a <= 0 ||
            !Number.isFinite(params.p) || params.p <= 0 ||
            !Number.isFinite(params.b)
        ) {
            throw new Error(
                `Invalid risk model parameters: ${key}`
            );
        }

        return total + weight;
    }, 0);

    if (Math.abs(sum - 1) > 0.000001) {
        throw new Error(
            `Risk weights must sum to 1: ${sum}`
        );
    }
}

assertModel(model);

const RISK_WEIGHTS = Object.freeze({
    ...model.weights
});

function calibrateFactors(analysis, config = model) {
    return Object.fromEntries(
        RISK_FACTORS.map(key => {
            const x = clamp01(analysis[key]);
            const { a, b, p } = config.factors[key];

            return [
                key,
                clamp01(a * Math.pow(x, p) + b)
            ];
        })
    );
}

function scoreCalibratedFactors(factors, config = model) {
    return RISK_FACTORS.reduce(
        (score, key) =>
            score +
            config.weights[key] * clamp01(factors[key]),
        0
    );
}

function calculateRiskScore(analysis, config = model) {
    const calibrated = calibrateFactors(analysis, config);

    return scoreCalibratedFactors(calibrated, config);
}

module.exports = {
    RISK_FACTORS,
    RISK_WEIGHTS,
    RISK_MODEL_VERSION: model.version,
    calibrateFactors,
    scoreCalibratedFactors,
    calculateRiskScore,
    assertModel
};