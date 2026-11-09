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