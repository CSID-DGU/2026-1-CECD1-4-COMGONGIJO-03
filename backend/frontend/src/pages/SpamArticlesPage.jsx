
import { useEffect, useState } from "react";
import ArticleDetailPanel from "../components/ArticleDetailPanel";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import {
  getSpamArticles,
  getArticleById,
  restoreArticleFromSpam
} from "../services/articles";

function getErrorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    "알 수 없는 오류가 발생했습니다."
  );
}

export default function SpamArticlesPage({ refreshTick = 0 }) {
  const [articles, setArticles] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [screenMode, setScreenMode] = useState("list");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [spamLoading, setSpamLoading] = useState(false);
  const [error, setError] = useState("");
  const [spamError, setSpamError] = useState("");

  const loadArticles = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");

    try {
      const response = await getSpamArticles();
      setArticles(response.data.articles || []);
    } catch (requestError) {
      if (showLoading) {
        setError(getErrorMessage(requestError));
      } else {
        console.error("스팸기사 자동 갱신 실패:", requestError);
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    loadArticles();
  }, []);

  useEffect(() => {
    if (refreshTick === 0 || screenMode !== "list") return;

    let cancelled = false;

    async function refreshArticles() {
      try {
        const response = await getSpamArticles();

        if (!cancelled) {
          setArticles(response.data.articles || []);
        }
      } catch (requestError) {
        console.error("스팸기사 자동 갱신 실패:", requestError);
      }
    }

    refreshArticles();

    return () => {
      cancelled = true;
    };
  }, [refreshTick, screenMode]);

  const handleSelectArticle = async (article) => {
    setSelectedArticle(article);
    setScreenMode("detail");
    setSpamError("");
    setDetailLoading(true);

    try {
      const response = await getArticleById(article.article_id);
      setSelectedArticle(response.data.article);
    } catch (requestError) {
      setSpamError(getErrorMessage(requestError));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedArticle?.article_id || spamLoading) return;

    setSpamLoading(true);
    setSpamError("");

    try {
      const response = await restoreArticleFromSpam(
        selectedArticle.article_id
      );

      if (!response.data.success) {
        throw new Error(
          response.data.message || "스팸 해제에 실패했습니다."
        );
      }

      setArticles((current) =>
        current.filter(
          (article) =>
            article.article_id !== selectedArticle.article_id
        )
      );

      setSelectedArticle(null);
      setScreenMode("list");
    } catch (requestError) {
      setSpamError(getErrorMessage(requestError));
    } finally {
      setSpamLoading(false);
    }
  };

  if (loading) {
    return <LoadingState label="스팸기사를 불러오는 중입니다." />;
  }

  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={loadArticles}
      />
    );
  }

  if (screenMode === "detail") {
    return (
      <div className="sketchPage detailScreen">
        <section className="detailTopControls">
          <button
            className="secondaryButton"
            type="button"
            onClick={() => setScreenMode("list")}
          >
            &lt; 목록
          </button>
        </section>

        {detailLoading ? (
          <LoadingState label="상세 정보를 불러오는 중입니다." />
        ) : (
          <>
            <ArticleDetailPanel
              article={selectedArticle}
              hasAlert={false}
              isSpam={true}
              onSpamToggle={handleRestore}
              spamLoading={spamLoading}
            />

            {spamError && (
              <p className="errorText" role="alert">
                {spamError}
              </p>
            )}
          </>
        )}

        <button
          className="backToListButton"
          type="button"
          onClick={() => setScreenMode("list")}
        >
          &lt; 스팸기사 목록
        </button>
      </div>
    );
  }

  return (
    <div className="sketchPage">
      <section className="listHeaderSketch">
        <h2>스팸기사함</h2>
        <button
          className="secondaryButton"
          type="button"
          onClick={() => loadArticles()}
        >
          새로고침
        </button>
      </section>

      <section className="timelineLayout">
        <div className="timeAxis">
          <span>시간순</span>
        </div>

        <div className="timelineArticles">
          {!articles.length ? (
            <EmptyState
              title="스팸기사가 없습니다."
              description="현재 스팸으로 분류된 기사가 없습니다."
            />
          ) : (
            articles.map((article) => (
              <button
                className="timelineArticle"
                key={article.article_id}
                type="button"
                onClick={() => handleSelectArticle(article)}
              >
                <div>
                  <strong>{article.title || "제목 없음"}</strong>
                  <p>
                    {article.summary ||
                      article.content ||
                      "본문 또는 요약이 없습니다."}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>출처</dt>
                    <dd>{article.source || "-"}</dd>
                  </div>
                  <div>
                    <dt>분류</dt>
                    <dd>스팸</dd>
                  </div>
                </dl>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
