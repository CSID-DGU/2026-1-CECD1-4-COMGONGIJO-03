const express = require("express");
const db = require("./db");
const analyzeArticle = require("./ai/analyzeArticle");

const app = express();
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

        function getTextSimilarity(a, b) {
            const textA = normalizeText(a);
            const textB = normalizeText(b);

            if (!textA || !textB) return 0;
            if (textA === textB) return 1;
            if (textA.includes(textB) || textB.includes(textA)) return 0.8;

            let sameCount = 0;
            for (const ch of textA) {
                if (textB.includes(ch)) sameCount++;
            }

            return sameCount / Math.max(textA.length, textB.length);
        }

        function getArrayOverlapScore(newArray, oldArray) {
            const newSet = new Set((newArray || []).map(normalizeText).filter(Boolean));
            const oldSet = new Set((oldArray || []).map(normalizeText).filter(Boolean));

            if (newSet.size === 0 || oldSet.size === 0) return 0;

            let overlap = 0;
            for (const item of newSet) {
                if (oldSet.has(item)) overlap++;
            }

            return overlap / Math.max(newSet.size, oldSet.size);
        }

        const clusterKey = [
            analysis.issue_type || "etc",
            normalizeText(analysis.event_name || title) || "no_event"
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

        // 클러스터링 계산식
        for (const cluster of candidateClusters) {
            let score = 0;

            if (cluster.issue_type === analysis.issue_type) {
                score += 15;
            }

            const eventNameSimilarity = getTextSimilarity(
                analysis.event_name || title,
                cluster.event_name || cluster.representative_title
            );
            score += eventNameSimilarity * 45;

            const oldEntities = safeParseJsonArray(cluster.event_entities);
            const entityOverlap = getArrayOverlapScore(
                analysis.event_entities || [],
                oldEntities
            );
            score += entityOverlap * 15;

            const oldKeywords = safeParseJsonArray(cluster.event_keywords);
            const keywordOverlap = getArrayOverlapScore(
                analysis.event_keywords || [],
                oldKeywords
            );
            score += keywordOverlap * 20;

            const locationSimilarity = getTextSimilarity(
                analysis.event_location,
                cluster.event_location
            );
            score += locationSimilarity * 5;

            console.log(
                "후보:",
                cluster.cluster_id,
                cluster.representative_title,
                "점수:",
                score
            );
            
            if (score > bestScore) {
                bestScore = score;
                bestCluster = cluster;
            }
        }

        const clusterMatchThreshold = 60;

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
                    analysis.issue_type || "etc",
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

        const riskThreshold = 0.7;

        if (riskScore >= riskThreshold && analysis.alert_topic) {
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
        }

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

        const riskThreshold = 0.7;

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
        const [rows] = await db.query(
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
            ORDER BY c.max_risk_score DESC, c.last_detected DESC
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
            message: "클러스터 조회 실패"
        });
    }
});


app.listen(3000, () => {
    console.log("server start");
});