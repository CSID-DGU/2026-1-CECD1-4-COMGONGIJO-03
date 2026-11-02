const db = require("../db");

// 같은 날 생성된 활성 클러스터 중
// 기사가 2개 이상인 클러스터를 조회합니다.
async function findSplitCandidateIds(date = null) {
    const [rows] = await db.query(
        `
        SELECT c.cluster_id
        FROM clusters c
        WHERE c.cluster_status = 'active'
          AND DATE(c.first_detected) = COALESCE(?, CURDATE())
          AND (
              SELECT COUNT(DISTINCT aa.article_id)
              FROM article_analysis aa
              WHERE aa.cluster_id = c.cluster_id
          ) >= 2
        ORDER BY c.first_detected ASC, c.cluster_id ASC
        `,
        [date]
    );

    return rows.map(row => row.cluster_id);
}

// 클러스터와 소속 기사 분석 정보를 조회합니다.
async function readSnapshot(connection, clusterId, lock = false) {
    const lockClause = lock ? "FOR UPDATE" : "";

    const [[cluster]] = await connection.query(
        `
        SELECT
            cluster_id,
            cluster_key,
            representative_article_id,
            representative_title,
            issue_type,
            centroid_embedding,
            first_detected,
            last_detected,
            article_count,
            max_risk_score,
            cluster_status
        FROM clusters
        WHERE cluster_id = ?
        ${lockClause}
        `,
        [clusterId]
    );

    if (!cluster) return null;

    const [articles] = await connection.query(
        `
        SELECT
            aa.analysis_id,
            aa.article_id,
            aa.target_name,
            aa.issue_type,
            aa.event_name,
            aa.event_date,
            aa.event_location,
            aa.event_entities,
            aa.article_embedding,
            aa.risk_score,
            aa.analyzed_at,
            a.title,
            a.published_at,
            a.collected_at
        FROM article_analysis aa
        INNER JOIN articles a
            ON a.article_id = aa.article_id
        WHERE aa.cluster_id = ?
        ORDER BY aa.analyzed_at DESC, aa.analysis_id DESC
        ${lockClause}
        `,
        [clusterId]
    );

    // 동일한 기사에 분석 기록이 여러 개라면
    // 최신 분석 기록으로 한 번만 판단합니다.
    const seen = new Set();

    const uniqueArticles = articles.filter(article => {
        if (seen.has(article.article_id)) {
            return false;
        }

        seen.add(article.article_id);
        return true;
    });

    return {
        cluster,
        articles: uniqueArticles
    };
}

async function getSnapshot(clusterId) {
    return readSnapshot(db, clusterId, false);
}

// 실제 분할 시 트랜잭션을 사용합니다.
async function withLockedSnapshot(clusterId, callback) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const snapshot = await readSnapshot(
            connection,
            clusterId,
            true
        );

        const result = await callback(
            connection,
            snapshot
        );

        await connection.commit();
        return result;

    } catch (error) {
        await connection.rollback();
        throw error;

    } finally {
        connection.release();
    }
}

// 분할 결과를 DB에 반영합니다.
async function applySplit(
    connection,
    originalCluster,
    groups,
    retainedIndex
) {
    const originalId = originalCluster.cluster_id;
    const appliedGroups = [];

    // 분리되는 그룹마다 새 클러스터를 생성합니다.
    for (let index = 0; index < groups.length; index++) {
        if (index === retainedIndex) continue;

        const group = groups[index];

        const clusterKey =
            `split-${originalId}-${group.representativeArticleId}`;

        const [insertResult] = await connection.query(
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
            `,
            [
                clusterKey,
                group.representativeTitle,
                group.representativeArticleId,
                JSON.stringify(group.centroid),
                group.issueType,
                group.firstDetected,
                group.lastDetected,
                group.articleIds.length,
                group.maxRiskScore
            ]
        );

        const newId = insertResult.insertId;

        const placeholders =
            group.articleIds.map(() => "?").join(", ");

        // 분리된 기사 분석을 새 클러스터로 이동합니다.
        await connection.query(
            `
            UPDATE article_analysis
            SET cluster_id = ?, cluster_key = ?
            WHERE cluster_id = ?
              AND article_id IN (${placeholders})
            `,
            [
                newId,
                clusterKey,
                originalId,
                ...group.articleIds
            ]
        );

        // 해당 기사의 알림도 새 클러스터로 이동합니다.
        await connection.query(
            `
            UPDATE alerts
            SET cluster_id = ?
            WHERE cluster_id = ?
              AND article_id IN (${placeholders})
            `,
            [
                newId,
                originalId,
                ...group.articleIds
            ]
        );

        appliedGroups.push({
            clusterId: newId,
            articleIds: group.articleIds,
            representativeArticleId: group.representativeArticleId
        });
    }

    // 원본 클러스터의 메타데이터를 재계산합니다.
    const retained = groups[retainedIndex];

    await connection.query(
        `
        UPDATE clusters
        SET
            representative_title = ?,
            representative_article_id = ?,
            centroid_embedding = ?,
            issue_type = ?,
            first_detected = ?,
            last_detected = ?,
            article_count = ?,
            max_risk_score = ?
        WHERE cluster_id = ?
        `,
        [
            retained.representativeTitle,
            retained.representativeArticleId,
            JSON.stringify(retained.centroid),
            retained.issueType,
            retained.firstDetected,
            retained.lastDetected,
            retained.articleIds.length,
            retained.maxRiskScore,
            originalId
        ]
    );

    // 기존 연결관계는 분할 전 사건 기준이므로 삭제합니다.
    const [linksResult] = await connection.query(
        `
        DELETE FROM cluster_links
        WHERE from_cluster_id = ?
           OR to_cluster_id = ?
        `,
        [originalId, originalId]
    );

    return {
        retainedClusterId: originalId,
        newClusters: appliedGroups,
        invalidatedLinkCount: linksResult.affectedRows
    };
}

module.exports = {
    findSplitCandidateIds,
    getSnapshot,
    withLockedSnapshot,
    applySplit
};