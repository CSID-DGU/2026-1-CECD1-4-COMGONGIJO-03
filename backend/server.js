const express = require("express");
const cors = require("cors");
const db = require("./db");
const analyzeArticle = require("./ai/analyzeArticle");
const { getEmbedding, cosineSimilarity } = require("./ai/embedding");

const embeddingCache = new Map();

async function getCachedEmbedding(text) {
    if (!text) return null;

    if (embeddingCache.has(text)) {
        console.log("캐시 히트");
        return embeddingCache.get(text);
    }

    const embedding = await getEmbedding(text);

    embeddingCache.set(text, embedding);

    return embedding;
}


const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("server running");
});

// 1. 기사 저장 + AI 분석 + 분석 결과 저장 + 클러스터링 + 위험 알림 생성
// 2번 기능을 포함하고 있음
// 현재 클러스터링 기능 작동 비정상, 구현 방식 바꿔야함
// 추후 분리 예정
app.post("/api/articles", async (req, res) => {
    try {
        const { title, content, url, source, author, published_at } = req.body;

        if (!title || !url) {
            return res.status(400).json({
                success: false,
                message: "title과 url은 필수값입니다."
            });
        }

        const [existingRows] = await db.query(
            "SELECT article_id FROM articles WHERE url = ?",
            [url]
        );

        if (existingRows.length > 0) {
            return res.status(409).json({
                success: false,
                message: "이미 저장된 기사입니다.",
                article_id: existingRows[0].article_id
            });
        }

        const insertArticleSql = `
            INSERT INTO articles
            (title, content, url, source, author, published_at, collected_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
        `;

        const [result] = await db.query(insertArticleSql, [
            title,
            content,
            url,
            source,
            author,
            published_at
        ]);

        const articleId = result.insertId;

        const analysis = await analyzeArticle({
            title,
            content
        });

        console.log("AI 분석 결과:", analysis);

        const riskScore = (
            Number(analysis.issue_severity || 0) * 0.3 +
            Number(analysis.public_sensitivity || 0) * 0.25 +
            Number(analysis.target_responsibility || 0) * 0.25 +
            Number(analysis.spread_potential || 0) * 0.2
        );

        // ===== 클러스터링 시작 =====
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

        function normalizeText(value) {
            return String(value || "")
                .toLowerCase()
                .replace(/\s+/g, "")
                .replace(/[^\w가-힣]/g, "");
        }

        function normalizeKeyword(value) {
            return normalizeText(value)
                .replace(/사고$/, "")
                .replace(/논란$/, "")
                .replace(/문제$/, "");
        }

        // [수정] 단순 글자 매칭에서 2글자 쌍(Bi-gram) 비교 방식으로 변경하여 단어 유사도 정확도 향상
        function getTextSimilarity(a, b) {
            const textA = normalizeText(a);
            const textB = normalizeText(b);

            if (!textA || !textB) return 0;
            if (textA === textB) return 1;
            if (textA.includes(textB) || textB.includes(textA)) return 0.8;

            const getBigrams = str => {
                const bigrams = new Set();
                for (let i = 0; i < str.length - 1; i++) {
                    bigrams.add(str.substr(i, 2));
                }
                return bigrams;
            };

            const setA = getBigrams(textA);
            const setB = getBigrams(textB);
            
            if (setA.size === 0 || setB.size === 0) return 0;

            let intersection = 0;
            for (const token of setA) {
                if (setB.has(token)) intersection++;
            }

            return intersection / Math.max(setA.size, setB.size);
        }

        function getKeywordMatchScore(newKeywords, oldKeywords) {
            const newSet = [...new Set((newKeywords || []).map(normalizeKeyword).filter(Boolean))];
            const oldSet = [...new Set((oldKeywords || []).map(normalizeKeyword).filter(Boolean))];

            if (newSet.length === 0 || oldSet.length === 0) {
                return {
                    score: 0,
                    exactMatchCount: 0,
                    similarMatchCount: 0,
                    matchedKeywords: []
                };
            }

            let exactMatchCount = 0;
            let similarMatchCount = 0;
            const matchedKeywords = [];

            for (const newKeyword of newSet) {
                let matched = false;

                for (const oldKeyword of oldSet) {
                    if (newKeyword === oldKeyword) {
                        exactMatchCount++;
                        matchedKeywords.push(newKeyword);
                        matched = true;
                        break;
                    }
                }

                if (matched) continue;

                for (const oldKeyword of oldSet) {
                    const similarity = getTextSimilarity(newKeyword, oldKeyword);

                    if (similarity >= 0.75) {
                        similarMatchCount++;
                        matchedKeywords.push(`${newKeyword}~${oldKeyword}`);
                        break;
                    }
                }
            }

            const score = Math.min(
                100,
                exactMatchCount * 15 + similarMatchCount * 8
            );

            return {
                score,
                exactMatchCount,
                similarMatchCount,
                matchedKeywords
            };
        }

        function isSimilarIssueType(a, b) {
            const typeA = String(a || "").trim();
            const typeB = String(b || "").trim();

            if (!typeA || !typeB) return false;
            if (typeA === typeB) return true;

            const similarGroups = [
                ["safety", "accident", "facility", "service_disruption"],
                ["service", "service_disruption", "congestion"],
                ["labor", "strike"]
            ];

            return similarGroups.some(group =>
                group.includes(typeA) && group.includes(typeB)
            );
        }

        function normalizeIssueTypeForCluster(issueType) {
            const type = String(issueType || "etc").trim();

            if (["safety", "accident", "facility", "service_disruption"].includes(type)) {
                return "incident";
            }

            return type || "etc";
        }

        function makeKeywordSentence(keywords) {
            return [...new Set((keywords || []).map(normalizeKeyword).filter(Boolean))]
                .slice(0, 10)
                .join(" ");
        }

        const newKeywords = Array.isArray(analysis.event_keywords)
            ? analysis.event_keywords
            : [];
        const newKeywordSentence = makeKeywordSentence(newKeywords);

        let newEmbedding = null;

        try {
            if (newKeywordSentence) {
                newEmbedding = await getCachedEmbedding(newKeywordSentence);
            }
        } catch (error) {
            console.error("새 기사 임베딩 생성 실패:", error.message);
        }





        const clusterIssueType = normalizeIssueTypeForCluster(analysis.issue_type);

        const clusterKey = [
            clusterIssueType,
            newKeywords.map(normalizeKeyword).filter(Boolean).slice(0, 5).join("-") || normalizeText(analysis.event_name || title) || "no_event"
        ].join("-");

        let clusterId = null;

        const [candidateClusters] = await db.query(
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
                aa.event_keywords
            FROM clusters c
            LEFT JOIN article_analysis aa
                ON aa.analysis_id = (
                    SELECT aa2.analysis_id
                    FROM article_analysis aa2
                    WHERE aa2.cluster_id = c.cluster_id
                    ORDER BY aa2.analyzed_at DESC
                    LIMIT 1
                )
            WHERE c.last_detected >= CURDATE()
            ORDER BY c.last_detected DESC
            `
        );

        let bestCluster = null;
        let bestScore = 0;

        // 클러스터링 계산식 개선 루프
        for (const cluster of candidateClusters) {
            let score = 0;

            const oldKeywords = safeParseJsonArray(cluster.event_keywords);
            const keywordResult = getKeywordMatchScore(newKeywords, oldKeywords);

            // 1. 핵심 기준: 키워드 일치도
            let embeddingSimilarity = 0;
            let embeddingScore = 0;

            try {
                const oldKeywordSentence = makeKeywordSentence(oldKeywords);

                if (newEmbedding && oldKeywordSentence) {
                    const oldEmbedding = await getCachedEmbedding(oldKeywordSentence);
                    embeddingSimilarity = cosineSimilarity(newEmbedding, oldEmbedding);
                    embeddingScore = embeddingSimilarity * 100;
                }
            } catch (error) {
                console.error("기존 클러스터 임베딩 생성 실패:", error.message);
            }

            // 핵심 기준: 키워드 문장 임베딩 유사도
            score += embeddingScore * 0.45;

            // 보조 기준: 기존 키워드 직접 일치도
            score += keywordResult.score * 0.3;



            // 2. 보조 기준: 사건명 유사도 [점수 대폭 상향: 기존 15점 -> 35점]
            const eventNameSimilarity = getTextSimilarity(
                analysis.event_name || title,
                cluster.event_name || cluster.representative_title
            );
            score += eventNameSimilarity * 35;

            if (
                keywordResult.exactMatchCount === 0 &&
                keywordResult.similarMatchCount === 0 &&
                eventNameSimilarity < 0.2
            ) {
                score = Math.min(score, 45);
            }

            // [추가 보너스] 사건명이 완전히 똑같거나 한쪽을 포함하고 있으면 무조건 묶이게 가중치 추가
            const normNewName = normalizeText(analysis.event_name || title);
            const normOldName = normalizeText(cluster.event_name || cluster.representative_title);
            if (normNewName && normOldName && (normNewName.includes(normOldName) || normOldName.includes(normNewName))) {
                score += 20;
            }

            // 3. 보조 기준: 장소 유사도 [점수 유지]
            const locationSimilarity = getTextSimilarity(
                analysis.event_location,
                cluster.event_location
            );
            score += locationSimilarity * 5;

            // 4. 보조 기준: issue_type 유사도 [점수 유지]
            if (cluster.issue_type === clusterIssueType || cluster.issue_type === analysis.issue_type) {
                score += 10;
            } else if (isSimilarIssueType(cluster.issue_type, analysis.issue_type)) {
                score += 5;
            }

            // [수정] 40점 낙인 조건 완화: 키워드도 안 겹치고 '동시에' 사건명 유사도까지 낮을 때만 제한 적용
            const totalMatchCount = keywordResult.exactMatchCount + keywordResult.similarMatchCount;
            if (totalMatchCount < 1 && eventNameSimilarity < 0.6) {
                score = Math.min(score, 40); 
            }

            console.log(
                "후보:", cluster.cluster_id, cluster.representative_title,
                "최종점수:", score,
                "키워드일치:", keywordResult.exactMatchCount,
                "사건명유사도:", eventNameSimilarity
            );

            if (score > bestScore) {
                bestScore = score;
                bestCluster = cluster;
            }
        }

        const clusterMatchThreshold = 70; 

        if (bestCluster && bestScore >= clusterMatchThreshold) {
            clusterId = bestCluster.cluster_id;

            await db.query(
                `
                UPDATE clusters
                SET
                    last_detected = NOW(),
                    article_count = article_count + 1,
                    max_risk_score = GREATEST(max_risk_score, ?)
                WHERE cluster_id = ?
                `,
                [riskScore, clusterId]
            );
        } else {
            const [clusterResult] = await db.query(
                `
                INSERT INTO clusters (
                    cluster_key,
                    representative_title,
                    issue_type,
                    first_detected,
                    last_detected,
                    article_count,
                    max_risk_score,
                    cluster_status
                )
                VALUES (?, ?, ?, NOW(), NOW(), 1, ?, 'active')
                `,
                [
                    clusterKey,
                    analysis.event_name || title,
                    clusterIssueType,
                    riskScore
                ]
            );

            clusterId = clusterResult.insertId;
        }
        // ===== 클러스터링 끝 =====

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

        const [analysisResult] = await db.query(insertAnalysisSql, [
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
            JSON.stringify(analysis.event_entities || []),
            JSON.stringify(analysis.event_keywords || []),

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
        ]);

        let alertCreated = false;
        let alertId = null;

        const riskThreshold = 0.6;

        // ===== cluster 단위 위험 알림 생성 시작 =====
        // 같은 cluster_id에 대해 이미 알림이 있으면 새 알림을 만들지 않음
        if (riskScore >= riskThreshold && analysis.alert_topic) {
            const [existingAlerts] = await db.query(
                `
                SELECT alert_id
                FROM alerts
                WHERE cluster_id = ?
                LIMIT 1
                `,
                [clusterId]
            );

            if (existingAlerts.length === 0) {
                const [alertResult] = await db.query(
                    `
                    INSERT INTO alerts
                    (article_id, cluster_id, alert_topic, alert_message, risk_score, alert_status, created_at)
                    VALUES (?, ?, ?, ?, ?, 'created', NOW())
                    `,
                    [
                        articleId,
                        clusterId,
                        analysis.alert_topic,
                        analysis.alert_message || analysis.summary || "위험 기사 감지",
                        riskScore
                    ]
                );

                alertCreated = true;
                alertId = alertResult.insertId;
            } else {
                alertCreated = false;
                alertId = existingAlerts[0].alert_id;
            }
        }
        // ===== cluster 단위 위험 알림 생성 끝 =====

        res.json({
            success: true,
            message: "기사 저장 + AI 분석 + 분석 결과 저장 + 클러스터링 완료",
            article_id: articleId,
            analysis_id: analysisResult.insertId,
            cluster_id: clusterId,
            cluster_key: clusterKey,
            risk_score: riskScore,
            alert_created: alertCreated,
            alert_id: alertId,
            analysis
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "기사 저장 또는 분석 처리 실패"
        });
    }
});

// 2. 분석 결과 저장 + 위험하면 알림 생성
// 이 버전에서 안쓰는게 좋음
app.post("/api/articles/:article_id/analysis", async (req, res) => {
    try {
        const { article_id } = req.params;

        const {
            summary,
            sentiment_label,
            sentiment_score,
            risk_score,
            analysis_status,
            alert_topic,
            alert_message
        } = req.body;

        const [articleRows] = await db.query(
            "SELECT article_id FROM articles WHERE article_id = ?",
            [article_id]
        );

        if (articleRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "해당 기사가 존재하지 않습니다."
            });
        }

        const insertAnalysisSql = `
            INSERT INTO article_analysis
            (article_id, summary, sentiment_label, sentiment_score, risk_score, analysis_status, analyzed_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
        `;

        const [analysisResult] = await db.query(insertAnalysisSql, [
            article_id,
            summary,
            sentiment_label,
            sentiment_score,
            risk_score,
            analysis_status || "completed"
        ]);

        let alertCreated = false;
        let alertId = null;

        const riskThreshold = 0.6;

        if (risk_score >= riskThreshold && alert_topic) {
            const [duplicateAlerts] = await db.query(
                `
                SELECT alert_id
                FROM alerts
                WHERE alert_topic = ?
                AND created_at >= NOW() - INTERVAL 1 HOUR
                LIMIT 1
                `,
                [alert_topic]
            );

            if (duplicateAlerts.length === 0) {
                const [alertResult] = await db.query(
                    `
                    INSERT INTO alerts
                    (article_id, alert_topic, alert_message, risk_score, alert_status, created_at)
                    VALUES (?, ?, ?, ?, 'created', NOW())
                    `,
                    [
                        article_id,
                        alert_topic,
                        alert_message || summary || "위험 기사 감지",
                        risk_score
                    ]
                );

                alertCreated = true;
                alertId = alertResult.insertId;
            }
        }

        res.json({
            success: true,
            message: "분석 결과 저장 성공",
            analysis_id: analysisResult.insertId,
            alert_created: alertCreated,
            alert_id: alertId
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "분석 결과 저장 실패"
        });
    }
});

// 3. URL로 기사 조회
app.get("/api/articles/by-url/search", async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({
                success: false,
                message: "url이 필요합니다."
            });
        }

        const [rows] = await db.query(
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
            ON a.article_id = aa.article_id
            WHERE a.url = ?
            `,
            [url]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "기사를 찾을 수 없습니다."
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
            message: "URL 기사 조회 실패"
        });
    }
});

// 4. 분석 완료 기사 목록 조회
app.get("/api/articles/analyzed/list", async (req, res) => {
    try {
        const [rows] = await db.query(
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
            ON a.article_id = aa.article_id
            WHERE aa.analysis_status = 'completed'
            ORDER BY aa.analyzed_at DESC
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
            message: "분석 완료 기사 조회 실패"
        });
    }
});

// 5. 위험 기사 목록 조회
app.get("/api/articles/risky/list", async (req, res) => {
    try {
        const minRisk = req.query.minRisk || 0.7;

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

        res.json({
            success: true,
            count: rows.length,
            articles: rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "위험 기사 조회 실패"
        });
    }
});

// 6. 알림 목록 조회
app.get("/api/alerts", async (req, res) => {
    try {
        const [rows] = await db.query(
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
            ON al.article_id = a.article_id
            ORDER BY al.created_at DESC
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
            message: "알림 조회 실패"
        });
    }
});

// 7. 전체 기사 조회 + 키워드 검색
// TODO :
// 추후 속도에 문제 생길 수 있음
// 키워드를 뽑아내 저장한 뒤 뽑아낸 키워드를 검색하는쪽이나
// 본문을 제외하고 검색하거나 기간을 제한하는 쪽으로 수정
app.get("/api/articles", async (req, res) => {
    try {
        const { keyword } = req.query;

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

            values.push(
                `%${keyword}%`,
                `%${keyword}%`,
                `%${keyword}%`
            );
        }

        sql += `
            ORDER BY collected_at DESC
        `;

        const [rows] = await db.query(sql, values);

        res.json({
            success: true,
            count: rows.length,
            articles: rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "기사 조회 실패"
        });
    }
});

// 8. article_id로 기사 + 분석 결과 조회
app.get("/api/articles/:article_id", async (req, res) => {
    try {
        const { article_id } = req.params;

        const [rows] = await db.query(
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
            ON a.article_id = aa.article_id
            WHERE a.article_id = ?
            `,
            [article_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "기사를 찾을 수 없습니다."
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
            message: "기사 조회 실패"
        });
    }
});



// 9. 클러스터 목록 조회
app.get("/api/clusters", async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                c.cluster_id,
                c.cluster_key,
                c.representative_title,
                c.issue_type,
                c.first_detected,
                c.last_detected,
                c.article_count,
                c.max_risk_score,
                c.cluster_status,

                a.article_id,
                a.title,
                a.url,
                a.source,

                aa.risk_score,
                aa.event_name
            FROM clusters c
            LEFT JOIN article_analysis aa
                ON c.cluster_id = aa.cluster_id
            LEFT JOIN articles a
                ON aa.article_id = a.article_id
            ORDER BY
                c.max_risk_score DESC,
                c.last_detected DESC
        `);

        const clusterMap = new Map();

        for (const row of rows) {

            if (!clusterMap.has(row.cluster_id)) {
                clusterMap.set(row.cluster_id, {
                    cluster_id: row.cluster_id,
                    cluster_key: row.cluster_key,
                    representative_title: row.representative_title,
                    issue_type: row.issue_type,
                    first_detected: row.first_detected,
                    last_detected: row.last_detected,
                    article_count: row.article_count,
                    max_risk_score: row.max_risk_score,
                    cluster_status: row.cluster_status,
                    articles: []
                });
            }

            if (row.article_id) {
                clusterMap.get(row.cluster_id).articles.push({
                    article_id: row.article_id,
                    title: row.title,
                    url: row.url,
                    source: row.source,
                    risk_score: row.risk_score,
                    event_name: row.event_name
                });
            }
        }

        const clusters = Array.from(clusterMap.values());

        res.json({
            success: true,
            count: clusters.length,
            clusters
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "클러스터 조회 실패"
        });
    }
});
// 10. 특정 클러스터에 묶인 기사 약식 목록 조회
app.get("/api/clusters/:cluster_id/articles", async (req, res) => {
    try {
        const { cluster_id } = req.params;

        const [clusterRows] = await db.query(
            `
            SELECT
                cluster_id,
                representative_title,
                issue_type,
                article_count,
                max_risk_score,
                first_detected,
                last_detected
            FROM clusters
            WHERE cluster_id = ?
            `,
            [cluster_id]
        );

        if (clusterRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "해당 클러스터를 찾을 수 없습니다."
            });
        }

        const [articleRows] = await db.query(
            `
            SELECT
                a.article_id,
                a.title,
                a.url,
                a.source,
                a.published_at,
                aa.summary,
                aa.event_name,
                aa.event_keywords,
                aa.risk_score,
                aa.analyzed_at
            FROM article_analysis aa
            INNER JOIN articles a
            ON aa.article_id = a.article_id
            WHERE aa.cluster_id = ?
            ORDER BY aa.risk_score DESC, aa.analyzed_at DESC
            `,
            [cluster_id]
        );

        res.json({
            success: true,
            cluster: clusterRows[0],
            count: articleRows.length,
            articles: articleRows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "클러스터 기사 목록 조회 실패"
        });
    }
});

app.listen(3000, () => {
    console.log("server start");
});