import { useEffect, useMemo, useState } from "react";
import ArticleDetailPanel from "../components/ArticleDetailPanel";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import SampleModeBanner from "../components/SampleModeBanner";
import Toolbar from "../components/Toolbar";
import {
  createArticle,
  getAlerts,
  getAnalyzedArticles,
  getArticleById,
  getArticleByUrl,
  getArticles
} from "../services/articles";
import {
  filterSampleArticles,
  getSampleArticleById,
  getSampleArticleByUrl,
  sampleAlerts
} from "../services/sampleData";

const socialSourcePatterns = [
  "sns",
  "twitter",
  "x.com",
  "facebook",
  "instagram",
  "youtube",
  "blog",
  "community",
  "커뮤니티",
  "블로그",
  "유튜브",
  "인스타",
  "페이스북"
];

const emptyArticleForm = {
  title: "",
  content: "",
  url: "",
  source: "",
  author: "",
  published_at: ""
};

function isSocialArticle(article) {
  const source = String(article.source || article.url || "").toLowerCase();
  return socialSourcePatterns.some((pattern) => source.includes(pattern));
}

function matchesSentiment(article, filter) {
  if (filter === "all") return true;
  const value = String(article.sentiment_label || "").toLowerCase();
  if (filter === "positive") return value.includes("긍정") || value.includes("positive");
  if (filter === "negative") return value.includes("부정") || value.includes("negative");
  return value.includes("공감") || value.includes("empathy");
}

function getDateValue(article) {
  return article.published_at || article.collected_at || article.analyzed_at;
}

function getDateKey(article) {
  const value = getDateValue(article);
  if (!value) return "날짜 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(dateKey) {
  if (!dateKey || dateKey === "날짜 없음") return "날짜 없음";
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short"
  });
}

function getSortTime(article) {
  const time = new Date(getDateValue(article)).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function scoreLabel(score) {
  if (score === null || score === undefined || score === "") return "-";
  const number = Number(score);
  if (Number.isNaN(number)) return score;
  return number.toFixed(2);
}

function getErrorMessage(error) {
  return error?.response?.data?.message || error?.message || "알 수 없는 오류가 발생했습니다.";
}

function mergeArticles(rawArticles, analyzedArticles) {
  const analyzedById = new Map(analyzedArticles.map((article) => [article.article_id, article]));
  const mergedArticles = rawArticles.map((article) => ({
    ...article,
    ...(analyzedById.get(article.article_id) || {})
  }));

  analyzedArticles.forEach((article) => {
    if (!mergedArticles.some((item) => item.article_id === article.article_id)) {
      mergedArticles.push(article);
    }
  });

  return mergedArticles;
}

export default function DashboardPage() {
  const [articles, setArticles] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [activeTab, setActiveTab] = useState("media");
  const [screenMode, setScreenMode] = useState("list");
  const [selectedDate, setSelectedDate] = useState("");
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState("latest");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [urlQuery, setUrlQuery] = useState("");
  const [articleForm, setArticleForm] = useState(emptyArticleForm);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [sampleMode, setSampleMode] = useState(false);
  const [sampleReason, setSampleReason] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [formError, setFormError] = useState("");

  const useSampleData = (keyword, reason) => {
    const nextArticles = filterSampleArticles(keyword);
    setArticles(nextArticles);
    setAlerts(sampleAlerts);
    setSelectedArticle((current) => current || nextArticles[0] || null);
    setSampleMode(true);
    setSampleReason(reason);
  };

  const loadData = async (keyword = "") => {
    setLoading(true);
    setError("");
    try {
      const [rawResponse, analyzedResponse, alertsResponse] = await Promise.all([
        getArticles(keyword),
        getAnalyzedArticles(),
        getAlerts()
      ]);

      const rawArticles = rawResponse.data.articles || [];
      const analyzedArticles = analyzedResponse.data.articles || [];
      const mergedArticles = mergeArticles(rawArticles, analyzedArticles);

      setArticles(mergedArticles);
      setAlerts(alertsResponse.data.alerts || []);
      setSelectedArticle((current) => current || mergedArticles[0] || null);
      setSampleMode(false);
      setSampleReason("");
    } catch (requestError) {
      useSampleData(keyword, getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredArticles = useMemo(() => {
    return articles
      .filter((article) => (activeTab === "sns" ? isSocialArticle(article) : !isSocialArticle(article)))
      .filter((article) => matchesSentiment(article, sentimentFilter))
      .filter((article) => {
        if (!query.trim()) return true;
        return String(article.title || "").toLowerCase().includes(query.trim().toLowerCase());
      })
      .sort((a, b) => {
        if (sortOrder === "oldest") return getSortTime(a) - getSortTime(b);
        if (sortOrder === "riskDesc") return Number(b.risk_score || 0) - Number(a.risk_score || 0);
        if (sortOrder === "riskAsc") return Number(a.risk_score || 0) - Number(b.risk_score || 0);
        return getSortTime(b) - getSortTime(a);
      });
  }, [activeTab, articles, query, sentimentFilter, sortOrder]);

  const dateKeys = useMemo(() => {
    return [...new Set(filteredArticles.map(getDateKey))].sort((a, b) => {
      if (a === "날짜 없음") return 1;
      if (b === "날짜 없음") return -1;
      return new Date(b) - new Date(a);
    });
  }, [filteredArticles]);

  useEffect(() => {
    if (!dateKeys.length) {
      setSelectedDate("");
      return;
    }
    if (!selectedDate || !dateKeys.includes(selectedDate)) {
      setSelectedDate(dateKeys[0]);
    }
  }, [dateKeys, selectedDate]);

  const dateArticles = useMemo(() => {
    if (!selectedDate) return filteredArticles;
    return filteredArticles.filter((article) => getDateKey(article) === selectedDate);
  }, [filteredArticles, selectedDate]);

  const hasAlert = useMemo(() => {
    if (!selectedArticle) return false;
    return alerts.some((alert) => alert.article_id === selectedArticle.article_id);
  }, [alerts, selectedArticle]);

  const selectedDateIndex = dateKeys.indexOf(selectedDate);

  const moveDate = (direction) => {
    if (!dateKeys.length) return;
    const nextIndex = Math.min(Math.max(selectedDateIndex + direction, 0), dateKeys.length - 1);
    setSelectedDate(dateKeys[nextIndex]);
  };

  const handleSelectArticle = async (article) => {
    setSelectedArticle(article);
    setScreenMode("detail");
    if (!article.article_id) return;

    setDetailLoading(true);
    try {
      const response = await getArticleById(article.article_id);
      setSelectedArticle(response.data.article);
    } catch {
      const sampleArticle = getSampleArticleById(article.article_id);
      setSelectedArticle(sampleArticle || article);
      if (!sampleMode) {
        setSampleMode(true);
        setSampleReason("상세 API 요청 실패로 선택한 기사 데이터를 표시합니다.");
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSearch = (event) => {
    event.preventDefault();
    loadData(query.trim());
  };

  const handleReset = () => {
    setQuery("");
    setSortOrder("latest");
    setSentimentFilter("all");
    loadData();
  };

  const handleUrlSearch = async (event) => {
    event.preventDefault();
    if (!urlQuery.trim()) return;

    setDetailLoading(true);
    setError("");
    try {
      const response = await getArticleByUrl(urlQuery.trim());
      setSelectedArticle(response.data.article);
      setScreenMode("detail");
      setSampleMode(false);
      setSampleReason("");
    } catch (requestError) {
      const sampleArticle = getSampleArticleByUrl(urlQuery.trim()) || articles[0] || null;
      setSelectedArticle(sampleArticle);
      setScreenMode("detail");
      setSampleMode(true);
      setSampleReason(getErrorMessage(requestError));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreateArticle = async (event) => {
    event.preventDefault();
    setFormMessage("");
    setFormError("");

    try {
      const payload = {
        ...articleForm,
        published_at: articleForm.published_at || null
      };
      const response = await createArticle(payload);
      setFormMessage(`article_id ${response.data.article_id} 저장 및 분석 요청이 완료되었습니다.`);
      setArticleForm(emptyArticleForm);
      loadData();
    } catch (requestError) {
      setFormError(`API 요청 실패: ${getErrorMessage(requestError)}. 현재 화면은 샘플 데이터로 유지됩니다.`);
      if (!articles.length) useSampleData("", getErrorMessage(requestError));
    }
  };

  if (loading) return <LoadingState label="기사와 분석 결과를 불러오는 중입니다." />;

  if (screenMode === "detail") {
    return (
      <div className="sketchPage detailScreen">
        {sampleMode && <SampleModeBanner message={sampleReason} />}

        <section className="detailTopControls">
          <button className="secondaryButton" type="button" onClick={() => setScreenMode("list")}>
            &lt; 목록
          </button>
          <Toolbar
            query={query}
            setQuery={setQuery}
            sortOrder={sortOrder}
            setSortOrder={setSortOrder}
            sentimentFilter={sentimentFilter}
            setSentimentFilter={setSentimentFilter}
            onSearch={handleSearch}
            onReset={handleReset}
          />
        </section>

        {detailLoading ? (
          <LoadingState label="상세 정보를 불러오는 중입니다." />
        ) : (
          <ArticleDetailPanel article={selectedArticle} hasAlert={hasAlert} />
        )}

        <section className="urlSourceList">
          <h2>URL 및 출처</h2>
          {[selectedArticle].filter(Boolean).map((article, index) => (
            <div className="urlSourceRow" key={article.article_id || article.url}>
              <span>{index + 1}</span>
              <a href={article.url} target="_blank" rel="noreferrer">
                {article.url || "URL 없음"}
              </a>
              <strong>{article.source || "출처 없음"}</strong>
            </div>
          ))}
          <button className="feedbackButton" type="button">
            피드백
          </button>
        </section>

        <button className="backToListButton" type="button" onClick={() => setScreenMode("list")}>
          &lt; 주제별 화면
        </button>
      </div>
    );
  }

  return (
    <div className="sketchPage">
      {sampleMode && <SampleModeBanner message={sampleReason} />}
      {error && <ErrorState message={error} onRetry={() => loadData(query.trim())} />}

      <section className="listHeaderSketch">
        <div className="tabGroup sketchTabs" role="tablist" aria-label="기사 유형">
          <button
            className={activeTab === "media" ? "active" : ""}
            type="button"
            onClick={() => setActiveTab("media")}
          >
            언론보도
          </button>
          <button
            className={activeTab === "sns" ? "active" : ""}
            type="button"
            onClick={() => setActiveTab("sns")}
          >
            SNS
          </button>
        </div>

        <div className="dateNavigator">
          <button
            className="secondaryButton"
            disabled={selectedDateIndex >= dateKeys.length - 1}
            type="button"
            onClick={() => moveDate(1)}
          >
            &lt;
          </button>
          <strong>{formatDateLabel(selectedDate)}</strong>
          <button
            className="secondaryButton"
            disabled={selectedDateIndex <= 0}
            type="button"
            onClick={() => moveDate(-1)}
          >
            &gt;
          </button>
        </div>

        <button className="secondaryButton" type="button" onClick={() => loadData(query.trim())}>
          업데이트
        </button>
      </section>

      <section className="controlBand sketchControlBand">
        <Toolbar
          query={query}
          setQuery={setQuery}
          sortOrder={sortOrder}
          setSortOrder={setSortOrder}
          sentimentFilter={sentimentFilter}
          setSentimentFilter={setSentimentFilter}
          onSearch={handleSearch}
          onReset={handleReset}
        />

        <form className="urlSearch" onSubmit={handleUrlSearch}>
          <label>
            <span>URL로 기사 찾기</span>
            <input
              value={urlQuery}
              onChange={(event) => setUrlQuery(event.target.value)}
              placeholder="https://..."
            />
          </label>
          <button type="submit">조회</button>
        </form>
      </section>

      <section className="timelineLayout">
        <div className="timeAxis">
          <span>시간순</span>
        </div>
        <div className="timelineArticles">
          {!dateArticles.length ? (
            <EmptyState title="조건에 맞는 기사가 없습니다." description="검색어 또는 필터를 조정해 보세요." />
          ) : (
            dateArticles.map((article) => (
              <button
                className="timelineArticle"
                key={`${article.article_id}-${article.analysis_id || "raw"}`}
                type="button"
                onClick={() => handleSelectArticle(article)}
              >
                <div>
                  <strong>{article.title || "제목 없음"}</strong>
                  <p>{article.summary || article.content || "본문 또는 요약이 없습니다."}</p>
                </div>
                <dl>
                  <div>
                    <dt>출처</dt>
                    <dd>{article.source || "-"}</dd>
                  </div>
                  <div>
                    <dt>감성</dt>
                    <dd>{article.sentiment_label || "분석 전"}</dd>
                  </div>
                  <div>
                    <dt>risk_score</dt>
                    <dd>{scoreLabel(article.risk_score)}</dd>
                  </div>
                </dl>
              </button>
            ))
          )}
        </div>
      </section>

      <button className="topicButton" type="button" onClick={() => setScreenMode("detail")}>
        &lt; 목록 &gt;
      </button>

      <section className="createBand">
        <div>
          <span className="eyebrow">POST /api/articles</span>
          <h2>기사 등록</h2>
        </div>
        <form className="articleForm" onSubmit={handleCreateArticle}>
          <input
            required
            value={articleForm.title}
            onChange={(event) => setArticleForm({ ...articleForm, title: event.target.value })}
            placeholder="제목"
          />
          <input
            required
            value={articleForm.url}
            onChange={(event) => setArticleForm({ ...articleForm, url: event.target.value })}
            placeholder="URL"
          />
          <input
            value={articleForm.source}
            onChange={(event) => setArticleForm({ ...articleForm, source: event.target.value })}
            placeholder="출처"
          />
          <input
            value={articleForm.author}
            onChange={(event) => setArticleForm({ ...articleForm, author: event.target.value })}
            placeholder="작성자"
          />
          <input
            type="datetime-local"
            value={articleForm.published_at}
            onChange={(event) =>
              setArticleForm({ ...articleForm, published_at: event.target.value })
            }
          />
          <textarea
            value={articleForm.content}
            onChange={(event) => setArticleForm({ ...articleForm, content: event.target.value })}
            placeholder="본문"
            rows="4"
          />
          <button type="submit">저장 및 분석 요청</button>
        </form>
        {formMessage && <p className="successText">{formMessage}</p>}
        {formError && <p className="errorText">{formError}</p>}
      </section>
    </div>
  );
}
