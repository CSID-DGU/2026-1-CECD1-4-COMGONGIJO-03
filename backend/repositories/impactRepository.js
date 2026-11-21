const db = require("../db");
const { normalizeSource } = require("../config/mediaInfluence");

async function getMediaOverride(source) {
    if (!normalizeSource(source)) return null;
    const [rows] = await db.query(
        "SELECT influence_score FROM media_source_scores WHERE source_key = ?",
        [normalizeSource(source)]
    );
    return rows.length ? Number(rows[0].influence_score) : null;
}

async function saveMediaOverride(source, score) {
    const key = normalizeSource(source);
    if (!key) throw new Error("source is required");
    await db.query(`
        INSERT INTO media_source_scores (source_key, display_name, influence_score)
        VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE
        display_name = VALUES(display_name), influence_score = VALUES(influence_score)
    `, [key, String(source).trim(), score]);
}

async function findClusterIds(rootId, includeLinked = false) {
    const [exists] = await db.query("SELECT cluster_id FROM clusters WHERE cluster_id = ?", [rootId]);
    if (!exists.length) return null;
    if (!includeLinked) return [rootId];
    const [links] = await db.query(`
        SELECT from_cluster_id, to_cluster_id
        FROM cluster_links WHERE link_type = 'same_event'
    `);
    const adjacency = new Map();
    for (const link of links) {
        const from = Number(link.from_cluster_id), to = Number(link.to_cluster_id);
        if (!adjacency.has(from)) adjacency.set(from, []);
        if (!adjacency.has(to)) adjacency.set(to, []);
        adjacency.get(from).push(to);
        adjacency.get(to).push(from);
    }
    const visited = new Set([rootId]);
    const queue = [rootId];
    while (queue.length) {
        const id = queue.shift();
        for (const next of adjacency.get(id) || []) {
            if (visited.has(next)) continue;
            if (visited.size >= 50) throw new Error("연결 클러스터 범위가 너무 큽니다. 수동 검토가 필요합니다.");
            visited.add(next);
            queue.push(next);
        }
    }
    return [...visited].sort((a, b) => a - b);
}

async function findClusterArticles(ids) {
    if (!ids?.length) return [];
    const placeholders = ids.map(() => "?").join(",");
    const [rows] = await db.query(`
        SELECT a.article_id, a.source, a.published_at, aa.risk_score, aa.cluster_id,
               c.first_detected AS cluster_first_detected,
               rep.published_at AS representative_published_at
        FROM article_analysis aa
        JOIN articles a ON a.article_id = aa.article_id
        JOIN clusters c ON c.cluster_id = aa.cluster_id
        LEFT JOIN articles rep ON rep.article_id = c.representative_article_id
        WHERE aa.cluster_id IN (${placeholders})
          AND aa.analysis_status = 'completed'
          AND COALESCE(aa.spam_override, aa.target_related) = 1
        ORDER BY a.published_at ASC, a.article_id ASC
    `, ids);
    return rows;
}

async function getFeedback(articleId) {
    const [rows] = await db.query("SELECT factor_labels, updated_at FROM impact_feedback WHERE article_id = ?", [articleId]);
    return rows[0] || null;
}
async function saveFeedback(articleId, labels) {
    await db.query(`
        INSERT INTO impact_feedback(article_id, factor_labels)
        VALUES(?, CAST(? AS JSON))
        ON DUPLICATE KEY UPDATE factor_labels = VALUES(factor_labels), updated_at = NOW()
    `, [articleId, JSON.stringify(labels)]);
}

async function upsertSnapshot(clusterId, impact, ids, sourceSignature) {
    await db.query(`
        INSERT INTO cluster_impact_snapshots (
          cluster_id, observation_days, linked_cluster_ids, source_signature,
          first_article_id, first_published_at, observation_ends_at,
          news_count, source_count, duration_hours, first_24h_count,
          observed_spread_score, observed_impact_score,
          normalization_version, calculation_status, confirmed_at, calculated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NOW())
        ON DUPLICATE KEY UPDATE
          linked_cluster_ids=VALUES(linked_cluster_ids),
          confirmed_at=IF(source_signature=VALUES(source_signature)
             AND normalization_version=VALUES(normalization_version), confirmed_at, NULL),
          source_signature=VALUES(source_signature),
          first_article_id=VALUES(first_article_id),
          first_published_at=VALUES(first_published_at),
          observation_ends_at=VALUES(observation_ends_at),
          news_count=VALUES(news_count), source_count=VALUES(source_count),
          duration_hours=VALUES(duration_hours), first_24h_count=VALUES(first_24h_count),
          observed_spread_score=VALUES(observed_spread_score),
          observed_impact_score=VALUES(observed_impact_score),
          normalization_version=VALUES(normalization_version),
          calculation_status=VALUES(calculation_status), calculated_at=NOW()
    `, [
        clusterId, impact.observation_days, JSON.stringify(ids), sourceSignature,
        impact.first_article_id || null,
        impact.first_published_at ? new Date(impact.first_published_at) : null,
        impact.observation_ends_at ? new Date(impact.observation_ends_at) : null,
        impact.counts?.news_count ?? null, impact.counts?.source_count ?? null,
        impact.counts?.duration_hours ?? null, impact.counts?.first_24h_count ?? null,
        impact.observed_spread_score, impact.observed_impact_score,
        impact.normalization_version, impact.status
    ]);
}
async function getSnapshot(clusterId, days) {
    const [rows] = await db.query(`
        SELECT * FROM cluster_impact_snapshots
        WHERE cluster_id=? AND observation_days=?
    `, [clusterId, days]);
    return rows[0] || null;
}
async function confirmSnapshot(clusterId, days) {
    const [result] = await db.query(`
        UPDATE cluster_impact_snapshots SET confirmed_at=NOW()
        WHERE cluster_id=? AND observation_days=?
          AND calculation_status IN ('ready_for_review', 'estimated_review')
          AND first_article_id IS NOT NULL
          AND observed_spread_score IS NOT NULL
    `, [clusterId, days]);
    return result.affectedRows > 0;
}

module.exports = { getMediaOverride, saveMediaOverride, findClusterIds,
    findClusterArticles, getFeedback, saveFeedback, upsertSnapshot,
    getSnapshot, confirmSnapshot };
