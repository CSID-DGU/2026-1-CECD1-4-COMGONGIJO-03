const riskRepository =
    require("../repositories/riskRepository");

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^\w가-힣]/g, "");
}

function toDate(value) {
    if (!value) {
        return null;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? null
        : date;
}

function getReferenceDate(analysis, article) {
    return (
        toDate(analysis.event_date) ||
        toDate(article.published_at) ||
        null
    );
}

function normalizeIssueType(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function isGenericType(value) {
    return (
        !value ||
        value === "none" ||
        value === "etc" ||
        value === "unknown"
    );
}

// 지나치게 넓은 incident 통합을 제거합니다.
// 사건 유형과 부정적 영향 유형을 함께 비교합니다.
function isSimilarCrisis(current, historical) {
    const currentIssue =
        normalizeIssueType(current.issue_type);

    const historicalIssue =
        normalizeIssueType(historical.issue_type);

    const currentImpact =
        normalizeIssueType(
            current.negative_impact_type
        );

    const historicalImpact =
        normalizeIssueType(
            historical.negative_impact_type
        );

    const sameIssue =
        !isGenericType(currentIssue) &&
        currentIssue === historicalIssue;

    const sameImpact =
        !isGenericType(currentImpact) &&
        currentImpact === historicalImpact;

    // 두 유형이 모두 존재한다면 둘 다 일치해야 합니다.
    if (
        !isGenericType(currentImpact) &&
        !isGenericType(historicalImpact)
    ) {
        return sameIssue && sameImpact;
    }

    return sameIssue;
}

function getEventDate(item) {
    return (
        toDate(item.event_date) ||
        toDate(item.published_at) ||
        null
    );
}

function isSameEvent(current, historical) {
    const currentName =
        normalizeText(current.event_name);

    const historicalName =
        normalizeText(historical.event_name);

    if (
        !currentName ||
        !historicalName ||
        currentName !== historicalName
    ) {
        return false;
    }

    const currentDate = getEventDate(current);
    const historicalDate = getEventDate(historical);

    // 같은 이름이라도 날짜가 크게 다르면
    // 별개 사건일 수 있습니다.
    if (currentDate && historicalDate) {
        const difference =
            Math.abs(
                currentDate.getTime() -
                historicalDate.getTime()
            );

        const sevenDays =
            7 * 24 * 60 * 60 * 1000;

        return difference <= sevenDays;
    }

    // 날짜를 확인할 수 없다면
    // 동일한 사건명은 보수적으로 중복 취급합니다.
    return true;
}

function isPastEvent(current, historical) {
    const currentDate = getEventDate(current);
    const historicalDate = getEventDate(historical);

    // 날짜가 없으면 과거 여부를 확정하지 않습니다.
    if (!currentDate || !historicalDate) {
        return false;
    }

    return historicalDate < currentDate;
}

function isSameHistoricalRecord(a, b) {
    if (
        a.cluster_id != null &&
        b.cluster_id != null &&
        String(a.cluster_id) === String(b.cluster_id)
    ) {
        return true;
    }

    return isSameEvent(a, b);
}

function scoreHistory(events, referenceDate) {
    if (events.length === 0) {
        return 0;
    }

    let recentCount = 0;

    if (referenceDate) {
        const oneYearMs =
            365 * 24 * 60 * 60 * 1000;

        recentCount = events.filter(event => {
            const date = getEventDate(event);

            if (!date) {
                return false;
            }

            const difference =
                referenceDate.getTime() -
                date.getTime();

            return (
                difference > 0 &&
                difference <= oneYearMs
            );
        }).length;
    }

    if (
        events.length >= 5 &&
        recentCount >= 3
    ) {
        return 1.0;
    }

    if (
        events.length >= 3 ||
        recentCount >= 2
    ) {
        return 0.75;
    }

    if (
        events.length >= 2 ||
        recentCount >= 1
    ) {
        return 0.50;
    }

    return 0.25;
}

async function calculateSimilarCrisisHistory(analysis, article) {
    if (analysis.target_related !== true) {
        return 0;
    }

    const targetName =
        analysis.target_name || "서울교통공사";

    const current = {
        article_id: article.article_id,
        event_name: analysis.event_name,
        event_date: analysis.event_date,
        published_at: article.published_at,
        issue_type: analysis.issue_type,
        negative_impact_type: analysis.negative_impact_type
    };

    const referenceDate =
        getReferenceDate(analysis, article);

    const dbHistory =
        await riskRepository.findHistoricalCrises(targetName);

    const dbEvents = [];
    const mentionedEvents = [];

    // DB에서 별개의 과거 유사 사건을 검색합니다.
    for (const item of dbHistory) {
        if (
            item.article_id != null &&
            current.article_id != null &&
            String(item.article_id) === String(current.article_id)
        ) {
            continue;
        }

        if (!isSimilarCrisis(current, item)) continue;
        if (isSameEvent(current, item)) continue;
        if (!isPastEvent(current, item)) continue;

        const duplicate = dbEvents.some(existing =>
            isSameHistoricalRecord(existing, item)
        );

        if (!duplicate) {
            dbEvents.push(item);
        }
    }

    // 기사에 명시된 별개의 과거 유사위기를 수집합니다.
    const mentioned = Array.isArray(
        analysis.mentioned_past_crises
    )
        ? analysis.mentioned_past_crises
        : [];

    for (const item of mentioned) {
        if (
            !item ||
            typeof item.event_name !== "string" ||
            !item.event_name.trim() ||
            typeof item.evidence !== "string" ||
            !item.evidence.trim() ||
            typeof item.similarity_reason !== "string" ||
            !item.similarity_reason.trim()
        ) {
            continue;
        }

        if (isSameEvent(current, item)) continue;

        const mentionedDate = toDate(item.event_date);

        if (
            referenceDate &&
            mentionedDate &&
            mentionedDate >= referenceDate
        ) {
            continue;
        }

        const duplicate = mentionedEvents.some(existing =>
            isSameHistoricalRecord(existing, item)
        );

        if (!duplicate) {
            mentionedEvents.push(item);
        }
    }

    // 기사에서 직접 확인한 과거 위기에 더 높은 점수를 부여합니다.
    const articleScore = mentionedEvents.length > 0
        ? Math.min(
            1,
            scoreHistory(mentionedEvents, referenceDate) + 0.25
        )
        : 0;

    // 기사에 이미 언급된 사건은 DB 보정에서 중복 계산하지 않습니다.
    const additionalDbEvents = dbEvents.filter(dbEvent =>
        !mentionedEvents.some(mentionedEvent =>
            isSameHistoricalRecord(dbEvent, mentionedEvent)
        )
    );

    // DB 기록은 사건당 0.05점, 최대 0.20점만 보정합니다.
    const dbBonus = Math.min(
        0.20,
        additionalDbEvents.length * 0.05
    );

    return Math.min(1, articleScore + dbBonus);
}

module.exports = {
    calculateSimilarCrisisHistory
};