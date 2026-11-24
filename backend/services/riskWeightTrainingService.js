const repository = require("../repositories/riskWeightRepository");
const { BASE_MODEL, RISK_FACTORS, calibrateFactors } = require("./riskService");
const { completeFactors, getActiveRiskModel, parseJson, withWeights } = require("./riskModelService");

function positiveSetting(name, fallback, min, max, integer = false) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= min && value <= max &&
        (!integer || Number.isInteger(value)) ? value : fallback;
}

function trainingSettings() {
    return {
        minFeedback: positiveSetting("RISK_TRAIN_MIN_FEEDBACK", 20, 8, 100000, true),
        minEvents: positiveSetting("RISK_TRAIN_MIN_EVENTS", 10, 8, 100000, true),
        minValidationEvents: positiveSetting("RISK_TRAIN_MIN_VALIDATION_EVENTS", 5, 3, 1000, true),
        minimumImprovement: positiveSetting("RISK_TRAIN_MIN_MAE_GAIN", 0.01, 0.005, 1),
        regularization: positiveSetting("RISK_TRAIN_L2", 0.15, 0.01, 10)
    };
}

function groupFeedback({ rows, links }) {
    const parents = new Map();
    function root(id) {
        let key = id;
        while (parents.has(key)) key = parents.get(key);
        while (parents.has(id) && parents.get(id) !== key) {
            const next = parents.get(id);
            parents.set(id, key);
            id = next;
        }
        return key;
    }
    function link(a, b) {
        a = root(Number(a));
        b = root(Number(b));
        if (a !== b) parents.set(Math.max(a, b), Math.min(a, b));
    }
    for (const edge of links) link(edge.from_cluster_id, edge.to_cluster_id);
    for (const row of rows) link(row.cluster_id_at_feedback, row.cluster_id);

    const groups = new Map();
    for (const row of rows) {
        const raw = completeFactors(row.raw_factors);
        const label = row.overall_label == null ? NaN : Number(row.overall_label);
        if (!raw || !Number.isFinite(label) || label < 0 || label > 1) continue;
        const key = root(Number(row.cluster_id));
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ articleId: Number(row.article_id), raw, label });
    }
    return [...groups.values()].sort((a, b) => a[0].articleId - b[0].articleId);
}

function prepare(data, settings) {
    const groups = groupFeedback(data);
    const validationCount = Math.max(settings.minValidationEvents, Math.ceil(groups.length / 4));
    const split = Math.max(0, groups.length - validationCount);
    const training = groups.slice(0, split);
    const validation = groups.slice(split);
    const validationFeedbackCount = validation.reduce((sum, group) => sum + group.length, 0);
    const feedbackCount = groups.reduce((sum, group) => sum + group.length, 0);
    const status = {
        feedbackCount, eventCount: groups.length,
        trainingEventCount: training.length, validationEventCount: validation.length,
        trainingFeedbackCount: feedbackCount - validationFeedbackCount, validationFeedbackCount,
        ready: feedbackCount >= settings.minFeedback && groups.length >= settings.minEvents &&
            training.length >= 5 && validation.length >= settings.minValidationEvents,
        settings
    };
    return { training, validation, status };
}

function projectSimplex(values) {
    const sorted = [...values].sort((a, b) => b - a);
    let sum = 0;
    let threshold = 0;
    for (let i = 0; i < sorted.length; i++) {
        sum += sorted[i];
        const offset = (sum - 1) / (i + 1);
        if (sorted[i] > offset) threshold = offset;
    }
    return values.map(value => Math.max(0, value - threshold));
}

function features(groups, model) {
    return groups.map(group => group.map(({ raw, label }) => {
        const calibrated = calibrateFactors(raw, model);
        return { x: RISK_FACTORS.map(key => calibrated[key]), label };
    }));
}

function fitWeights(events, anchor, regularization) {
    const matrix = anchor.map(() => anchor.map(() => 0));
    const target = anchor.map(() => 0);
    for (const event of events) {
        const share = 1 / (events.length * event.length);
        for (const { x, label } of event) {
            for (let i = 0; i < x.length; i++) {
                target[i] += share * x[i] * label;
                for (let j = 0; j < x.length; j++) matrix[i][j] += share * x[i] * x[j];
            }
        }
    }
    let weights = [...anchor];
    const step = 1 / (2 * (anchor.length + regularization));
    for (let epoch = 0; epoch < 600; epoch++) {
        const next = projectSimplex(weights.map((weight, i) => {
            const gradient = matrix[i].reduce((sum, value, j) => sum + value * weights[j], 0)
                - target[i] + regularization * (weight - anchor[i]);
            return weight - 2 * step * gradient;
        }));
        const movement = Math.max(...next.map((value, i) => Math.abs(value - weights[i])));
        weights = next;
        if (movement < 1e-10) break;
    }
    return weights;
}

function eventMae(events, weights) {
    return events.reduce((total, event) => total + event.reduce((error, { x, label }) => {
        const prediction = weights.reduce((sum, weight, i) => sum + weight * x[i], 0);
        return error + Math.abs(prediction - label);
    }, 0) / event.length, 0) / events.length;
}

function evaluateCandidate(prepared, current) {
    const { status, training, validation } = prepared;
    const report = {
        ...status, applied: false, reason: "insufficient_data", previousVersion: current.version,
        previousWeights: current.weights, candidateVersion: null, candidateWeights: null,
        previousMae: null, candidateMae: null, improvement: null
    };
    if (!status.ready) return { report, candidate: null };
    const { regularization, minimumImprovement } = status.settings;
    const anchor = RISK_FACTORS.map(key => (BASE_MODEL.ahp_weights || BASE_MODEL.weights)[key]);
    const fitted = fitWeights(features(training, current), anchor, regularization);
    const candidate = withWeights(Object.fromEntries(RISK_FACTORS.map((key, i) => [key, fitted[i]])));
    const validationFeatures = features(validation, current);
    const previousMae = eventMae(validationFeatures, RISK_FACTORS.map(key => current.weights[key]));
    const candidateMae = eventMae(validationFeatures, fitted);
    const improvement = previousMae - candidateMae;
    const applied = improvement >= minimumImprovement;
    return {
        candidate,
        report: {
            ...report, applied, reason: applied ? "applied" : "minimum_gain_not_met",
            candidateVersion: candidate.version, candidateWeights: candidate.weights,
            previousMae, candidateMae, improvement
        }
    };
}

async function getStatus() {
    const [data, report, model, running] = await Promise.all([
        repository.trainingData(), repository.latestReport(), getActiveRiskModel(), repository.isTraining()
    ]);
    return {
        ...prepare(data, trainingSettings()).status, running,
        activeVersion: model.version, activeWeights: model.weights,
        lastRun: report ? { ...parseJson(report.report), createdAt: report.created_at } : null
    };
}

async function train() {
    return repository.withTrainingLock(async connection => {
        await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        await connection.beginTransaction();
        try {
            const data = await repository.trainingData(connection);
            const current = await getActiveRiskModel(connection);
            const result = evaluateCandidate(prepare(data, trainingSettings()), current);
            await repository.saveRun(connection, result.report, current, result.candidate);
            await connection.commit();
            return result.report;
        } catch (error) {
            await connection.rollback();
            throw error;
        }
    });
}

module.exports = { groupFeedback, prepare, evaluateCandidate, getStatus, train };
