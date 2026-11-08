const db = require("../db");

async function findLinkCandidates({
    date = null,
    lookbackDays = 2
} = {}) {
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
                COALESCE(
                    representative_article.published_at,
                    c.first_detected
                ),
                '%Y-%m-%d'
            ) AS cluster_date,

            aa.target_name,
            aa.event_name,
            aa.event_date,
            aa.event_location,
            aa.event_entities

        FROM clusters c

        LEFT JOIN articles representative_article
            ON representative_article.article_id =
                c.representative_article_id

        LEFT JOIN article_analysis aa
            ON aa.analysis_id = (
                SELECT
                    aa2.analysis_id

                FROM article_analysis aa2

                WHERE
                    aa2.cluster_id =
                        c.cluster_id

                ORDER BY
                    aa2.analyzed_at DESC

                LIMIT 1
            )

        WHERE
            c.cluster_status = 'active'

            AND DATE(
                COALESCE(
                    representative_article.published_at,
                    c.first_detected
                )
            )
            BETWEEN
                DATE_SUB(
                    COALESCE(
                        ?,
                        CURDATE()
                    ),
                    INTERVAL ? DAY
                )
                AND COALESCE(
                    ?,
                    CURDATE()
                )

        ORDER BY
            COALESCE(
                representative_article.published_at,
                c.first_detected
            ) ASC
        `,
        [
            date,
            lookbackDays,
            date
        ]
    );

    return rows;
}

async function upsertClusterLink({
    fromClusterId,
    toClusterId,
    similarityScore
}) {
    await db.query(
        `
        INSERT INTO cluster_links (
            from_cluster_id,
            to_cluster_id,
            link_type,
            similarity_score,
            created_at
        )
        VALUES (
            ?,
            ?,
            'same_event',
            ?,
            NOW()
        )

        ON DUPLICATE KEY UPDATE
            similarity_score =
                VALUES(similarity_score),
            created_at =
                NOW()
        `,
        [
            fromClusterId,
            toClusterId,
            similarityScore
        ]
    );
}

async function findLinksByClusterId(
    clusterId
) {
    const [rows] = await db.query(
        `
        SELECT
            cl.link_id,
            cl.from_cluster_id,
            cl.to_cluster_id,
            cl.link_type,
            cl.similarity_score,
            cl.created_at,

            from_cluster.representative_title
                AS from_title,

            to_cluster.representative_title
                AS to_title

        FROM cluster_links cl

        INNER JOIN clusters from_cluster
            ON from_cluster.cluster_id =
                cl.from_cluster_id

        INNER JOIN clusters to_cluster
            ON to_cluster.cluster_id =
                cl.to_cluster_id

        WHERE
            cl.from_cluster_id = ?
            OR cl.to_cluster_id = ?

        ORDER BY
            cl.created_at DESC
        `,
        [
            clusterId,
            clusterId
        ]
    );

    return rows;
}

module.exports = {
    findLinkCandidates,
    upsertClusterLink,
    findLinksByClusterId
};