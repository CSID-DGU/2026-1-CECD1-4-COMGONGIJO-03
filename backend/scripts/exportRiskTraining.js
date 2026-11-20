process.env.DOTENV_CONFIG_QUIET = "true";

const db = require("../db");

const {
    RISK_FACTORS
} = require("../services/riskService");

async function main() {
    try {
        const [rows] = await db.query(`
            SELECT
                a.article_id,
                aa.cluster_id,
                aa.event_name,
                aa.issue_severity,
                aa.target_responsibility,
                aa.norm_violation,
                aa.similar_crisis_history,
                f.factor_labels,
                f.overall_label

            FROM risk_feedback f

            JOIN article_analysis aa
                ON aa.article_id = f.article_id

            JOIN articles a
                ON a.article_id = f.article_id

            WHERE aa.analysis_status = 'completed'
            ORDER BY a.article_id
        `);

        const result = rows.map(row => ({
            article_id: row.article_id,

            event_key:
                row.cluster_id == null
                    ? row.event_name || String(row.article_id)
                    : `cluster-${row.cluster_id}`,

            raw_factors: Object.fromEntries(
                RISK_FACTORS.map(key => [
                    key,
                    Number(row[key]) || 0
                ])
            ),

            factor_labels:
                typeof row.factor_labels === "string"
                    ? JSON.parse(row.factor_labels)
                    : row.factor_labels || {},

            overall_label:
                row.overall_label == null
                    ? null
                    : Number(row.overall_label)
        }));

        process.stdout.write(
            JSON.stringify(result, null, 2) + "\n"
        );
    } finally {
        await db.end();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});