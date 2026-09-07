const db = require("../db");

async function findRecentCandidates() {
    const [rows] = await db.query(
        `
        SELECT
            c.cluster_id,
            c.cluster_key,
            c.representative_title,
            c.issue_type,
            c.last_detected,
            c.article_count,
            c.max_risk_score,
            aa.event_name,
            aa.event_location,
            aa.event_entities,
            aa.event_keywords
        FROM clusters c
        LEFT JOIN article_analysis aa
            ON aa.analysis_id = (
                SELECT aa2.analysis_id
                FROM article_analysis aa2
                WHERE aa2.cluster_id = c.cluster_id
                ORDER BY aa2.analyzed_at DESC
                LIMIT 1
            )
        WHERE c.last_detected >= CURDATE()
        ORDER BY c.last_detected DESC
        `
    );

    return rows;
}

async function updateMatchedCluster(clusterId, riskScore) {
    await db.query(
        `
        UPDATE clusters
        SET
            last_detected = NOW(),
            article_count = article_count + 1,
            max_risk_score = GREATEST(max_risk_score, ?)
        WHERE cluster_id = ?
        `,
        [riskScore, clusterId]
    );
}

async function createCluster({ clusterKey, representativeTitle, issueType, riskScore }) {
    const [result] = await db.query(
        `
        INSERT INTO clusters (
            cluster_key,
            representative_title,
            issue_type,
            first_detected,
            last_detected,
            article_count,
            max_risk_score,
            cluster_status
        )
        VALUES (?, ?, ?, NOW(), NOW(), 1, ?, 'active')
        `,
        [clusterKey, representativeTitle, issueType, riskScore]
    );

    return result.insertId;
}

async function findAllWithArticles() {
    const [rows] = await db.query(
        `
        SELECT
            c.cluster_id,
            c.cluster_key,
            c.representative_title,
            c.issue_type,
            c.first_detected,
            c.last_detected,
            c.article_count,
            c.max_risk_score,
            c.cluster_status,
            a.article_id,
            a.title,
            a.url,
            a.source,
            aa.risk_score,
            aa.event_name
        FROM clusters c
        LEFT JOIN article_analysis aa
            ON c.cluster_id = aa.cluster_id
        LEFT JOIN articles a
            ON aa.article_id = a.article_id
        ORDER BY
            c.max_risk_score DESC,
            c.last_detected DESC
        `
    );

    return rows;
}

async function findById(clusterId) {
    const [rows] = await db.query(
        `
        SELECT
            cluster_id,
            representative_title,
            issue_type,
            article_count,
            max_risk_score,
            first_detected,
            last_detected
        FROM clusters
        WHERE cluster_id = ?
        `,
        [clusterId]
    );

    return rows[0] || null;
}

async function findArticlesByClusterId(clusterId) {
    const [rows] = await db.query(
        `
        SELECT
            a.article_id,
            a.title,
            a.url,
            a.source,
            a.published_at,
            aa.summary,
            aa.event_name,
            aa.event_keywords,
            aa.risk_score,
            aa.analyzed_at
        FROM article_analysis aa
        INNER JOIN articles a
            ON aa.article_id = a.article_id
        WHERE aa.cluster_id = ?
        ORDER BY aa.risk_score DESC, aa.analyzed_at DESC
        `,
        [clusterId]
    );

    return rows;
}

module.exports = {
    findRecentCandidates,
    updateMatchedCluster,
    createCluster,
    findAllWithArticles,
    findById,
    findArticlesByClusterId
};
