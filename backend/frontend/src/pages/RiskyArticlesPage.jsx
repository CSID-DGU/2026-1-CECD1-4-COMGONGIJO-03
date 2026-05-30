import { useEffect, useState } from "react";
import ArticleDetailPanel from "../components/ArticleDetailPanel";
import ArticleList from "../components/ArticleList";
import LoadingState from "../components/LoadingState";
import SampleModeBanner from "../components/SampleModeBanner";
import { getArticleById, getRiskyArticles } from "../services/articles";
import { getSampleArticleById, getSampleRiskyArticles } from "../services/sampleData";

function getErrorMessage(error) {
  return error?.response?.data?.message || error?.message || "알 수 없는 오류가 발생했습니다.";
}

export default function RiskyArticlesPage() {
  const [articles, setArticles] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [minRisk, setMinRisk] = useState("0.7");
  const [loading, setLoading] = useState(true);
  const [sampleMode, setSampleMode] = useState(false);
  const [sampleReason, setSampleReason] = useState("");

  const loadRiskyArticles = async () => {
    setLoading(true);
    try {
      const response = await getRiskyArticles(minRisk);
      const nextArticles = response.data.articles || [];
      setArticles(nextArticles);
      setSelectedArticle(nextArticles[0] || null);
      setSampleMode(false);
      setSampleReason("");
    } catch (requestError) {
      const nextArticles = getSampleRiskyArticles(minRisk);
      setArticles(nextArticles);
      setSelectedArticle(nextArticles[0] || null);
      setSampleMode(true);
      setSampleReason(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRiskyArticles();
  }, []);

  const handleSelectArticle = async (article) => {
    setSelectedArticle(article);
    try {
      const response = await getArticleById(article.article_id);
      setSelectedArticle(response.data.article);
    } catch {
      setSelectedArticle(getSampleArticleById(article.article_id) || article);
      if (!sampleMode) {
        setSampleMode(true);
        setSampleReason("상세 API 요청 실패로 샘플 상세 데이터를 표시합니다.");
      }
    }
  };

  if (loading) return <LoadingState label="위험 기사 목록을 불러오는 중입니다." />;

  return (
    <div className="pageStack">
      {sampleMode && <SampleModeBanner message={sampleReason} />}

      <section className="controlBand compactControls">
        <label>
          <span>최소 risk_score</span>
          <input
            min="0"
            max="1"
            step="0.05"
            type="number"
            value={minRisk}
            onChange={(event) => setMinRisk(event.target.value)}
          />
        </label>
        <button type="button" onClick={loadRiskyArticles}>
          적용
        </button>
      </section>

      <section className="workspaceGrid">
        <div className="listPanel">
          <ArticleList
            articles={articles}
            selectedArticleId={selectedArticle?.article_id}
            onSelect={handleSelectArticle}
          />
        </div>
        <ArticleDetailPanel
          article={selectedArticle}
          hasAlert={Number(selectedArticle?.risk_score || 0) >= 0.7}
        />
      </section>
    </div>
  );
}
