// 언론사별 확정 점수가 아니라 프로젝트의 임시 등급입니다.
// 영향력 인식(한국언론진흥재단 2025) 및 브랜드 이용률(Reuters DNR 2026)을
// 참고한 휴리스틱이므로 실무자 검증 전까지 공식 조사 점수로 표현하면 안 됩니다.
// 연합뉴스TV와 연합뉴스 통신사는 구분합니다.
const MEDIA_GROUPS = Object.freeze([
    { score: 1.0, aliases: ["MBC", "문화방송", "KBS", "한국방송공사"] },
    { score: 0.8, aliases: ["YTN", "JTBC", "SBS", "연합뉴스TV"] },
    { score: 0.6, aliases: ["TV조선", "조선일보", "중앙일보", "한겨레"] }
]);

function normalizeSource(source) {
    return String(source ?? "")
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/[\s.·_\-()]/g, "");
}

function lookupMediaInfluence(source) {
    const key = normalizeSource(source);
    if (!key) return null;
    // URL, 기사 제목, 유통 플랫폼 문자열을 임의로 일치시키지 않습니다.
    for (const group of MEDIA_GROUPS) {
        if (group.aliases.some(name => normalizeSource(name) === key)) {
            return group.score;
        }
    }
    return null;
}

module.exports = { normalizeSource, lookupMediaInfluence, MEDIA_GROUPS };
