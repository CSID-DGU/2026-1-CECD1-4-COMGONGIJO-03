
import apiClient from "./apiClient";

export const getArticles = (keyword = "") =>
  apiClient.get("/articles", {
    params: keyword ? { keyword } : {}
  });

export const getAnalyzedArticles = () =>
  apiClient.get("/articles/analyzed/list");

export const getRiskyArticles = (minRisk) =>
  apiClient.get("/articles/risky/list", {
    params: minRisk ? { minRisk } : {}
  });

export const getAlerts = () => apiClient.get("/alerts");

export const getArticleByUrl = (url) =>
  apiClient.get("/articles/by-url/search", {
    params: { url }
  });

export const getArticleById = (article_id) =>
  apiClient.get(`/articles/${article_id}`);

export const createArticle = (payload) =>
  apiClient.post("/articles", payload);

// 스팸기사 목록 조회
export const getSpamArticles = () =>
  apiClient.get("/articles/spam");

// 일반 기사를 스팸기사함으로 이동
export const moveArticleToSpam = (articleId) =>
  apiClient.patch(`/articles/${articleId}/spam`);

// 스팸기사 복구
export const restoreArticleFromSpam = (articleId) =>
  apiClient.patch(`/articles/${articleId}/restore`);

export const getClusters = () =>
  apiClient.get("/clusters");

// 위험도 피드백
export const getRiskFeedback = (articleId) =>
  apiClient.get(
    `/articles/${articleId}/risk-feedback`
  );

export const putRiskFeedback = (articleId, payload) =>
  apiClient.put(
    `/articles/${articleId}/risk-feedback`,
    payload
  );
// 파급력 피드백 및 관측 데이터
export const getImpactFeedback = (articleId) =>
  apiClient.get(`/articles/${articleId}/impact-feedback`);
export const putImpactFeedback = (articleId, payload) =>
  apiClient.put(`/articles/${articleId}/impact-feedback`, payload);
export const getClusterImpact = (clusterId, includeLinked = false) =>
  apiClient.get(`/clusters/${clusterId}/impact`, {
    params: { include_linked: includeLinked }
  });
export const saveClusterImpactSnapshot = (clusterId, includeLinked = false) =>
  apiClient.post(`/clusters/${clusterId}/impact/snapshot`, { include_linked: includeLinked });
export const confirmClusterImpactSnapshot = (clusterId, includeLinked = false, acceptEstimated = false) =>
  apiClient.post(`/clusters/${clusterId}/impact/confirm`, {
    confirm: true,
    include_linked: includeLinked,
    accept_estimated_dates: acceptEstimated
  });
