import {formatKoreanDate} from './articleView.js';
// Keep the filtered display order, including matching collapsed cluster members.
export function uniqueArticles(articles) {
  const ids = new Set();
  const urls = new Set();
  return articles.filter((article) => {
    const id = article.article_id == null || article.article_id === ""
      ? "" : String(article.article_id);
    const url = String(article.url || "").trim();
    if ((id && ids.has(id)) || (url && urls.has(url))) return false;
    if (id) ids.add(id);
    if (url) urls.add(url);
    return true;
  });
}

export async function createArticleWorkbook(articles) {
  // Load the browser-compatible library only when a download is requested.
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("기사 목록");
  sheet.columns = [
    { header: "기사 ID", key: "article_id", width: 16 },
    { header: "제목", key: "title", width: 60 },
    { header: "출처", key: "source", width: 20 },
    { header: "작성/발행 날짜", key: "date", width: 28 },
    { header: "감성", key: "sentiment_label", width: 14 },
    { header: "위험도", key: "risk_score", width: 14 },
    { header: "요약", key: "summary", width: 80 },
    { header: "원문 URL", key: "url", width: 65 }
  ];
  for (const article of uniqueArticles(articles)) {
    sheet.addRow({
      article_id: article.article_id == null ? "" : String(article.article_id),
      title: article.title ?? "",
      source: article.source ?? "",
      date: formatKoreanDate(article.published_at || article.created_at),
      sentiment_label: article.sentiment_label ?? "",
      risk_score: article.risk_score ?? "",
      summary: article.summary ?? "",
      url: article.url ?? ""
    });
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:H1";
  sheet.getColumn("risk_score").numFmt = "0.00";
  return workbook;
}

export async function downloadArticleExcel(articles, { selectedDate, activeTab }) {
  const workbook = await createArticleWorkbook(articles);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `기사목록_${activeTab === "sns" ? "SNS" : "언론보도"}_${selectedDate || "전체"}.xlsx`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
