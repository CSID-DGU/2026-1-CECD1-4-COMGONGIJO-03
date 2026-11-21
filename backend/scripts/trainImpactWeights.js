// 평가 DB에서만 실행합니다. 파일/설정을 자동 수정하지 않습니다.
// 확인된 7일 사후 관측값을 기준으로 초기 가중치 후보를 계산합니다.
// 실행: node backend/scripts/trainImpactWeights.js
const db = require("../db");
const model = require("../config/impactModel.json");
const keys = Object.keys(model.initialWeights);
function mse(rows, weights) {
    return rows.reduce((sum, r) => {
        const pred = keys.reduce((s, key, i) => s + weights[i] * r.x[i], 0);
        return sum + (pred - r.y) ** 2;
    }, 0) / rows.length;
}
function fit(rows) {
    let w = keys.map(key => model.initialWeights[key]);
    for (let epoch = 0; epoch < 2500; epoch++) {
        const gradient = keys.map((_, i) =>
            rows.reduce((acc, r) => {
                const err = r.x.reduce((sum, x, j) => sum + x * w[j], 0) - r.y;
                return acc + 2 * err * r.x[i];
            }, 0) / rows.length
        );
        const projected = w.map((value, i) => Math.max(0, value - 0.08 * gradient[i]));
        const sum = projected.reduce((a, b) => a + b, 0);
        w = sum > 0 ? projected.map(v => v / sum) : [0.25, 0.25, 0.25, 0.25];
    }
    return w;
}
async function main() {
    const [rows] = await db.query(`
        SELECT s.cluster_id, s.first_article_id, s.observed_spread_score,
               aa.risk_score, aa.public_relevance, aa.title_sensationalism,
               aa.media_influence, f.factor_labels
        FROM cluster_impact_snapshots s
        JOIN article_analysis aa ON aa.article_id = s.first_article_id
        LEFT JOIN impact_feedback f ON f.article_id = s.first_article_id
        WHERE s.observation_days = ? AND s.confirmed_at IS NOT NULL
          AND s.calculation_status IN ('ready_for_review', 'estimated_review')
          AND s.normalization_version = ?
    `, [model.observationDays, model.normalizationVersion]);
    const usable = rows.map(r => {
        const labels = typeof r.factor_labels === "string" ? JSON.parse(r.factor_labels) : (r.factor_labels || {});
        const x = [r.risk_score, labels.public_relevance ?? r.public_relevance,
            labels.title_sensationalism ?? r.title_sensationalism,
            labels.media_influence ?? r.media_influence].map(Number);
        return { x, y: Number(r.observed_spread_score), articleId: Number(r.first_article_id) };
    }).filter(r => r.x.every(v => Number.isFinite(v) && v >= 0 && v <= 1) &&
        Number.isFinite(r.y) && r.y >= 0 && r.y <= 1);
    if (usable.length < 30) {
        console.log(`학습 가능한 사건 ${usable.length}개: 최소 30개 확보 전에는 초기 가중치를 유지합니다.`);
        process.exitCode = 1;
        return;
    }
    // 검증 샘플은 중복 기사 기준이 아닌 사건별로 분리합니다.
    const train = usable.filter(r => r.articleId % 5 !== 0);
    const valid = usable.filter(r => r.articleId % 5 === 0);
    if (train.length < 20 || valid.length < 5) {
        console.log("학습/검증 분할의 사건 수가 부족합니다. 동일 가중치를 유지합니다.");
        process.exitCode = 1;
        return;
    }
    const baseline = keys.map(key => model.initialWeights[key]);
    const candidate = fit(train);
    const oldMse = mse(valid, baseline), newMse = mse(valid, candidate);
    console.log(JSON.stringify({ train: train.length, validation: valid.length,
        previousValidationMse: oldMse, candidateValidationMse: newMse,
        recommendApply: newMse < oldMse,
        candidateWeights: Object.fromEntries(keys.map((key, i) => [key, candidate[i]])),
        note: "검증 데이터에 유리한 경우에만 수동으로 모델 버전을 올리고 적용하세요."
    }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => db.end());
