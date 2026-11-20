const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const baseModel = require("../config/riskModel.json");

const {
    RISK_FACTORS,
    calibrateFactors,
    calculateRiskScore,
    assertModel
} = require("../services/riskService");

function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
}

function valid(value) {
    return typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1;
}

function squared(a, b) {
    return (a - b) ** 2;
}

function mae(rows, predict, label) {
    const eligible = rows.filter(row => valid(label(row)));

    return eligible.length
        ? eligible.reduce(
            (sum, row) =>
                sum + Math.abs(predict(row) - label(row)),
            0
        ) / eligible.length
        : null;
}

function calibrate(x, q) {
    return clamp(
        q.a * (clamp(x, 0, 1) ** q.p) + q.b,
        0,
        1
    );
}

function coordinateFit(rows, key) {
    const eligible = rows.filter(row =>
        valid(row.raw_factors?.[key]) &&
        valid(row.factor_labels?.[key])
    );

    if (eligible.length < 20) {
        return { ...baseModel.factors[key] };
    }

    const objective = q =>
        eligible.reduce(
            (sum, row) =>
                sum + squared(
                    calibrate(row.raw_factors[key], q),
                    row.factor_labels[key]
                ),
            0
        ) / eligible.length +
        0.005 * (
            squared(q.a, 1) +
            squared(q.p, 1) +
            4 * q.b * q.b
        );

    let q = { a: 1, b: 0, p: 1 };

    for (const step of [0.3, 0.1, 0.03, 0.01]) {
        for (let round = 0; round < 30; round++) {
            let best = q;
            let bestLoss = objective(q);

            for (const k of ["a", "b", "p"]) {
                for (const sign of [-1, 1]) {
                    const bounds =
                        k === "b" ? [-0.5, 0.5] :
                        k === "a" ? [0.3, 3] :
                        [0.4, 3];

                    const candidate = {
                        ...q,
                        [k]: clamp(
                            q[k] + sign * step,
                            ...bounds
                        )
                    };

                    const loss = objective(candidate);

                    if (loss + 1e-12 < bestLoss) {
                        best = candidate;
                        bestLoss = loss;
                    }
                }
            }

            if (best === q) break;

            q = best;
        }
    }

    return Object.fromEntries(
        Object.entries(q).map(
            ([k, v]) => [k, Number(v.toFixed(5))]
        )
    );
}

function projectWeights(raw, centers, radius = 0.10) {
    const lo = centers.map(x =>
        Math.max(0, x - radius)
    );

    const hi = centers.map(x =>
        Math.min(1, x + radius)
    );

    let left = -2;
    let right = 2;

    for (let i = 0; i < 100; i++) {
        const mid = (left + right) / 2;

        const sum = raw.reduce(
            (s, x, j) =>
                s + clamp(x + mid, lo[j], hi[j]),
            0
        );

        if (sum < 1) left = mid;
        else right = mid;
    }

    return raw.map(
        (x, i) =>
            clamp(
                x + (left + right) / 2,
                lo[i],
                hi[i]
            )
    );
}

function fitWeights(rows, calibratedModel) {
    const eligible = rows.filter(row =>
        valid(row.overall_label) &&
        RISK_FACTORS.every(k =>
            valid(row.raw_factors?.[k])
        )
    );

    if (eligible.length < 20) {
        return { ...baseModel.weights };
    }

    const center = RISK_FACTORS.map(
        k => (baseModel.ahp_weights || baseModel.weights)[k]
    );

    let weights = [...center];

    const loss = w =>
        eligible.reduce((s, row) => {
            const factors = calibrateFactors(
                row.raw_factors,
                calibratedModel
            );

            const prediction = RISK_FACTORS.reduce(
                (a, k, i) =>
                    a + w[i] * factors[k],
                0
            );

            return s + squared(
                prediction,
                row.overall_label
            );
        }, 0) / eligible.length +
        0.1 * w.reduce(
            (s, v, i) =>
                s + squared(v, center[i]),
            0
        );

    for (const step of [0.05, 0.02, 0.005, 0.001]) {
        for (let round = 0; round < 100; round++) {
            let best = weights;
            let bestLoss = loss(weights);

            for (let i = 0; i < weights.length; i++) {
                for (const sign of [-1, 1]) {
                    const c = [...weights];
                    c[i] += sign * step;

                    const candidate =
                        projectWeights(c, center);

                    const err = loss(candidate);

                    if (err + 1e-12 < bestLoss) {
                        best = candidate;
                        bestLoss = err;
                    }
                }
            }

            if (best === weights) break;
            weights = best;
        }
    }

    return Object.fromEntries(
        RISK_FACTORS.map(
            (k, i) => [k, weights[i]]
        )
    );
}

function groupSplit(data) {
    const holdout = row => {
        const group = String(
            row.event_key ??
            row.cluster_id ??
            row.article_id ??
            "no-group"
        );

        const digest = crypto
            .createHash("sha256")
            .update(group)
            .digest();

        return digest.readUInt32BE(0) % 5 === 0;
    };

    return {
        train: data.filter(row => !holdout(row)),
        validation: data.filter(holdout)
    };
}

function train(data) {
    const { train, validation } = groupSplit(data);

    if (train.length < 20 || validation.length < 5) {
        throw new Error(
            "학습 20건, 검증 5건 이상이 필요합니다."
        );
    }

    const trained =
        JSON.parse(JSON.stringify(baseModel));

    trained.ahp_weights = {
        ...(baseModel.ahp_weights || baseModel.weights)
    };

    for (const key of RISK_FACTORS) {
        trained.factors[key] =
            coordinateFit(train, key);
    }

    trained.weights =
        fitWeights(train, trained);

    trained.version =
        `calibrated-${new Date().toISOString().slice(0, 10)}-` +
        crypto.createHash("sha256")
            .update(JSON.stringify({
                factors: trained.factors,
                weights: trained.weights
            }))
            .digest("hex")
            .slice(0, 8);

    assertModel(trained);

    const metrics = {
        train_count: train.length,
        validation_count: validation.length,

        by_factor: Object.fromEntries(
            RISK_FACTORS.map(key => [
                key,
                {
                    labeled_train: train.filter(
                        row => valid(row.factor_labels?.[key])
                    ).length,

                    original_mae: mae(
                        validation,
                        row => calibrateFactors(
                            row.raw_factors,
                            baseModel
                        )[key],
                        row => row.factor_labels?.[key]
                    ),

                    calibrated_mae: mae(
                        validation,
                        row => calibrateFactors(
                            row.raw_factors,
                            trained
                        )[key],
                        row => row.factor_labels?.[key]
                    )
                }
            ])
        ),

        overall: {
            labeled_train: train.filter(
                row => valid(row.overall_label)
            ).length,

            original_mae: mae(
                validation,
                row => calculateRiskScore(
                    row.raw_factors,
                    baseModel
                ),
                row => row.overall_label
            ),

            calibrated_mae: mae(
                validation,
                row => calculateRiskScore(
                    row.raw_factors,
                    trained
                ),
                row => row.overall_label
            )
        }
    };

    return { trained, metrics };
}

if (require.main === module) {
    const input = process.argv[2];

    if (!input) {
        console.error(
            "Usage: node scripts/trainRiskModel.js labels.json [--deploy]"
        );
        process.exit(2);
    }

    try {
        const data = JSON.parse(
            fs.readFileSync(input, "utf8")
        );

        if (!Array.isArray(data)) {
            throw new Error("입력은 JSON 배열이어야 합니다.");
        }

        const { trained, metrics } = train(data);

        console.log(
            "Validation:",
            JSON.stringify(metrics, null, 2)
        );

        console.log(
            "Candidate:",
            JSON.stringify(trained, null, 2)
        );

        if (process.argv.includes("--deploy")) {
            const mainMetric = metrics.overall;

            if (
                mainMetric.original_mae == null ||
                mainMetric.calibrated_mae == null
            ) {
                throw new Error(
                    "전체 위험도 검증 라벨이 없어서 적용하지 않았습니다."
                );
            }

            if (
                mainMetric.calibrated_mae >=
                mainMetric.original_mae
            ) {
                throw new Error(
                    "전체 위험도 검증 MAE가 개선되지 않아 적용하지 않았습니다."
                );
            }

            fs.writeFileSync(
                path.join(
                    __dirname,
                    "../config/riskModel.json"
                ),
                JSON.stringify(trained, null, 2) + "\n"
            );

            console.log("Risk model parameters updated.");
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    train,
    groupSplit
};