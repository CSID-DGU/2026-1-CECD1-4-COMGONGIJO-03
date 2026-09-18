const express = require("express");
const db = require("./db");
const analyzeArticle = require("./ai/analyzeArticle");

const app = express();
app.use(express.json());

const OLLAMA_BASE_URL = "http://localhost:11434";
const EMBEDDING_MODEL = "bge-m3";

app.get("/", (req, res) => {
    res.send("server running");
});


// ============================================================
// 클러스터링 공통 함수
// ============================================================

// JSON 문자열로 저장된 배열을 안전하게 배열로 변환
function safeParseJsonArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}


// entity / keyword / cluster_key 비교용 정규화
function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^\w가-힣]/g, "");
}


// BGE-M3에 넣을 문자열용 정규화
// 의미 정보가 유지되도록 띄어쓰기는 제거하지 않음
function normalizeEmbeddingText(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
}


// 여러 문장을 한 번에 BGE-M3 임베딩
async function getEmbeddingMap(texts) {

    const uniqueTexts = [
        ...new Set(
            (texts || [])
                .map(normalizeEmbeddingText)
                .filter(Boolean)
        )
    ];

    const embeddingMap = new Map();

    if (uniqueTexts.length === 0) {
        return embeddingMap;
    }

    const response = await fetch(
        `${OLLAMA_BASE_URL}/api/embed`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: EMBEDDING_MODEL,
                input: uniqueTexts
            })
        }
    );

    if (!response.ok) {
        const errorText = await response.text();

        throw new Error(
            `BGE-M3 임베딩 요청 실패: ${response.status} ${errorText}`
        );
    }

    const data = await response.json();

    if (
        !Array.isArray(data.embeddings) ||
        data.embeddings.length !== uniqueTexts.length
    ) {
        throw new Error(
            "BGE-M3 임베딩 응답 형식이 올바르지 않습니다."
        );
    }

    for (let i = 0; i < uniqueTexts.length; i++) {
        embeddingMap.set(
            uniqueTexts[i],
            data.embeddings[i]
        );
    }

    return embeddingMap;
}


// 두 벡터의 cosine similarity 계산
function cosineSimilarity(vectorA, vectorB) {

    if (
        !Array.isArray(vectorA) ||
        !Array.isArray(vectorB) ||
        vectorA.length === 0 ||
        vectorA.length !== vectorB.length
    ) {
        return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
        dotProduct += vectorA[i] * vectorB[i];
        normA += vectorA[i] * vectorA[i];
        normB += vectorB[i] * vectorB[i];
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    const similarity =
        dotProduct /
        (Math.sqrt(normA) * Math.sqrt(normB));

    // 기존 점수식에서 0 ~ 1 값을 사용하므로 범위를 제한
    return Math.max(
        0,
        Math.min(1, similarity)
    );
}


// 두 문자열의 BGE-M3 의미 유사도 계산
function getEmbeddingSimilarity(
    textA,
    textB,
    embeddingMap
) {

    const normalizedA =
        normalizeEmbeddingText(textA);

    const normalizedB =
        normalizeEmbeddingText(textB);

    if (!normalizedA || !normalizedB) {
        return 0;
    }

    if (normalizedA === normalizedB) {
        return 1;
    }

    const embeddingA =
        embeddingMap.get(normalizedA);

    const embeddingB =
        embeddingMap.get(normalizedB);

    if (!embeddingA || !embeddingB) {
        return 0;
    }

    return cosineSimilarity(
        embeddingA,
        embeddingB
    );
}


// entity / keyword는 기존 방식 그대로 유지
function getArrayOverlapScore(
    newArray,
    oldArray
) {

    const newSet = new Set(
        (newArray || [])
            .map(normalizeText)
            .filter(Boolean)
    );

    const oldSet = new Set(
        (oldArray || [])
            .map(normalizeText)
            .filter(Boolean)
    );

    if (
        newSet.size === 0 ||
        oldSet.size === 0
    ) {
        return 0;
    }

    let overlap = 0;

    for (const item of newSet) {
        if (oldSet.has(item)) {
            overlap++;
        }
    }

    return (
        overlap /
        Math.max(
            newSet.size,
            oldSet.size
        )
    );
}


// ============================================================
// 1. 기사 저장 + AI 분석 + 분석 결과 저장
//    + 클러스터링 + 위험 알림 생성
// ============================================================

app.post("/api/articles", async (req, res) => {

    try {

        const {
            title,
            content,
            url,
            source,
            author,
            published_at
        } = req.body;


        if (!title || !url) {

            return res.status(400).json({
                success: false,
                message: "title과 url은 필수값입니다."
            });
        }


        // URL 중복 기사 확인
        const [existingRows] =
            await db.query(
                `
                SELECT article_id
                FROM articles
                WHERE url = ?
                `,
                [url]
            );


        if (existingRows.length > 0) {

            return res.status(409).json({
                success: false,
                message: "이미 저장된 기사입니다.",
                article_id:
                    existingRows[0].article_id
            });
        }


        // 기사 저장
        const insertArticleSql = `
            INSERT INTO articles
            (
                title,
                content,
                url,
                source,
                author,
                published_at,
                collected_at
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, NOW()
            )
        `;


        const [result] =
            await db.query(
                insertArticleSql,
                [
                    title,
                    content,
                    url,
                    source,
                    author,
                    published_at
                ]
            );


        const articleId =
            result.insertId;


        // AI 기사 분석
        const analysis =
            await analyzeArticle({
                title,
                content
            });


        console.log(
            "AI 분석 결과:",
            analysis
        );


        // 위험도 계산
        const riskScore = (
            Number(
                analysis.issue_severity || 0
            ) * 0.3 +

            Number(
                analysis.public_sensitivity || 0
            ) * 0.25 +

            Number(
                analysis.target_responsibility || 0
            ) * 0.25 +

            Number(
                analysis.spread_potential || 0
            ) * 0.2
        );


        // ====================================================
        // 클러스터링 시작
        // ====================================================


        const clusterKey = [
            analysis.issue_type || "etc",

            normalizeText(
                analysis.event_name || title
            ) || "no_event"

        ].join("-");


        let clusterId = null;


        // 후보 클러스터 조회
        //
        // 기존과 거의 동일하지만
        // 최신 article의 실제 title도 같이 가져옴
        const [candidateClusters] =
            await db.query(
                `
                SELECT
                    c.cluster_id,
                    c.cluster_key,
                    c.representative_title,
                    c.issue_type,
                    c.last_detected,
                    c.article_count,
                    c.max_risk_score,

                    aa.event_name,
                    aa.event_location,
                    aa.event_entities,
                    aa.event_keywords,

                    latest_article.title
                        AS latest_article_title

                FROM clusters c

                LEFT JOIN article_analysis aa
                    ON aa.analysis_id = (
                        SELECT aa2.analysis_id
                        FROM article_analysis aa2
                        WHERE
                            aa2.cluster_id =
                            c.cluster_id
                        ORDER BY
                            aa2.analyzed_at DESC
                        LIMIT 1
                    )

                LEFT JOIN articles latest_article
                    ON latest_article.article_id =
                       aa.article_id

                WHERE
                    c.last_detected >= CURDATE()

                ORDER BY
                    c.last_detected DESC
                `
            );


        // ----------------------------------------------------
        // 이번 기사 + 후보 클러스터들의 텍스트를
        // BGE-M3로 한 번에 임베딩
        // ----------------------------------------------------

        const embeddingTexts = [];


        // 새 기사 event_name
        embeddingTexts.push(
            analysis.event_name || title
        );


        // 새 기사 실제 제목
        embeddingTexts.push(
            title
        );


        // 새 기사 location
        if (analysis.event_location) {
            embeddingTexts.push(
                analysis.event_location
            );
        }


        for (
            const cluster
            of candidateClusters
        ) {

            embeddingTexts.push(
                cluster.event_name ||
                cluster.representative_title
            );


            embeddingTexts.push(
                cluster.latest_article_title ||
                cluster.representative_title
            );


            if (cluster.event_location) {
                embeddingTexts.push(
                    cluster.event_location
                );
            }
        }


        const embeddingMap =
            await getEmbeddingMap(
                embeddingTexts
            );


        let bestCluster = null;
        let bestScore = 0;


        // ----------------------------------------------------
        // 클러스터링 점수 계산
        //
        // 기존:
        //
        // issue_type      15
        // event_name      45
        // entity          15
        // keyword         20
        // location         5
        //
        // 변경:
        //
        // issue_type      15
        // event_name      25
        // title           20
        // entity          15
        // keyword         20
        // location         5
        //
        // 총점은 그대로 100점
        // ----------------------------------------------------

        for (
            const cluster
            of candidateClusters
        ) {

            let score = 0;


            // issue_type
            // 기존 방식 그대로 유지
            if (
                cluster.issue_type ===
                analysis.issue_type
            ) {
                score += 15;
            }


            // -----------------------------------------------
            // event_name 의미 유사도
            // 기존 문자 겹침 -> BGE-M3
            // -----------------------------------------------

            const eventNameSimilarity =
                getEmbeddingSimilarity(
                    analysis.event_name || title,

                    cluster.event_name ||
                    cluster.representative_title,

                    embeddingMap
                );


            score +=
                eventNameSimilarity * 25;


            // -----------------------------------------------
            // 실제 기사 title 의미 유사도
            // 새로 추가
            // -----------------------------------------------

            const titleSimilarity =
                getEmbeddingSimilarity(
                    title,

                    cluster.latest_article_title ||
                    cluster.representative_title,

                    embeddingMap
                );


            score +=
                titleSimilarity * 20;


            // -----------------------------------------------
            // entity overlap
            // 기존 방식 그대로
            // -----------------------------------------------

            const oldEntities =
                safeParseJsonArray(
                    cluster.event_entities
                );


            const entityOverlap =
                getArrayOverlapScore(
                    analysis.event_entities || [],
                    oldEntities
                );


            score +=
                entityOverlap * 15;


            // -----------------------------------------------
            // keyword overlap
            // 기존 방식 그대로
            // -----------------------------------------------

            const oldKeywords =
                safeParseJsonArray(
                    cluster.event_keywords
                );


            const keywordOverlap =
                getArrayOverlapScore(
                    analysis.event_keywords || [],
                    oldKeywords
                );


            score +=
                keywordOverlap * 20;


            // -----------------------------------------------
            // location
            // 기존 문자 유사도 대신 BGE-M3 의미 유사도
            // 가중치는 그대로 5
            // -----------------------------------------------

            const locationSimilarity =
                getEmbeddingSimilarity(
                    analysis.event_location,
                    cluster.event_location,
                    embeddingMap
                );


            score +=
                locationSimilarity * 5;


            console.log(
                "후보:",
                cluster.cluster_id,
                cluster.representative_title,

                "event_name:",
                eventNameSimilarity.toFixed(3),

                "title:",
                titleSimilarity.toFixed(3),

                "entity:",
                entityOverlap.toFixed(3),

                "keyword:",
                keywordOverlap.toFixed(3),

                "location:",
                locationSimilarity.toFixed(3),

                "총점:",
                score.toFixed(2)
            );


            if (score > bestScore) {

                bestScore = score;
                bestCluster = cluster;
            }
        }


        // 기존 threshold 그대로 유지
        const clusterMatchThreshold = 60;


        if (
            bestCluster &&
            bestScore >=
                clusterMatchThreshold
        ) {

            // 기존 클러스터에 추가
            clusterId =
                bestCluster.cluster_id;


            await db.query(
                `
                UPDATE clusters
                SET
                    last_detected = NOW(),
                    article_count =
                        article_count + 1,
                    max_risk_score =
                        GREATEST(
                            max_risk_score,
                            ?
                        )
                WHERE cluster_id = ?
                `,
                [
                    riskScore,
                    clusterId
                ]
            );

        } else {

            // 새로운 클러스터 생성
            const [clusterResult] =
                await db.query(
                    `
                    INSERT INTO clusters
                    (
                        cluster_key,
                        representative_title,
                        issue_type,
                        first_detected,
                        last_detected,
                        article_count,
                        max_risk_score,
                        cluster_status
                    )
                    VALUES (
                        ?, ?, ?,
                        NOW(),
                        NOW(),
                        1,
                        ?,
                        'active'
                    )
                    `,
                    [
                        clusterKey,

                        analysis.event_name ||
                        title,

                        analysis.issue_type ||
                        "etc",

                        riskScore
                    ]
                );


            clusterId =
                clusterResult.insertId;
        }


        // ====================================================
        // 클러스터링 끝
        // ====================================================


        // 분석 결과 저장
        const insertAnalysisSql = `
            INSERT INTO article_analysis (
                article_id,
                cluster_id,
                summary,
                sentiment_label,
                sentiment_score,

                target_name,
                issue_type,
                event_name,
                event_date,
                event_location,
                event_entities,
                event_keywords,

                target_related,
                target_mention_type,
                negative_impact_type,

                issue_severity,
                public_sensitivity,
                target_responsibility,
                spread_potential,
                risk_factor_reason,

                risk_score,
                cluster_key,

                analysis_status,
                analyzed_at
            )
            VALUES (
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?,
                ?, NOW()
            )
        `;


        const [analysisResult] =
            await db.query(
                insertAnalysisSql,
                [
                    articleId,
                    clusterId,

                    analysis.summary,
                    analysis.sentiment_label,
                    analysis.sentiment_score,

                    analysis.target_name,
                    analysis.issue_type,
                    analysis.event_name,
                    analysis.event_date,
                    analysis.event_location,

                    JSON.stringify(
                        analysis.event_entities || []
                    ),

                    JSON.stringify(
                        analysis.event_keywords || []
                    ),

                    analysis.target_related,
                    analysis.target_mention_type,
                    analysis.negative_impact_type,

                    analysis.issue_severity,
                    analysis.public_sensitivity,
                    analysis.target_responsibility,
                    analysis.spread_potential,
                    analysis.risk_factor_reason,

                    riskScore,
                    clusterKey,

                    "completed"
                ]
            );


        let alertCreated = false;
        let alertId = null;


        const riskThreshold = 0.7;


        // ====================================================
        // cluster 단위 위험 알림 생성
        // ====================================================

        if (
            riskScore >= riskThreshold &&
            analysis.alert_topic
        ) {

            const [existingAlerts] =
                await db.query(
                    `
                    SELECT alert_id
                    FROM alerts
                    WHERE cluster_id = ?
                    LIMIT 1
                    `,
                    [clusterId]
                );


            // 같은 cluster에는
            // 이미 알림이 있으면
            // 새로운 알림을 생성하지 않음
            if (
                existingAlerts.length === 0
            ) {

                const [alertResult] =
                    await db.query(
                        `
                        INSERT INTO alerts
                        (
                            article_id,
                            cluster_id,
                            alert_topic,
                            alert_message,
                            risk_score,
                            alert_status,
                            created_at
                        )
                        VALUES (
                            ?, ?, ?, ?, ?,
                            'created',
                            NOW()
                        )
                        `,
                        [
                            articleId,
                            clusterId,

                            analysis.alert_topic,

                            analysis.alert_message ||
                            analysis.summary ||
                            "위험 기사 감지",

                            riskScore
                        ]
                    );


                alertCreated = true;

                alertId =
                    alertResult.insertId;

            } else {

                alertCreated = false;

                alertId =
                    existingAlerts[0]
                        .alert_id;
            }
        }


        res.json({
            success: true,

            message:
                "기사 저장 + AI 분석 + 분석 결과 저장 + 클러스터링 완료",

            article_id:
                articleId,

            analysis_id:
                analysisResult.insertId,

            cluster_id:
                clusterId,

            cluster_key:
                clusterKey,

            cluster_score:
                bestScore,

            risk_score:
                riskScore,

            alert_created:
                alertCreated,

            alert_id:
                alertId,

            analysis
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message:
                "기사 저장 또는 분석 처리 실패"
        });
    }
});


// ============================================================
// 2. 분석 결과 저장 + 위험하면 알림 생성
// 이 버전에서는 안 쓰는 것이 좋음
// ============================================================

app.post(
    "/api/articles/:article_id/analysis",
    async (req, res) => {

        try {

            const { article_id } =
                req.params;


            const {
                summary,
                sentiment_label,
                sentiment_score,
                risk_score,
                analysis_status,
                alert_topic,
                alert_message
            } = req.body;


            const [articleRows] =
                await db.query(
                    `
                    SELECT article_id
                    FROM articles
                    WHERE article_id = ?
                    `,
                    [article_id]
                );


            if (
                articleRows.length === 0
            ) {

                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "해당 기사가 존재하지 않습니다."
                    });
            }


            const insertAnalysisSql = `
                INSERT INTO article_analysis
                (
                    article_id,
                    summary,
                    sentiment_label,
                    sentiment_score,
                    risk_score,
                    analysis_status,
                    analyzed_at
                )
                VALUES (
                    ?, ?, ?, ?, ?, ?, NOW()
                )
            `;


            const [analysisResult] =
                await db.query(
                    insertAnalysisSql,
                    [
                        article_id,
                        summary,
                        sentiment_label,
                        sentiment_score,
                        risk_score,

                        analysis_status ||
                        "completed"
                    ]
                );


            let alertCreated = false;
            let alertId = null;


            const riskThreshold = 0.7;


            if (
                risk_score >=
                    riskThreshold &&
                alert_topic
            ) {

                const [duplicateAlerts] =
                    await db.query(
                        `
                        SELECT alert_id
                        FROM alerts
                        WHERE
                            alert_topic = ?
                        AND
                            created_at >=
                            NOW()
                            - INTERVAL 1 HOUR
                        LIMIT 1
                        `,
                        [alert_topic]
                    );


                if (
                    duplicateAlerts.length === 0
                ) {

                    const [alertResult] =
                        await db.query(
                            `
                            INSERT INTO alerts
                            (
                                article_id,
                                alert_topic,
                                alert_message,
                                risk_score,
                                alert_status,
                                created_at
                            )
                            VALUES (
                                ?, ?, ?, ?,
                                'created',
                                NOW()
                            )
                            `,
                            [
                                article_id,
                                alert_topic,

                                alert_message ||
                                summary ||
                                "위험 기사 감지",

                                risk_score
                            ]
                        );


                    alertCreated = true;

                    alertId =
                        alertResult.insertId;
                }
            }


            res.json({
                success: true,
                message:
                    "분석 결과 저장 성공",
                analysis_id:
                    analysisResult.insertId,
                alert_created:
                    alertCreated,
                alert_id:
                    alertId
            });


        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "분석 결과 저장 실패"
            });
        }
    }
);


// ============================================================
// 3. URL로 기사 조회
// ============================================================

app.get(
    "/api/articles/by-url/search",
    async (req, res) => {

        try {

            const { url } =
                req.query;


            if (!url) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "url이 필요합니다."
                    });
            }


            const [rows] =
                await db.query(
                    `
                    SELECT
                        a.*,

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

                    FROM articles a

                    LEFT JOIN article_analysis aa
                        ON
                            a.article_id =
                            aa.article_id

                    WHERE a.url = ?
                    `,
                    [url]
                );


            if (rows.length === 0) {

                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "기사를 찾을 수 없습니다."
                    });
            }


            res.json({
                success: true,
                article: rows[0]
            });


        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "URL 기사 조회 실패"
            });
        }
    }
);


// ============================================================
// 4. 분석 완료 기사 목록 조회
// ============================================================

app.get(
    "/api/articles/analyzed/list",
    async (req, res) => {

        try {

            const [rows] =
                await db.query(
                    `
                    SELECT
                        a.*,

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

                    FROM articles a

                    INNER JOIN article_analysis aa
                        ON
                            a.article_id =
                            aa.article_id

                    WHERE
                        aa.analysis_status =
                        'completed'

                    ORDER BY
                        aa.analyzed_at DESC
                    `
                );


            res.json({
                success: true,
                count: rows.length,
                articles: rows
            });


        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "분석 완료 기사 조회 실패"
            });
        }
    }
);


// ============================================================
// 5. 위험 기사 목록 조회
// ============================================================

app.get(
    "/api/articles/risky/list",
    async (req, res) => {

        try {

            const minRisk =
                req.query.minRisk || 0.7;


            const [rows] =
                await db.query(
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
                        ON
                            a.article_id =
                            aa.article_id

                    WHERE
                        aa.risk_score >= ?

                    ORDER BY
                        aa.risk_score DESC,
                        aa.analyzed_at DESC
                    `,
                    [minRisk]
                );


            res.json({
                success: true,
                count: rows.length,
                articles: rows
            });


        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "위험 기사 조회 실패"
            });
        }
    }
);


// ============================================================
// 6. 알림 목록 조회
// ============================================================

app.get(
    "/api/alerts",
    async (req, res) => {

        try {

            const [rows] =
                await db.query(
                    `
                    SELECT
                        al.alert_id,
                        al.article_id,
                        al.cluster_id,
                        al.alert_topic,
                        al.alert_message,
                        al.risk_score,
                        al.alert_status,
                        al.created_at,

                        a.title,
                        a.url,
                        a.source

                    FROM alerts al

                    INNER JOIN articles a
                        ON
                            al.article_id =
                            a.article_id

                    ORDER BY
                        al.created_at DESC
                    `
                );


            res.json({
                success: true,
                count: rows.length,
                alerts: rows
            });


        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "알림 조회 실패"
            });
        }
    }
);


// ============================================================
// 7. 전체 기사 조회 + 키워드 검색
// ============================================================

// TODO :
// 추후 속도에 문제 생길 수 있음
// 키워드를 뽑아내 저장한 뒤
// 뽑아낸 키워드를 검색하는 쪽이나
// 본문을 제외하고 검색하거나
// 기간을 제한하는 쪽으로 수정

app.get(
    "/api/articles",
    async (req, res) => {

        try {

            const { keyword } =
                req.query;


            let sql = `
                SELECT *
                FROM articles
            `;


            const values = [];


            if (keyword) {

                sql += `
                    WHERE
                        title LIKE ?
                    OR
                        content LIKE ?
                    OR
                        source LIKE ?
                `;


                values.push(
                    `%${keyword}%`,
                    `%${keyword}%`,
                    `%${keyword}%`
                );
            }


            sql += `
                ORDER BY
                    collected_at DESC
            `;


            const [rows] =
                await db.query(
                    sql,
                    values
                );


            res.json({
                success: true,
                count: rows.length,
                articles: rows
            });


        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "기사 조회 실패"
            });
        }
    }
);


// ============================================================
// 8. article_id로 기사 + 분석 결과 조회
// ============================================================

app.get(
    "/api/articles/:article_id",
    async (req, res) => {

        try {

            const { article_id } =
                req.params;


            const [rows] =
                await db.query(
                    `
                    SELECT
                        a.*,

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

                    FROM articles a

                    LEFT JOIN article_analysis aa
                        ON
                            a.article_id =
                            aa.article_id

                    WHERE
                        a.article_id = ?
                    `,
                    [article_id]
                );


            if (rows.length === 0) {

                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "기사를 찾을 수 없습니다."
                    });
            }


            res.json({
                success: true,
                article: rows[0]
            });


        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "기사 조회 실패"
            });
        }
    }
);


// ============================================================
// 9. 클러스터 목록 조회
// ============================================================

app.get(
    "/api/clusters",
    async (req, res) => {

        try {

            const [rows] =
                await db.query(
                    `
                    SELECT
                        c.cluster_id,
                        c.cluster_key,
                        c.representative_title,
                        c.issue_type,
                        c.first_detected,
                        c.last_detected,
                        c.article_count,
                        c.max_risk_score,
                        c.cluster_status

                    FROM clusters c

                    ORDER BY
                        c.max_risk_score DESC,
                        c.last_detected DESC
                    `
                );


            res.json({
                success: true,
                count: rows.length,
                clusters: rows
            });


        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "클러스터 조회 실패"
            });
        }
    }
);


// ============================================================
// 서버 시작
// ============================================================

app.listen(3000, () => {
    console.log("server start");
});
