const db = require("../db");


// 특정 날짜의 활성 클러스터만 병합 후보로 조회합니다.
// date가 null이면 오늘 날짜를 사용합니다.
async function findMergeCandidates(date = null) {
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

            DATE_FORMAT(
                c.first_detected,
                '%Y-%m-%d'
            ) AS cluster_date,

            aa.target_name,
            aa.event_name,
            aa.event_date,
            aa.event_location,
            aa.event_entities

        FROM clusters c

        LEFT JOIN article_analysis aa
            ON aa.analysis_id = (
                SELECT aa2.analysis_id

                FROM article_analysis aa2

                WHERE aa2.cluster_id =
                    c.cluster_id

                ORDER BY
                    aa2.analyzed_at DESC

                LIMIT 1
            )

        WHERE
            c.cluster_status = 'active'

            AND DATE(c.first_detected) =
                COALESCE(
                    ?,
                    CURDATE()
                )

        ORDER BY
            c.first_detected ASC
        `,
        [date]
    );

    return rows;
}


// 병합 후 centroid와 대표기사를 다시 계산하기 위해
// 특정 클러스터에 속한 모든 기사를 가져옵니다.
async function findArticlesByClusterId(clusterId) {
    const [rows] = await db.query(
        `
        SELECT
            a.article_id,
            a.title,
            a.url,
            a.source,
            a.published_at,

            aa.article_embedding,
            aa.risk_score,
            aa.analyzed_at

        FROM article_analysis aa

        INNER JOIN articles a
            ON aa.article_id = a.article_id

        WHERE aa.cluster_id = ?

        ORDER BY
            aa.analyzed_at ASC
        `,
        [clusterId]
    );

    return rows;
}


// source 클러스터를 target 클러스터로 실제 병합합니다.
async function mergeClusters({
    targetClusterId,
    sourceClusterId,
    centroidEmbedding,
    representativeArticleId,
    representativeTitle,
    articleCount,
    maxRiskScore,
    firstDetected,
    lastDetected
}) {
    const connection =
        await db.getConnection();

    try {
        await connection.beginTransaction();


        /*
         * 유지 대상 클러스터를 잠그고
         * cluster_key를 가져옵니다.
         */
        const [[targetCluster]] =
            await connection.query(
                `
                SELECT
                    cluster_key

                FROM clusters

                WHERE cluster_id = ?

                FOR UPDATE
                `,
                [targetClusterId]
            );


        if (!targetCluster) {
            throw new Error(
                `유지 대상 클러스터 ${targetClusterId}를 찾을 수 없습니다.`
            );
        }


        /*
         * 제거될 source 클러스터에 속한 기사들을
         * target 클러스터로 이동합니다.
         */
        await connection.query(
            `
            UPDATE article_analysis

            SET
                cluster_id = ?,
                cluster_key = ?

            WHERE cluster_id = ?
            `,
            [
                targetClusterId,
                targetCluster.cluster_key,
                sourceClusterId
            ]
        );


        /*
         * source 클러스터를 참조하고 있는 alert도
         * target 클러스터로 이동합니다.
         */
        await connection.query(
            `
            UPDATE alerts

            SET
                cluster_id = ?

            WHERE cluster_id = ?
            `,
            [
                targetClusterId,
                sourceClusterId
            ]
        );


        /*
         * 병합 후 다시 계산된 정보를
         * 유지 대상 클러스터에 반영합니다.
         */
        await connection.query(
            `
            UPDATE clusters

            SET
                centroid_embedding = ?,
                representative_article_id = ?,
                representative_title = ?,
                article_count = ?,
                max_risk_score = ?,
                first_detected = ?,
                last_detected = ?

            WHERE cluster_id = ?
            `,
            [
                centroidEmbedding,
                representativeArticleId,
                representativeTitle,
                articleCount,
                maxRiskScore,
                firstDetected,
                lastDetected,
                targetClusterId
            ]
        );


        /*
         * 모든 참조가 이동했으므로
         * source 클러스터를 제거합니다.
         */
        await connection.query(
            `
            DELETE FROM clusters

            WHERE cluster_id = ?
            `,
            [sourceClusterId]
        );


        await connection.commit();

    } catch (error) {
        await connection.rollback();
        throw error;

    } finally {
        connection.release();
    }
}


module.exports = {
    findMergeCandidates,
    findArticlesByClusterId,
    mergeClusters
};