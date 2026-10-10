const clusterMergeRepository =
    require("../repositories/clusterMergeRepository");

const {
    cosineSimilarity
} = require("../ai/embedding");


const DEFAULT_MERGE_THRESHOLD = 80;

// 사건 발생 날짜가 이보다 많이 차이나면
// 강제로 병합에서 제외합니다.
const MAX_EVENT_DATE_GAP_DAYS = 1;

// 장소 문자열 유사도가 이보다 낮으면
// 서로 다른 장소로 판단합니다.
const MIN_LOCATION_SIMILARITY = 0.25;


function safeParseJsonArray(value) {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value;
    }

    try {
        const parsed =
            JSON.parse(value);

        return Array.isArray(parsed)
            ? parsed
            : [];

    } catch {
        return [];
    }
}


function safeParseEmbedding(value) {
    if (!value) {
        return null;
    }

    if (Array.isArray(value)) {
        return value;
    }

    try {
        const parsed =
            JSON.parse(value);

        return Array.isArray(parsed)
            ? parsed
            : null;

    } catch {
        return null;
    }
}


function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^\w가-힣]/g, "");
}


function getTextSimilarity(a, b) {
    const textA =
        normalizeText(a);

    const textB =
        normalizeText(b);


    if (!textA || !textB) {
        return 0;
    }


    if (textA === textB) {
        return 1;
    }


    if (
        textA.includes(textB) ||
        textB.includes(textA)
    ) {
        return 0.8;
    }


    const getBigrams = str => {
        const bigrams =
            new Set();

        for (
            let i = 0;
            i < str.length - 1;
            i++
        ) {
            bigrams.add(
                str.substring(
                    i,
                    i + 2
                )
            );
        }

        return bigrams;
    };


    const setA =
        getBigrams(textA);

    const setB =
        getBigrams(textB);


    if (
        setA.size === 0 ||
        setB.size === 0
    ) {
        return 0;
    }


    let intersection = 0;

    for (const token of setA) {
        if (setB.has(token)) {
            intersection++;
        }
    }


    return intersection /
        Math.max(
            setA.size,
            setB.size
        );
}


function getEntityOverlapScore(a, b) {
    const setA =
        new Set(
            (a || [])
                .map(normalizeText)
                .filter(Boolean)
        );

    const setB =
        new Set(
            (b || [])
                .map(normalizeText)
                .filter(Boolean)
        );


    if (
        setA.size === 0 ||
        setB.size === 0
    ) {
        return 0;
    }


    let intersection = 0;

    for (const value of setA) {
        if (setB.has(value)) {
            intersection++;
        }
    }


    const unionSize =
        new Set([
            ...setA,
            ...setB
        ]).size;


    return intersection /
        unionSize;
}


function normalizeIssueType(issueType) {
    const type =
        String(
            issueType || "etc"
        ).trim();


    if (
        [
            "safety",
            "accident",
            "facility",
            "service_disruption"
        ].includes(type)
    ) {
        return "incident";
    }


    return type || "etc";
}


function getDateDifferenceDays(a, b) {
    if (!a || !b) {
        return null;
    }


    const dateA =
        new Date(a);

    const dateB =
        new Date(b);


    if (
        Number.isNaN(
            dateA.getTime()
        ) ||
        Number.isNaN(
            dateB.getTime()
        )
    ) {
        return null;
    }


    return Math.abs(
        dateA.getTime() -
        dateB.getTime()
    ) /
        (
            1000 *
            60 *
            60 *
            24
        );
}


// yyyy-mm-dd 형식만 허용합니다.
// null이면 오늘 날짜를 사용하므로 그대로 null을 반환합니다.
function normalizeRequestedDate(date) {
    if (
        date === undefined ||
        date === null ||
        date === ""
    ) {
        return null;
    }


    const value =
        String(date).trim();


    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
            value
        )
    ) {
        throw new Error(
            "date는 YYYY-MM-DD 형식이어야 합니다."
        );
    }


    return value;
}


// 병합된 모든 기사의 embedding 평균으로
// centroid를 다시 계산합니다.
function calculateCentroid(articles) {
    const embeddings =
        articles
            .map(
                article =>
                    safeParseEmbedding(
                        article.article_embedding
                    )
            )
            .filter(Boolean);


    if (
        embeddings.length === 0
    ) {
        return null;
    }


    const dimension =
        embeddings[0].length;


    const validEmbeddings =
        embeddings.filter(
            embedding =>
                embedding.length ===
                dimension
        );


    if (
        validEmbeddings.length === 0
    ) {
        return null;
    }


    const centroid =
        new Array(
            dimension
        ).fill(0);


    for (
        const embedding
        of validEmbeddings
    ) {
        for (
            let i = 0;
            i < dimension;
            i++
        ) {
            centroid[i] +=
                embedding[i];
        }
    }


    return centroid.map(
        value =>
            value /
            validEmbeddings.length
    );
}


// 새 centroid와 가장 가까운 실제 기사를
// 대표기사로 선정합니다.
function findRepresentativeArticle(
    articles,
    centroid
) {
    let bestArticle = null;
    let bestSimilarity =
        -Infinity;


    for (
        const article
        of articles
    ) {
        const embedding =
            safeParseEmbedding(
                article.article_embedding
            );


        if (
            !embedding ||
            embedding.length !==
                centroid.length
        ) {
            continue;
        }


        const similarity =
            cosineSimilarity(
                centroid,
                embedding
            );


        if (
            similarity >
            bestSimilarity
        ) {
            bestSimilarity =
                similarity;

            bestArticle =
                article;
        }
    }


    return bestArticle;
}


// 두 클러스터의 병합 가능 여부와
// 병합 점수를 계산합니다.
function evaluateMerge(
    clusterA,
    clusterB
) {
    /*
     * 가장 먼저 날짜별 클러스터 구조를 보존합니다.
     *
     * 다른 날짜의 동일 사건은 병합 대상이 아니라
     * 이후 클러스터 연결 기능에서 처리합니다.
     */
    if (
        !clusterA.cluster_date ||
        !clusterB.cluster_date ||
        clusterA.cluster_date !==
            clusterB.cluster_date
    ) {
        return {
            mergeable: false,
            score: 0,
            reason:
                "cluster_date_conflict"
        };
    }


    const centroidA =
        safeParseEmbedding(
            clusterA.centroid_embedding
        );

    const centroidB =
        safeParseEmbedding(
            clusterB.centroid_embedding
        );


    if (
        !centroidA ||
        !centroidB ||
        centroidA.length !==
            centroidB.length
    ) {
        return {
            mergeable: false,
            score: 0,
            reason:
                "centroid_missing_or_invalid"
        };
    }


    /*
     * 강제 제외 조건 1입니다.
     * 대상 기업이 명백하게 다르면 병합하지 않습니다.
     */
    const targetA =
        normalizeText(
            clusterA.target_name
        );

    const targetB =
        normalizeText(
            clusterB.target_name
        );


    if (
        targetA &&
        targetB &&
        targetA !== targetB
    ) {
        return {
            mergeable: false,
            score: 0,
            reason:
                "target_conflict"
        };
    }


    /*
     * 강제 제외 조건 2입니다.
     *
     * cluster_date와는 별개로,
     * 기사 분석에서 추출된 실제 사건 발생일이
     * 지나치게 다르면 병합하지 않습니다.
     */
    const dateDifference =
        getDateDifferenceDays(
            clusterA.event_date,
            clusterB.event_date
        );


    if (
        dateDifference !== null &&
        dateDifference >
            MAX_EVENT_DATE_GAP_DAYS
    ) {
        return {
            mergeable: false,
            score: 0,
            reason:
                "event_date_conflict"
        };
    }


    /*
     * 강제 제외 조건 3입니다.
     * 사건 유형이 명백하게 다르면 병합하지 않습니다.
     */
    if (
        clusterA.issue_type &&
        clusterB.issue_type
    ) {
        const issueTypeA =
            normalizeIssueType(
                clusterA.issue_type
            );

        const issueTypeB =
            normalizeIssueType(
                clusterB.issue_type
            );


        if (
            issueTypeA !==
            issueTypeB
        ) {
            return {
                mergeable: false,
                score: 0,
                reason:
                    "issue_type_conflict"
            };
        }
    }


    /*
     * 강제 제외 조건 4입니다.
     * 장소가 명확하게 다르면 병합하지 않습니다.
     */
    let locationSimilarity =
        null;


    if (
        clusterA.event_location &&
        clusterB.event_location
    ) {
        locationSimilarity =
            getTextSimilarity(
                clusterA.event_location,
                clusterB.event_location
            );


        if (
            locationSimilarity <
            MIN_LOCATION_SIMILARITY
        ) {
            return {
                mergeable: false,
                score: 0,
                reason:
                    "location_conflict"
            };
        }
    }


    /*
     * 기본 병합 점수를 계산합니다.
     *
     * 현재 버전에서는 기존 판단 방식과 유사하게
     * centroid 의미 유사도에 가장 높은 비중을 둡니다.
     */
    const embeddingSimilarity =
        Math.max(
            0,
            cosineSimilarity(
                centroidA,
                centroidB
            )
        );


    let weightedScore =
        embeddingSimilarity * 60;

    let totalWeight = 60;


    /*
     * 사건명 유사도입니다.
     */
    if (
        clusterA.event_name &&
        clusterB.event_name
    ) {
        weightedScore +=
            getTextSimilarity(
                clusterA.event_name,
                clusterB.event_name
            ) * 10;

        totalWeight += 10;
    }


    /*
     * 장소 유사도입니다.
     */
    if (
        locationSimilarity !==
        null
    ) {
        weightedScore +=
            locationSimilarity * 10;

        totalWeight += 10;
    }


    /*
     * 핵심 엔티티 유사도입니다.
     */
    const entitiesA =
        safeParseJsonArray(
            clusterA.event_entities
        );

    const entitiesB =
        safeParseJsonArray(
            clusterB.event_entities
        );


    if (
        entitiesA.length > 0 &&
        entitiesB.length > 0
    ) {
        weightedScore +=
            getEntityOverlapScore(
                entitiesA,
                entitiesB
            ) * 10;

        totalWeight += 10;
    }


    /*
     * 기사 분석에서 추출된 사건 날짜 유사도입니다.
     */
    if (
        dateDifference !== null
    ) {
        const dateScore =
            dateDifference === 0
                ? 1
                : 0.5;


        weightedScore +=
            dateScore * 5;

        totalWeight += 5;
    }


    /*
     * 사건 유형입니다.
     *
     * 강제 제외 조건을 통과했다면
     * 동일한 사건 유형으로 판단합니다.
     */
    if (
        clusterA.issue_type &&
        clusterB.issue_type
    ) {
        weightedScore += 5;
        totalWeight += 5;
    }


    return {
        mergeable: true,

        score:
            (
                weightedScore /
                totalWeight
            ) * 100,

        reason: null
    };
}


// 실제 두 클러스터를 하나로 병합합니다.
async function mergePair(
    targetCluster,
    sourceCluster,
    score
) {
    const [
        targetArticles,
        sourceArticles
    ] = await Promise.all([
        clusterMergeRepository
            .findArticlesByClusterId(
                targetCluster.cluster_id
            ),

        clusterMergeRepository
            .findArticlesByClusterId(
                sourceCluster.cluster_id
            )
    ]);


    const allArticles = [
        ...targetArticles,
        ...sourceArticles
    ];


    /*
     * 두 centroid를 단순 평균하지 않고
     * 병합된 모든 기사의 embedding을 기준으로
     * centroid를 다시 계산합니다.
     */
    const centroid =
        calculateCentroid(
            allArticles
        );


    if (!centroid) {
        throw new Error(
            "병합 후 centroid를 계산할 수 없습니다."
        );
    }


    /*
     * 새 centroid를 기준으로
     * 대표기사도 다시 선정합니다.
     */
    const representativeArticle =
        findRepresentativeArticle(
            allArticles,
            centroid
        );


    if (!representativeArticle) {
        throw new Error(
            "병합 후 대표기사를 선정할 수 없습니다."
        );
    }


    const firstDetected =
        new Date(
            Math.min(
                new Date(
                    targetCluster.first_detected
                ).getTime(),

                new Date(
                    sourceCluster.first_detected
                ).getTime()
            )
        );


    const lastDetected =
        new Date(
            Math.max(
                new Date(
                    targetCluster.last_detected
                ).getTime(),

                new Date(
                    sourceCluster.last_detected
                ).getTime()
            )
        );


    const maxRiskScore =
        Math.max(
            Number(
                targetCluster.max_risk_score
            ) || 0,

            Number(
                sourceCluster.max_risk_score
            ) || 0
        );


    await clusterMergeRepository
        .mergeClusters({
            targetClusterId:
                targetCluster.cluster_id,

            sourceClusterId:
                sourceCluster.cluster_id,

            centroidEmbedding:
                JSON.stringify(
                    centroid
                ),

            representativeArticleId:
                representativeArticle.article_id,

            representativeTitle:
                representativeArticle.title,

            articleCount:
                allArticles.length,

            maxRiskScore,

            firstDetected,

            lastDetected
        });


    return {
        targetClusterId:
            targetCluster.cluster_id,

        sourceClusterId:
            sourceCluster.cluster_id,

        score:
            Number(
                score.toFixed(2)
            ),

        articleCount:
            allArticles.length,

        representativeArticleId:
            representativeArticle.article_id,

        representativeTitle:
            representativeArticle.title
    };
}


// 특정 날짜의 활성 클러스터들을 검사해
// 같은 날짜 내부의 과분할 클러스터를 병합합니다.
async function mergeClustersByDate({
    threshold =
        DEFAULT_MERGE_THRESHOLD,

    date = null
} = {}) {
    const safeThreshold =
        Number.isFinite(
            Number(threshold)
        )
            ? Math.max(
                0,
                Math.min(
                    100,
                    Number(threshold)
                )
            )
            : DEFAULT_MERGE_THRESHOLD;


    const safeDate =
        normalizeRequestedDate(
            date
        );


    /*
     * date가 null이면 Repository에서
     * CURDATE()를 사용합니다.
     */
    const candidates =
        await clusterMergeRepository
            .findMergeCandidates(
                safeDate
            );


    const consumedClusterIds =
        new Set();

    const merges = [];


    /*
     * 현재 버전에서는 반복 병합하지 않습니다.
     *
     * 한 번 병합된 target/source는
     * 같은 실행에서 다시 다른 클러스터와
     * 연쇄 병합하지 않습니다.
     */
    for (
        let i = 0;
        i < candidates.length;
        i++
    ) {
        const clusterA =
            candidates[i];


        if (
            consumedClusterIds.has(
                clusterA.cluster_id
            )
        ) {
            continue;
        }


        for (
            let j = i + 1;
            j < candidates.length;
            j++
        ) {
            const clusterB =
                candidates[j];


            if (
                consumedClusterIds.has(
                    clusterB.cluster_id
                )
            ) {
                continue;
            }


            const evaluation =
                evaluateMerge(
                    clusterA,
                    clusterB
                );


            if (
                !evaluation.mergeable ||
                evaluation.score <
                    safeThreshold
            ) {
                continue;
            }


            /*
             * 먼저 생성된 클러스터를 유지합니다.
             */
            const targetCluster =
                new Date(
                    clusterA.first_detected
                )
                <=
                new Date(
                    clusterB.first_detected
                )
                    ? clusterA
                    : clusterB;


            const sourceCluster =
                targetCluster.cluster_id ===
                clusterA.cluster_id
                    ? clusterB
                    : clusterA;


            const result =
                await mergePair(
                    targetCluster,
                    sourceCluster,
                    evaluation.score
                );


            merges.push(result);


            consumedClusterIds.add(
                targetCluster.cluster_id
            );

            consumedClusterIds.add(
                sourceCluster.cluster_id
            );


            break;
        }
    }


    return {
        date:
            safeDate || "today",

        checkedClusterCount:
            candidates.length,

        mergeCount:
            merges.length,

        threshold:
            safeThreshold,

        merges
    };
}


module.exports = {
    mergeClustersByDate
};