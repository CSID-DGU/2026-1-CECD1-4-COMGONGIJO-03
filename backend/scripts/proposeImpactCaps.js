// 테스트 DB에서 7일치 관측 스냅샷을 충분히 확보한 다음 실행합니다.
// 운영 설정을 자동 변경하지 않고 P95 추천값만 출력합니다.
// 실행 예: node backend/scripts/proposeImpactCaps.js
const db = require("../db");
const model = require("../config/impactModel.json");
function percentile(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
async function main() {
    const [rows] = await db.query(`
        SELECT news_count, source_count, duration_hours, first_24h_count
        FROM cluster_impact_snapshots
        WHERE observation_days = ? AND confirmed_at IS NOT NULL
          AND calculation_status IN ('ready_for_review', 'estimated_review')
          AND normalization_version = ?
    `, [model.observationDays, model.normalizationVersion]);
    if (rows.length < 20) {
        console.log(`확정된 사건 ${rows.length}건: 통계 기준으로 너무 적습니다 (최소 20건 권장).`);
        process.exitCode = 1;
        return;
    }
    const suggested = {};
    for (const key of ["news_count", "source_count", "duration_hours", "first_24h_count"]) {
        const numbers = rows.map(r => Number(r[key])).filter(Number.isFinite).sort((a, b) => a - b);
        suggested[key] = { median: percentile(numbers, 0.5), p90: percentile(numbers, 0.9), p95: percentile(numbers, 0.95) };
    }
    console.log(JSON.stringify({ eventCount: rows.length, suggested, note: "통계 참고용: 실무자 검토 후 impactModel.json을 수동 변경하세요." }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => db.end());
