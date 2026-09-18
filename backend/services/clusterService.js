const clusterRepository = require("../repositories/clusterRepository");
const { getEmbedding, cosineSimilarity } = require("../ai/embedding");

const embeddingCache = new Map();
const CLUSTER_MATCH_THRESHOLD = 60;


// ============================================================
// 공통 함수
// ============================================================

function safeParseJsonArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}


function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^\w가-힣]/g, "");
}


function normalizeEmbeddingText(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
}


// 같은 문장을 반복해서 BGE-M3에 넣지 않도록 캐시
async function getCachedEmbedding(text) {
    const normalizedText =
        normalizeEmbeddingText(text);

    if (!normalizedText) {
        return null;
    }

    if (embeddingCache.has(normalizedText)) {
        return embeddingCache.get(normalizedText);
    }

    const embedding =
        await getEmbedding(normalizedText);

    embeddingCache.set(
        normalizedText,
        embedding
    );

    return embedding;
}


// 비교에 필요한 문장들을 미리 임베딩
async function getEmbeddingMap(texts) {
    const uniqueTexts = [
        ...new Set(
            (texts || [])
                .map(normalizeEmbeddingText)
                .filter(Boolean)
        )
    ];

    const embeddingMap = new Map();

    /*
     * Ollama에 요청이 한꺼번에 몰리지 않도록
     * 순차적으로 임베딩합니다.
     */
    for (const text of uniqueTexts) {
        const embedding =
            await getCachedEmbedding(text);

        if (embedding) {
            embeddingMap.set(
                text,
                embedding
            );
        }
    }

    return embeddingMap;
}


// BGE-M3 cosine similarity
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

    const similarity =
        cosineSimilarity(
            embeddingA,
            embeddingB
        );

    /*
     * 점수 계산에서는 0 ~ 1 범위를 사용
     */
    return Math.max(
        0,
        Math.min(
            1,
            similarity
        )
    );
}


// entity / keyword exact overlap
function getArrayOverlapScore(
    newArray,
    oldArray
) {
    const parsedNewArray =
        Array.isArray(newArray)
            ? newArray
            : safeParseJsonArray(newArray);

    const parsedOldArray =
        Array.isArray(oldArray)
            ? oldArray
            : safeParseJsonArray(oldArray);

    const newSet = new Set(
        parsedNewArray
            .map(normalizeText)
            .filter(Boolean)
    );

    const oldSet = new Set(
        parsedOldArray
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
// 새 클러스터 cluster_key 생성
//
// schema2.sql에서 cluster_key가 UNIQUE이므로
// articleId를 붙여 중복 key 발생을 방지
// ============================================================

function buildNewClusterKey(
    analysis,
    title,
    articleId
) {
    const issueType =
        normalizeText(
            analysis.issue_type || "etc"
        ) || "etc";

    const eventName =
        normalizeText(
            analysis.event_name || title
        ) || "no_event";

    return (
        `${issueType}-` +
        `${eventName}-` +
        `${articleId}`
    );
}


// ============================================================
// 각 기존 클러스터에서
// 가장 최근 분석된 실제 기사의 제목 가져오기
//
// repository를 수정하지 않고
// 기존 findArticlesByClusterId() 재사용
// ============================================================

async function getLatestArticleTitleMap(
    candidateClusters
) {
    const latestTitleMap =
        new Map();

    for (const cluster of candidateClusters) {
        try {
            const articles =
                await clusterRepository
                    .findArticlesByClusterId(
                        cluster.cluster_id
                    );

            if (
                !articles ||
                articles.length === 0
            ) {
                latestTitleMap.set(
                    cluster.cluster_id,
                    cluster.representative_title || ""
                );

                continue;
            }

            let latestArticle =
                articles[0];

            for (const article of articles) {
                const currentTime =
                    article.analyzed_at
                        ? new Date(
                            article.analyzed_at
                        ).getTime()
                        : 0;

                const latestTime =
                    latestArticle.analyzed_at
                        ? new Date(
                            latestArticle.analyzed_at
                        ).getTime()
                        : 0;

                if (
                    currentTime >
                    latestTime
                ) {
                    latestArticle =
                        article;
                }
            }

            latestTitleMap.set(
                cluster.cluster_id,

                latestArticle.title ||
                cluster.representative_title ||
                ""
            );

        } catch (error) {

            console.error(
                `클러스터 ${cluster.cluster_id} 최신 기사 제목 조회 실패:`,
                error.message
            );

            latestTitleMap.set(
                cluster.cluster_id,
                cluster.representative_title || ""
            );
        }
    }

    return latestTitleMap;
}


// ============================================================
// 클러스터 후보 비교
//
// 점수 구성:
//
// issue_type       15
// event_name       25  BGE-M3
// title            20  BGE-M3
// entity           15  exact overlap
// keyword          20  exact overlap
// location          5  BGE-M3
//
// 총 100점
//
// 60점 이상이면 기존 클러스터에 편입
// ============================================================

async function findBestCluster(
    analysis,
    title
) {
    const candidateClusters =
        await clusterRepository
            .findRecentCandidates();

    if (
        !candidateClusters ||
        candidateClusters.length === 0
    ) {
        return {
            bestCluster: null,
            bestScore: 0
        };
    }


    // 각 클러스터의 최근 실제 기사 제목
    const latestArticleTitleMap =
        await getLatestArticleTitleMap(
            candidateClusters
        );


    // --------------------------------------------------------
    // BGE-M3에 넣을 모든 텍스트 준비
    // --------------------------------------------------------

    const embeddingTexts = [
        analysis.event_name || title,
        title
    ];


    if (analysis.event_location) {
        embeddingTexts.push(
            analysis.event_location
        );
    }


    for (
        const cluster
        of candidateClusters
    ) {
        // 기존 클러스터 event_name
        embeddingTexts.push(
            cluster.event_name ||
            cluster.representative_title
        );


        // 기존 클러스터의 최근 실제 기사 제목
        embeddingTexts.push(
            latestArticleTitleMap.get(
                cluster.cluster_id
            ) ||
            cluster.representative_title
        );


        // 기존 클러스터 location
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


    // ========================================================
    // 각 후보 클러스터와 비교
    // ========================================================

    for (
        const cluster
        of candidateClusters
    ) {
        let score = 0;


        // ----------------------------------------------------
        // 1. issue_type
        // 최대 15점
        // ----------------------------------------------------

        if (
            String(
                cluster.issue_type || ""
            ) ===
            String(
                analysis.issue_type || "etc"
            )
        ) {
            score += 15;
        }


        // ----------------------------------------------------
        // 2. event_name
        // BGE-M3
        // 최대 25점
        // ----------------------------------------------------

        const eventNameSimilarity =
            getEmbeddingSimilarity(
                analysis.event_name ||
                title,

                cluster.event_name ||
                cluster.representative_title,

                embeddingMap
            );


        score +=
            eventNameSimilarity * 25;


        // ----------------------------------------------------
        // 3. 실제 기사 title
        // BGE-M3
        // 최대 20점
        // ----------------------------------------------------

        const latestArticleTitle =
            latestArticleTitleMap.get(
                cluster.cluster_id
            ) ||
            cluster.representative_title;


        const titleSimilarity =
            getEmbeddingSimilarity(
                title,
                latestArticleTitle,
                embeddingMap
            );


        score +=
            titleSimilarity * 20;


        // ----------------------------------------------------
        // 4. entity
        // exact overlap
        // 최대 15점
        // ----------------------------------------------------

        const entityOverlap =
            getArrayOverlapScore(
                analysis.event_entities || [],

                safeParseJsonArray(
                    cluster.event_entities
                )
            );


        score +=
            entityOverlap * 15;


        // ----------------------------------------------------
        // 5. keyword
        // exact overlap
        // 최대 20점
        // ----------------------------------------------------

        const keywordOverlap =
            getArrayOverlapScore(
                analysis.event_keywords || [],

                safeParseJsonArray(
                    cluster.event_keywords
                )
            );


        score +=
            keywordOverlap * 20;


        // ----------------------------------------------------
        // 6. location
        // BGE-M3
        // 최대 5점
        // ----------------------------------------------------

        const locationSimilarity =
            getEmbeddingSimilarity(
                analysis.event_location,
                cluster.event_location,
                embeddingMap
            );


        score +=
            locationSimilarity * 5;


        // ----------------------------------------------------
        // 테스트 확인용 로그
        // ----------------------------------------------------

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


        if (
            score >
            bestScore
        ) {
            bestScore =
                score;

            bestCluster =
                cluster;
        }
    }


    return {
        bestCluster,
        bestScore
    };
}


// ============================================================
// 기사 → 클러스터 배정
// ============================================================

async function assignCluster({
    articleId,
    analysis,
    title,
    riskScore
}) {

    const {
        bestCluster,
        bestScore
    } =
        await findBestCluster(
            analysis,
            title
        );


    // ========================================================
    // 기존 클러스터에 편입
    // ========================================================

    if (
        bestCluster &&
        bestScore >=
            CLUSTER_MATCH_THRESHOLD
    ) {

        await clusterRepository
            .updateMatchedCluster(
                bestCluster.cluster_id,
                riskScore
            );


        /*
         * 기존 클러스터에 들어가는 경우에는
         * 새 clusterKey를 만들지 않고
         * 해당 클러스터의 기존 cluster_key를 사용
         */
        return {
            clusterId:
                bestCluster.cluster_id,

            clusterKey:
                bestCluster.cluster_key,

            clusterScore:
                bestScore,

            /*
             * 이 알고리즘은 제목/event_name/location을
             * 비교하기 위한 임베딩만 사용하며
             * article_embedding 자체는 저장하지 않음
             */
            articleEmbedding:
                null
        };
    }


    // ========================================================
    // 새 클러스터 생성
    // ========================================================

    const clusterKey =
        buildNewClusterKey(
            analysis,
            title,
            articleId
        );


    const clusterId =
        await clusterRepository
            .createCluster({

                clusterKey,

                representativeTitle:
                    analysis.event_name ||
                    title,

                /*
                 * 현재 기사가 새 클러스터의
                 * 최초 대표 기사
                 */
                representativeArticleId:
                    articleId,

                /*
                 * 현재 알고리즘은 centroid를
                 * 사용하지 않으므로 null
                 */
                centroidEmbedding:
                    null,

                issueType:
                    analysis.issue_type ||
                    "etc",

                riskScore
            });


    return {
        clusterId,
        clusterKey,

        clusterScore:
            bestScore,

        articleEmbedding:
            null
    };
}


// ============================================================
// 전체 클러스터 조회
// GET /api/clusters
// ============================================================

async function getClusters() {

    const rows =
        await clusterRepository
            .findAllWithArticles();


    const clusterMap =
        new Map();


    for (const row of rows) {

        if (
            !clusterMap.has(
                row.cluster_id
            )
        ) {

            clusterMap.set(
                row.cluster_id,
                {
                    cluster_id:
                        row.cluster_id,

                    cluster_key:
                        row.cluster_key,

                    representative_title:
                        row.representative_title,

                    issue_type:
                        row.issue_type,

                    first_detected:
                        row.first_detected,

                    last_detected:
                        row.last_detected,

                    article_count:
                        row.article_count,

                    max_risk_score:
                        row.max_risk_score,

                    cluster_status:
                        row.cluster_status,

                    articles: []
                }
            );
        }


        if (row.article_id) {

            clusterMap
                .get(
                    row.cluster_id
                )
                .articles
                .push({

                    article_id:
                        row.article_id,

                    title:
                        row.title,

                    url:
                        row.url,

                    source:
                        row.source,

                    risk_score:
                        row.risk_score,

                    event_name:
                        row.event_name
                });
        }
    }


    return Array.from(
        clusterMap.values()
    );
}


// ============================================================
// 특정 클러스터 기사 조회
// GET /api/clusters/:cluster_id/articles
// ============================================================

async function getClusterWithArticles(
    clusterId
) {

    const cluster =
        await clusterRepository
            .findById(
                clusterId
            );


    if (!cluster) {
        return null;
    }


    const articles =
        await clusterRepository
            .findArticlesByClusterId(
                clusterId
            );


    return {
        cluster,
        articles
    };
}


// ============================================================
// export
// ============================================================

module.exports = {
    assignCluster,
    getClusters,
    getClusterWithArticles
};