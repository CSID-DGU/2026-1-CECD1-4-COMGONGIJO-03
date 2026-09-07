const db = require("../db");

const ANALYSIS_COLUMNS = `
    aa.analysis_id,
    aa.summary,
    aa.sentiment_label,
    aa.sentiment_score,
    aa.risk_score,
    aa.analysis_status,
    aa.analyzed_at,
    aa.target_name,
    aa.issue_type,
    aa.event_name,
    aa.event_date,
    aa.event_location,
    aa.event_entities,
    aa.event_keywords,
    aa.target_related,
    aa.target_mention_type,
    aa.negative_impact_type,
    aa.issue_severity,
    aa.public_sensitivity,
    aa.target_responsibility,
    aa.spread_potential,
    aa.risk_factor_reason,
    aa.cluster_key
`;

async function findIdByUrl(url) {
    const [rows] = await db.query(
        "SELECT article_id FROM articles WHERE url = ?",
        [url]
    );
    return rows[0] || null;
}

async function insertArticle(article) {
    const [result] = await db.query(
        `
        INSERT INTO articles
        (title, content, url, source, author, published_at, collected_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [
            article.title,
            article.content,
            article.url,
            article.source,
            article.author,
            article.published_at
        ]
    );

    return result.insertId;
}

async function existsById(articleId) {
    const [rows] = await db.query(
        "SELECT article_id FROM articles WHERE article_id = ?",
        [articleId]
    );
    return rows.length > 0;
}

async function findByUrlWithAnalysis(url) {
    const [rows] = await db.query(
        `
        SELECT
            a.*,
            ${ANALYSIS_COLUMNS}
        FROM articles a
        LEFT JOIN article_analysis aa
            ON a.article_id = aa.article_id
        WHERE a.url = ?
        `,
        [url]
    );

    return rows[0] || null;
}

async function findAnalyzedArticles() {
    const [rows] = await db.query(
        `
        SELECT
            a.*,
            ${ANALYSIS_COLUMNS}
        FROM articles a
        INNER JOIN article_analysis aa
            ON a.article_id = aa.article_id
        WHERE aa.analysis_status = 'completed'
        ORDER BY aa.analyzed_at DESC
        `
    );

    return rows;
}

async function findRiskyArticles(minRisk) {
    const [rows] = await db.query(
        `
        SELECT
            a.article_id,
            a.title,
            a.url,
            a.source,
            a.published_at,
            aa.summary,
            aa.sentiment_label,
            aa.sentiment_score,
            aa.risk_score,
            aa.analysis_status,
            aa.analyzed_at
        FROM articles a
        INNER JOIN article_analysis aa
            ON a.article_id = aa.article_id
        WHERE aa.risk_score >= ?
        ORDER BY aa.risk_score DESC, aa.analyzed_at DESC
        `,
        [minRisk]
    );

    return rows;
}

async function findAll(keyword) {
    let sql = `
        SELECT *
        FROM articles
    `;
    const values = [];

    if (keyword) {
        sql += `
            WHERE title LIKE ?
            OR content LIKE ?
            OR source LIKE ?
        `;
        values.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    sql += ` ORDER BY collected_at DESC`;

    const [rows] = await db.query(sql, values);
    return rows;
}

async function findByIdWithAnalysis(articleId) {
    const [rows] = await db.query(
        `
        SELECT
            a.*,
            ${ANALYSIS_COLUMNS}
        FROM articles a
        LEFT JOIN article_analysis aa
            ON a.article_id = aa.article_id
        WHERE a.article_id = ?
        `,
        [articleId]
    );

    return rows[0] || null;
}

module.exports = {
    findIdByUrl,
    insertArticle,
    existsById,
    findByUrlWithAnalysis,
    findAnalyzedArticles,
    findRiskyArticles,
    findAll,
    findByIdWithAnalysis
};
