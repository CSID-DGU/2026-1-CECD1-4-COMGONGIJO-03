const db = require("../db");

async function findHistoricalCrises(targetName) {
    const [rows] = await db.query(
        `
        SELECT
            aa.cluster_id,
            aa.target_name,
            aa.issue_type,
            aa.negative_impact_type,
            aa.event_name,
            aa.event_date,
            aa.analyzed_at,
            a.published_at

        FROM article_analysis aa

        INNER JOIN articles a
            ON a.article_id = aa.article_id

        WHERE
            aa.analysis_status = 'completed'
            AND aa.target_related = TRUE
            AND aa.target_name = ?

        ORDER BY
            COALESCE(
                aa.event_date,
                DATE(a.published_at),
                DATE(aa.analyzed_at)
            ) DESC
        `,
        [targetName]
    );

    return rows;
}

module.exports = {
    findHistoricalCrises
};