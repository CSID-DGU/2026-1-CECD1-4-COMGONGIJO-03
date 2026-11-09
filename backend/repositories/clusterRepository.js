const db = require("../db");

// 오늘 생성되거나 갱신된 클러스터 후보와
// 클러스터링 비교에 필요한 대표값/기사 정보를 조회합니다.
async function findRecentCandidates(connection = db) {
    const [rows] = await connection.query(
        `
        SELECT
            c.cluster_id,
            c.cluster_key,
            c.representative_title,
            c.representative_article_id,
            c.centroid_embedding,
            c.issue_type,
            c.last_detected,
            c.article_count,
            c.max_risk_score,

            aa.event_name,
            aa.event_date,
            aa.event_location,
            aa.event_entities,
            aa.event_keywords,
            aa.article_embedding

        FROM clusters c

        LEFT JOIN article_analysis aa
            ON aa.analysis_id = (
                SELECT aa2.analysis_id
                FROM article_analysis aa2
                WHERE aa2.cluster_id = c.cluster_id
                  AND COALESCE(
                      aa2.spam_override,
                      aa2.target_related
                  ) = 1
                ORDER BY aa2.analyzed_at DESC
                LIMIT 1
            )

        WHERE c.last_detected >= CURDATE()
          AND c.cluster_status = 'active'
          AND c.article_count > 0

        ORDER BY c.last_detected DESC
        `
    );

    return rows;
}

// 기존 클러스터에 새 기사가 편입되었을 때
// 마지막 감지 시간, 기사 수, 최대 위험도를 갱신합니다.
async function updateMatchedCluster(
    clusterId,
    riskScore,
    connection = db
) {
    await connection.query(
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

// 클러스터의 centroid와 대표기사(medoid) 정보를 갱신합니다.
async function updateClusterRepresentation(
    clusterId,
    centroidEmbedding,
    representativeArticleId,
    representativeTitle,
    connection = db
) {
    await connection.query(
        `
        UPDATE clusters
        SET
            centroid_embedding = ?,
            representative_article_id = ?,
            representative_title = ?
        WHERE cluster_id = ?
        `,
        [
            centroidEmbedding,
            representativeArticleId,
            representativeTitle,
            clusterId
        ]
    );
}

// 기존 클러스터와 매칭되지 않은 기사를 기준으로
// 새로운 클러스터를 생성합니다.
async function createCluster({
    clusterKey,
    representativeTitle,
    representativeArticleId,
    centroidEmbedding,
    issueType,
    riskScore
}, connection = db) {
    const [result] = await connection.query(
        `
        INSERT INTO clusters (
            cluster_key,
            representative_title,
            representative_article_id,
            centroid_embedding,
            issue_type,
            first_detected,
            last_detected,
            article_count,
            max_risk_score,
            cluster_status
        )
        VALUES (?, ?, ?, ?, ?, NOW(), NOW(), 1, ?, 'active')
        `,
        [
            clusterKey,
            representativeTitle,
            representativeArticleId,
            centroidEmbedding,
            issueType,
            riskScore
        ]
    );

    return result.insertId;
}

// 전체 클러스터와 각 클러스터에 포함된 기사 정보를 조회합니다.
async function findAllWithArticles() {
    const [rows] = await db.query(
        `
        SELECT
            c.cluster_id,
            c.cluster_key,
            c.representative_title,
            c.representative_article_id,
            c.centroid_embedding,
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
            AND COALESCE(aa.spam_override, aa.target_related) = 1

        LEFT JOIN articles a
            ON aa.article_id = a.article_id

        ORDER BY
            c.max_risk_score DESC,
            c.last_detected DESC
        `
    );

    return rows;
}

// 특정 cluster_id의 기본 정보를 조회합니다.
async function findById(clusterId) {
    const [rows] = await db.query(
        `
        SELECT
            cluster_id,
            representative_title,
            representative_article_id,
            centroid_embedding,
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

// 특정 클러스터에 포함된 기사들과
// medoid/분화 계산에 필요한 분석 정보를 조회합니다.
async function findArticlesByClusterId(clusterId, connection = db) {
    const [rows] = await connection.query(
        `
        SELECT
            a.article_id,
            a.title,
            a.url,
            a.source,
            a.published_at,

            aa.summary,
            aa.event_name,
            aa.event_date,
            aa.event_location,
            aa.event_entities,
            aa.event_keywords,
            aa.article_embedding,
            aa.risk_score,
            aa.analyzed_at

        FROM article_analysis aa

        INNER JOIN articles a
            ON aa.article_id = a.article_id

        WHERE aa.cluster_id = ?
            AND COALESCE(aa.spam_override, aa.target_related) = 1

        ORDER BY
            aa.risk_score DESC,
            aa.analyzed_at DESC
        `,
        [clusterId]
    );

    return rows;
}

async function findNormalArticlesForUpdate(connection, clusterId) {
    const [rows] = await connection.query(
        `
        SELECT
            a.article_id,
            a.title,
            aa.article_embedding,
            aa.risk_score,
            aa.analyzed_at
        FROM article_analysis aa
        INNER JOIN articles a
            ON a.article_id = aa.article_id
        WHERE aa.cluster_id = ?
          AND COALESCE(aa.spam_override, aa.target_related) = 1
        ORDER BY aa.article_id
        FOR UPDATE
        `,
        [clusterId]
    );

    return rows;
}

async function updateClusterAfterSpamChange(
    connection,
    clusterId,
    {
        centroidEmbedding,
        representativeArticleId,
        representativeTitle,
        articleCount,
        maxRiskScore,
        clusterStatus
    }
) {
    const [result] = await connection.query(
        `
        UPDATE clusters
        SET
            centroid_embedding = ?,
            representative_article_id = ?,
            representative_title = ?,
            article_count = ?,
            max_risk_score = ?,
            cluster_status = ?
        WHERE cluster_id = ?
        `,
        [
            centroidEmbedding == null
                ? null
                : JSON.stringify(centroidEmbedding),
            representativeArticleId,
            representativeTitle,
            articleCount,
            maxRiskScore,
            clusterStatus,
            clusterId
        ]
    );

    return result.affectedRows;
}

async function deleteEmptyCluster(connection, clusterId) {
    // 알림 이력은 유지하고 클러스터 참조만 해제합니다.
    await connection.query(
        `
        UPDATE alerts
        SET cluster_id = NULL
        WHERE cluster_id = ?
        `,
        [clusterId]
    );

    // 스팸기사 등 기존 참조의 클러스터 연결을 해제합니다.
    await connection.query(
        `
        UPDATE article_analysis
        SET cluster_id = NULL,
            cluster_key = NULL
        WHERE cluster_id = ?
        `,
        [clusterId]
    );

    // cluster_links는 ON DELETE CASCADE로 자동 삭제됩니다.
    const [result] = await connection.query(
        `
        DELETE FROM clusters
        WHERE cluster_id = ?
          AND NOT EXISTS (
              SELECT 1
              FROM article_analysis
              WHERE cluster_id = ?
                AND COALESCE(spam_override, target_related) = 1
          )
        `,
        [clusterId, clusterId]
    );

    return result.affectedRows;
}

module.exports = {
    findRecentCandidates,
    updateMatchedCluster,
    updateClusterRepresentation,
    createCluster,
    findAllWithArticles,
    findById,
    findArticlesByClusterId,
    findNormalArticlesForUpdate,
    updateClusterAfterSpamChange,
    deleteEmptyCluster
};