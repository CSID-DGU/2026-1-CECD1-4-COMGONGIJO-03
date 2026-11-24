const { createHash } = require("node:crypto");
const repository = require("../repositories/riskWeightRepository");
const { BASE_MODEL, RISK_FACTORS, assertModel } = require("./riskService");

function parseJson(value) {
    return typeof value === "string" ? JSON.parse(value) : value;
}

function completeFactors(value) {
    const factors = parseJson(value);
    if (!factors) return null;
    const entries = RISK_FACTORS.map(key => [key, factors[key]]);
    return entries.every(([, score]) =>
        typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1
    ) ? Object.fromEntries(entries) : null;
}

function withWeights(weights) {
    const orderedWeights = Object.fromEntries(RISK_FACTORS.map(key => [key, weights[key]]));
    const hash = createHash("sha256").update(JSON.stringify({
        factors: BASE_MODEL.factors, weights: orderedWeights
    })).digest("hex").slice(0, 16);
    const model = { ...BASE_MODEL, version: `risk-weights-${hash}`, weights: orderedWeights };
    assertModel(model);
    return model;
}

async function getActiveRiskModel(connection) {
    // Historical evaluations measure the separately versioned test-bias model.
    if (process.env.DB_NAME === "news_test_db") return BASE_MODEL;
    const approval = parseJson(await repository.latestApproval(connection));
    return approval ? withWeights(approval.weights) : BASE_MODEL;
}

module.exports = { parseJson, completeFactors, withWeights, getActiveRiskModel };
