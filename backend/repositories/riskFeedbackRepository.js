const db = require("../db");

async function findByArticleId(articleId) {
    const [rows] = await db.query(
        `SELECT factor_labels, overall_label, updated_at
         FROM risk_feedback
         WHERE article_id = ?`,
        [articleId]
    );

    return rows[0] || null;
}

async function save(articleId, factorLabels, overallLabel) {
    await db.query(`
        INSERT INTO risk_feedback
            (article_id, factor_labels, overall_label)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
            factor_labels = VALUES(factor_labels),
            overall_label = VALUES(overall_label)
    `, [
        articleId,
        JSON.stringify(factorLabels),
        overallLabel
    ]);
}

module.exports = {
    findByArticleId,
    save
};