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
    aa.spam_override,
    aa.target_mention_type,
    aa.negative_impact_type,
    aa.media_influence,
    aa.issue_severity,
    aa.target_responsibility,
    aa.norm_violation,
    aa.similar_crisis_history,
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
            AND COALESCE(aa.spam_override, aa.target_related) = 1
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
            AND COALESCE(aa.spam_override, aa.target_related) = 1
        ORDER BY aa.risk_score DESC, aa.analyzed_at DESC
        `,
        [minRisk]
    );

    return rows;
}

async function findAll(keyword) {
    let sql = `
        SELECT a.*
        FROM articles a
        LEFT JOIN article_analysis aa
            ON a.article_id = aa.article_id
        WHERE (
            aa.article_id IS NULL
            OR COALESCE(aa.spam_override, aa.target_related) = 1
        )
    `;

    const values = [];

    if (keyword) {
        sql += `
            AND (
                a.title LIKE ?
                OR a.content LIKE ?
                OR a.source LIKE ?
            )
        `;
        values.push(
            `%${keyword}%`,
            `%${keyword}%`,
            `%${keyword}%`
        );
    }

    sql += ` ORDER BY a.collected_at DESC`;

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


async function findUnanalyzedArticles(limit = 10) {
    const [rows] = await db.query(
        `
        SELECT a.*
        FROM articles a
        WHERE NOT EXISTS (
            SELECT 1
            FROM article_analysis aa
            WHERE aa.article_id = a.article_id
        )
        ORDER BY a.collected_at ASC, a.article_id ASC
        LIMIT ?
        `,
        [limit]
    );

    return rows;
}

async function findSpamArticles() {
    const [rows] = await db.query(
        `
        SELECT
            a.*,
            ${ANALYSIS_COLUMNS}
        FROM articles a
        INNER JOIN article_analysis aa
            ON a.article_id = aa.article_id
        WHERE aa.analysis_status = 'completed'
          AND COALESCE(aa.spam_override, aa.target_related) = 0
        ORDER BY a.published_at DESC, a.article_id DESC
        `
    );

    return rows;
}

// 스팸 상태 변경 전 기존 기사 상태를 잠금 조회합니다.
async function findSpamStateForUpdate(connection, articleId) {
    const [rows] = await connection.query(
        `
        SELECT
            aa.article_id,
            aa.cluster_id,
            aa.cluster_key,
            aa.article_embedding,
            aa.target_related,
            aa.spam_override,
            COALESCE(aa.spam_override, aa.target_related) AS is_normal,

            a.title,

            aa.summary,
            aa.risk_score,
            aa.issue_type,
            aa.event_name,
            aa.event_date,
            aa.event_location,
            aa.event_entities,
            aa.event_keywords

        FROM article_analysis aa
        INNER JOIN articles a
            ON a.article_id = aa.article_id

        WHERE aa.article_id = ?
        FOR UPDATE
        `,
        [articleId]
    );

    return rows[0] || null;
}

// 사용자의 스팸 판정값을 변경합니다.
async function updateSpamOverride(connection, articleId, isSpam) {
    const [result] = await connection.query(
        `
        UPDATE article_analysis
        SET spam_override = ?
        WHERE article_id = ?
        `,
        [isSpam ? 0 : 1, articleId]
    );

    return result.affectedRows;
}

// 기사와 클러스터의 소속 관계를 변경합니다.
async function updateArticleCluster(connection, articleId, clusterId) {
    const [result] = await connection.query(
        `
        UPDATE article_analysis
        SET cluster_id = ?,
            cluster_key = CASE
                WHEN ? IS NULL THEN NULL
                ELSE cluster_key
            END
        WHERE article_id = ?
        `,
        [clusterId, clusterId, articleId]
    );

    return result.affectedRows;
}

async function restoreArticleCluster(
    connection,
    articleId,
    clusterId,
    clusterKey,
    articleEmbedding
) {
    const [result] = await connection.query(
        `
        UPDATE article_analysis
        SET
            cluster_id = ?,
            cluster_key = ?,
            article_embedding = ?
        WHERE article_id = ?
        `,
        [
            clusterId,
            clusterKey,
            articleEmbedding == null
                ? null
                : JSON.stringify(articleEmbedding),
            articleId
        ]
    );

    return result.affectedRows;
}

module.exports = {
    findIdByUrl,
    insertArticle,
    existsById,
    findByUrlWithAnalysis,
    findAnalyzedArticles,
    findRiskyArticles,
    findAll,
    findByIdWithAnalysis,
    findUnanalyzedArticles,
    findSpamArticles,
    findSpamStateForUpdate,
    updateSpamOverride,
    updateArticleCluster,
    restoreArticleCluster
};