const fs = require("node:fs");
const path = require("node:path");
const db = require("../db");

async function initializeSchema() {
    const migration = fs.readFileSync(path.join(
        __dirname, "../sql/migrations/20261124_risk_weight_training.sql"
    ), "utf8");
    for (const statement of migration.split(";").map(sql => sql.trim()).filter(Boolean)) {
        await db.query(statement);
    }
}

async function findFeedback(articleId, analysisId) {
    const [rows] = await db.query(
        "SELECT overall_label, updated_at FROM risk_overall_feedback WHERE article_id = ? AND analysis_id = ?",
        [articleId, analysisId]
    );
    return rows[0] || null;
}

async function saveFeedback(article, label, rawFactors) {
    const calibrated = article.risk_calibrated_factors;
    await db.query(
        `INSERT INTO risk_overall_feedback
         (article_id, analysis_id, cluster_id_at_feedback, overall_label, raw_factors,
          calibrated_factors, model_score, model_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE analysis_id = VALUES(analysis_id),
           cluster_id_at_feedback = VALUES(cluster_id_at_feedback),
           overall_label = VALUES(overall_label), raw_factors = VALUES(raw_factors),
           calibrated_factors = VALUES(calibrated_factors), model_score = VALUES(model_score),
           model_version = VALUES(model_version), updated_at = CURRENT_TIMESTAMP`,
        [article.article_id, article.analysis_id, article.cluster_id, label,
            JSON.stringify(rawFactors), typeof calibrated === "object" && calibrated !== null
                ? JSON.stringify(calibrated) : calibrated ?? null,
            article.risk_score, article.risk_model_version]
    );
}

async function trainingData(connection = db) {
    const [rows] = await connection.query(`
        SELECT f.article_id, f.cluster_id_at_feedback, aa.cluster_id, f.overall_label, f.raw_factors
        FROM risk_overall_feedback f
        JOIN article_analysis aa ON aa.analysis_id = f.analysis_id
          AND aa.article_id = f.article_id
        JOIN clusters c ON c.cluster_id = aa.cluster_id
        WHERE aa.analysis_status = 'completed' AND c.cluster_status = 'active'
          AND COALESCE(aa.spam_override, aa.target_related) = 1
          AND NOT EXISTS (
              SELECT 1 FROM article_analysis newer
              WHERE newer.article_id = aa.article_id AND newer.analysis_id > aa.analysis_id
          )
        ORDER BY f.article_id
    `);
    const [links] = await connection.query(
        "SELECT from_cluster_id, to_cluster_id FROM cluster_links WHERE link_type = 'same_event'"
    );
    return { rows, links };
}

async function latestApproval(connection = db) {
    const [rows] = await connection.query(
        `SELECT candidate_model FROM risk_weight_training_runs
         WHERE applied = 1 ORDER BY run_id DESC LIMIT 1`
    );
    return rows[0]?.candidate_model ?? null;
}

async function latestReport() {
    const [rows] = await db.query(
        "SELECT report, created_at FROM risk_weight_training_runs ORDER BY run_id DESC LIMIT 1"
    );
    return rows[0] || null;
}

async function saveRun(connection, report, previous, candidate) {
    await connection.query(
        `INSERT INTO risk_weight_training_runs (applied, previous_model, candidate_model, report)
         VALUES (?, ?, ?, ?)`,
        [report.applied, JSON.stringify(previous),
            candidate ? JSON.stringify(candidate) : null, JSON.stringify(report)]
    );
}

async function isTraining() {
    const [[row]] = await db.query(
        "SELECT IS_USED_LOCK(CONCAT('risk-weights:', DATABASE())) AS lock_owner"
    );
    return row.lock_owner != null;
}

async function withTrainingLock(task) {
    const connection = await db.getConnection();
    let locked = false;
    let reusable = true;
    try {
        const [[row]] = await connection.query(
            "SELECT GET_LOCK(CONCAT('risk-weights:', DATABASE()), 0) AS acquired"
        );
        locked = Number(row.acquired) === 1;
        if (!locked) return null;
        return await task(connection);
    } finally {
        if (locked) {
            try {
                await connection.query("SELECT RELEASE_LOCK(CONCAT('risk-weights:', DATABASE()))");
            } catch {
                reusable = false;
                connection.destroy();
            }
        }
        if (reusable) connection.release();
    }
}

module.exports = {
    initializeSchema, findFeedback, saveFeedback, trainingData, latestApproval,
    latestReport, saveRun, isTraining, withTrainingLock
};
