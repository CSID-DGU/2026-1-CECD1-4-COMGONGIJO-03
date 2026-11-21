// 실험 DB의 기존 클러스터에 대해 관측 스냅샷을 준비합니다.
// 명시적으로 --write 옵션이 있을 때만 DB에 기록합니다.
// 예: node backend/scripts/refreshImpactSnapshots.js --write
const db = require("../db");
const { evaluateClusterImpact } = require("../services/clusterImpactService");
async function main() {
    const write = process.argv.includes("--write");
    const [clusters] = await db.query("SELECT cluster_id FROM clusters ORDER BY cluster_id");
    const counts = { total: clusters.length, observing: 0, ready_for_review: 0, incomplete: 0 };
    for (const { cluster_id: id } of clusters) {
        const result = await evaluateClusterImpact(id, { persist: write, includeLinked: false });
        if (result) counts[result.metrics.status]++;
    }
    console.log(JSON.stringify({ write, counts, note: "연결된 클러스터는 자동 병합하지 않았습니다. 7일치 수집 완전성을 검토한 후 확정하세요." }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => db.end());
