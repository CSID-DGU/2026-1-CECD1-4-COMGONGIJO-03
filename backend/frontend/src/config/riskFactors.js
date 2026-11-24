export const riskFactorLabels = {
  issue_severity: "사건 심각도",
  target_responsibility: "귀책성",
  norm_violation: "규범 위반성",
  similar_crisis_history: "유사 위기 이력"
};

export const formatRiskValue = (value, digits = 2) =>
  value == null ? "—" : Number(value).toFixed(digits);
