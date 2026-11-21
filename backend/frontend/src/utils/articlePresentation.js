export function riskEmphasisClass(riskScore) {
  if (riskScore === null || riskScore === undefined || riskScore === "") return "";
  const score = Number(riskScore);
  if (!Number.isFinite(score)) return "";

  if (score >= 0.6) return "riskEmphasisHigh";
  if (score >= 0.4) return "riskEmphasisWarning";
  return "";
}

export function sentimentInfo(label) {
  const raw = String(label ?? "").trim();
  const value = raw.toLowerCase().replace(/[-\s]+/g, "_");
  if (!value) return { category: "pending", icon: "·", label: "분석 전" };
  if (value.includes("공감") || value.includes("empathy")) {
    return { category: "empathy", icon: "💬", label: raw };
  }
  if (value.includes("부정") || value.includes("negative")) {
    return { category: "negative", icon: "🙁", label: value.includes("very") || raw.includes("매우") ? "매우 부정" : "부정" };
  }
  if (value.includes("긍정") || value.includes("positive")) {
    return { category: "positive", icon: "🙂", label: value.includes("very") || raw.includes("매우") ? "매우 긍정" : "긍정" };
  }
  if (value.includes("중립") || value.includes("neutral")) {
    return { category: "neutral", icon: "😐", label: "중립" };
  }
  return { category: "unknown", icon: "·", label: raw };
}

export function matchesSentiment(article, filter) {
  return filter === "all" || sentimentInfo(article.sentiment_label).category === filter;
}
