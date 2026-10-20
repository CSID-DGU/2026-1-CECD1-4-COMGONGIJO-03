const riskRepository =
    require("../repositories/riskRepository");

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^\w가-힣]/g, "");
}

function normalizeIssueType(issueType) {
    const type =
        String(issueType || "etc").trim();

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

function isSimilarCrisis(current, historical) {
    const currentIssue =
        normalizeIssueType(
            current.issue_type
        );

    const historicalIssue =
        normalizeIssueType(
            historical.issue_type
        );

    const currentImpact =
        normalizeText(
            current.negative_impact_type
        );

    const historicalImpact =
        normalizeText(
            historical.negative_impact_type
        );

    const sameIssueType =
        currentIssue &&
        historicalIssue &&
        currentIssue === historicalIssue;

    const sameImpactType =
        currentImpact &&
        historicalImpact &&
        currentImpact === historicalImpact;

    return Boolean(
        sameIssueType ||
        sameImpactType
    );
}

async function calculateSimilarCrisisHistory(
    analysis,
    article
) {
    if (!analysis.target_related) {
        return 0;
    }

    const targetName =
        analysis.target_name ||
        "서울교통공사";

    const history =
        await riskRepository
            .findHistoricalCrises(
                targetName
            );

    const currentEventName =
        normalizeText(
            analysis.event_name
        );

    const referenceDate =
        getReferenceDate(
            analysis,
            article
        );

    const distinctEvents =
        new Map();

    for (const item of history) {
        if (
            !isSimilarCrisis(
                analysis,
                item
            )
        ) {
            continue;
        }

        const historicalEventName =
            normalizeText(
                item.event_name
            );

        // 현재 사건과 사실상 같은 사건의 후속 보도는
        // 과거 유사위기로 세지 않습니다.
        if (
            currentEventName &&
            historicalEventName &&
            currentEventName ===
                historicalEventName
        ) {
            continue;
        }

        const historicalDate =
            toDate(
                item.event_date ||
                item.published_at ||
                item.analyzed_at
            );

        if (
            referenceDate &&
            historicalDate &&
            historicalDate >= referenceDate
        ) {
            continue;
        }

        const key = [
            historicalEventName ||
                `cluster-${item.cluster_id || "unknown"}`,
            historicalDate
                ? historicalDate
                    .toISOString()
                    .slice(0, 10)
                : "unknown-date"
        ].join("|");

        if (!distinctEvents.has(key)) {
            distinctEvents.set(
                key,
                historicalDate
            );
        }
    }

    const events =
        [...distinctEvents.values()];

    if (events.length === 0) {
        return 0;
    }

    let recentCount = 0;

    if (referenceDate) {
        const oneYearMs =
            365 * 24 * 60 * 60 * 1000;

        recentCount =
            events.filter(date =>
                date &&
                referenceDate.getTime() -
                    date.getTime() <= oneYearMs
            ).length;
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

module.exports = {
    calculateSimilarCrisisHistory
};