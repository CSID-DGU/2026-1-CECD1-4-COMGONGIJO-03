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
