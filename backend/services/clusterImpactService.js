const crypto = require("node:crypto");
const config = require("../config/impactModel.json");
const repository = require("../repositories/impactRepository");
const { calculateObservedImpact } = require("./impactService");

async function evaluateClusterImpact(clusterId, { includeLinked = false, persist = false } = {}) {
    const ids = await repository.findClusterIds(clusterId, includeLinked);
    if (!ids) return null;
    const articles = await repository.findClusterArticles(ids);
    const impact = calculateObservedImpact(articles);
    const signature = crypto.createHash("sha256").update(JSON.stringify({
        ids,
        articles: articles.map(a => [a.article_id, a.published_at, a.source, a.risk_score,
            a.cluster_id, a.representative_published_at, a.cluster_first_detected])
    })).digest("hex");
    if (persist) await repository.upsertSnapshot(clusterId, impact, ids, signature);
    const snapshot = await repository.getSnapshot(clusterId, config.observationDays);
    return {
        cluster_id: clusterId,
        included_cluster_ids: ids,
        linked_clusters_need_review: ids.length > 1,
        metrics: impact,
        confirmed: !!(snapshot?.confirmed_at && snapshot.source_signature === signature &&
            snapshot.normalization_version === impact.normalization_version),
        saved: persist,
        snapshot_confirmed_at: snapshot?.confirmed_at || null
    };
}

module.exports = { evaluateClusterImpact };
