const db = require("../db");

/*
 * 기사를 스팸기사함에 등록합니다.
 */
async function insertSpamArticle({
    articleId,
    analysisId,
    spamSource = "AI"
}) {
    const [result] = await db.query(
        `
        INSERT INTO spam_articles (
            article_id,
            analysis_id,
            spam_source,
            filtered_at
        )
        VALUES (?, ?, ?, NOW())
        `,
        [
            articleId,
            analysisId,
            spamSource
        ]
    );

    return result.insertId;
}

/*
 * 스팸기사함의 기사 목록을 조회합니다.
 *
 * 실제 기사 정보는 articles에서,
 * AI 요약 및 관련성 판정은 article_analysis에서 가져옵니다.
 */
async function findSpamArticles() {
    const [rows] = await db.query(
        `
        SELECT
            s.spam_id,
            s.spam_source,
            s.filtered_at,

            a.article_id,
            a.title,
            a.url,
            a.source,
            a.author,
            a.published_at,
            a.collected_at,

            aa.analysis_id,
            aa.summary,
            aa.target_name,
            aa.target_related,
            aa.target_mention_type,
            aa.analysis_status

        FROM spam_articles s

        INNER JOIN articles a
            ON s.article_id = a.article_id

        INNER JOIN article_analysis aa
            ON s.analysis_id = aa.analysis_id

        ORDER BY s.filtered_at DESC
        `
    );

    return rows;
}

module.exports = {
    insertSpamArticle,
    findSpamArticles
};