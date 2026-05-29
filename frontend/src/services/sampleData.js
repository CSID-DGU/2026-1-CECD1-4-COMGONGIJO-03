export const sampleArticles = [
  {
    article_id: 9001,
    analysis_id: 5001,
    title: "제품 안전 이슈 관련 언론 보도 확산",
    content:
      "신제품 사용 중 일부 소비자가 불편을 호소했다는 보도가 이어지고 있습니다. 회사는 사실 확인과 고객 안내를 준비 중입니다.",
    summary:
      "제품 안전 관련 불만이 기사화되며 브랜드 신뢰도에 영향을 줄 수 있는 상황입니다.",
    url: "https://example.com/news/product-safety",
    source: "중앙일보",
    author: "김현우",
    published_at: "2026-04-07T09:20:00",
    collected_at: "2026-04-07T09:40:00",
    analyzed_at: "2026-04-07T09:45:00",
    sentiment_label: "부정",
    sentiment_score: -0.72,
    risk_score: 0.86,
    issue_type: "product_safety",
    event_name: "신제품 안전성 논란",
    event_date: "2026-04-07",
    event_location: "서울",
    event_entities: JSON.stringify(["소비자", "고객센터", "신제품"]),
    event_keywords: JSON.stringify(["안전", "불만", "브랜드 신뢰"]),
    target_name: "브랜드",
    target_related: 1,
    target_mention_type: "direct",
    negative_impact_type: "reputation",
    risk_factor_reason: "언론 보도와 소비자 불만이 동시에 확인되어 확산 가능성이 높습니다.",
    analysis_status: "completed",
    cluster_key: "product_safety-sample"
  },
  {
    article_id: 9002,
    analysis_id: 5002,
    title: "SNS에서 고객 응대 지연 게시글 다수 공유",
    content:
      "고객 문의 답변이 지연되고 있다는 SNS 게시글이 공유되며 공감 반응이 빠르게 증가하고 있습니다.",
    summary:
      "SNS에서 고객 응대 지연 경험담이 확산되고 있어 단기 모니터링이 필요합니다.",
    url: "https://x.com/sample/customer-delay",
    source: "SNS X",
    author: "user_sample",
    published_at: "2026-04-07T11:05:00",
    collected_at: "2026-04-07T11:20:00",
    analyzed_at: "2026-04-07T11:25:00",
    sentiment_label: "공감",
    sentiment_score: -0.41,
    risk_score: 0.74,
    issue_type: "customer_service",
    event_name: "고객 응대 지연 공유",
    event_date: "2026-04-07",
    event_location: "온라인",
    event_entities: JSON.stringify(["고객센터", "SNS 사용자"]),
    event_keywords: JSON.stringify(["응대 지연", "공감", "고객 경험"]),
    target_name: "고객센터",
    target_related: 1,
    target_mention_type: "direct",
    negative_impact_type: "service_trust",
    risk_factor_reason: "공감 반응이 많고 유사 게시글이 반복되고 있습니다.",
    analysis_status: "completed",
    cluster_key: "customer_service-sample"
  },
  {
    article_id: 9003,
    analysis_id: 5003,
    title: "사회공헌 캠페인에 긍정 반응 증가",
    content:
      "지역 아동 지원 캠페인에 대한 시민 반응이 긍정적으로 나타났으며 관련 보도도 이어졌습니다.",
    summary:
      "브랜드 사회공헌 활동이 긍정적으로 보도되어 평판 개선에 기여할 수 있습니다.",
    url: "https://example.com/news/csr-campaign",
    source: "연합뉴스",
    author: "이서연",
    published_at: "2026-04-06T15:30:00",
    collected_at: "2026-04-06T15:42:00",
    analyzed_at: "2026-04-06T15:48:00",
    sentiment_label: "긍정",
    sentiment_score: 0.82,
    risk_score: 0.18,
    issue_type: "csr",
    event_name: "지역 아동 지원 캠페인",
    event_date: "2026-04-06",
    event_location: "부산",
    event_entities: JSON.stringify(["지역 아동", "캠페인"]),
    event_keywords: JSON.stringify(["사회공헌", "긍정", "캠페인"]),
    target_name: "브랜드",
    target_related: 1,
    target_mention_type: "direct",
    negative_impact_type: null,
    risk_factor_reason: "위험 신호는 낮고 긍정 반응이 우세합니다.",
    analysis_status: "completed",
    cluster_key: "csr-sample"
  },
  {
    article_id: 9004,
    analysis_id: 5004,
    title: "커뮤니티에서 가격 정책 변경 논쟁",
    content:
      "가격 정책 변경을 두고 온라인 커뮤니티에서 찬반 의견이 나뉘고 있습니다.",
    summary:
      "가격 정책 변경에 대한 부정 의견과 방어 의견이 함께 나타나는 중간 위험 이슈입니다.",
    url: "https://community.example.com/posts/pricing",
    source: "온라인 커뮤니티",
    author: "community_user",
    published_at: "2026-04-06T18:10:00",
    collected_at: "2026-04-06T18:25:00",
    analyzed_at: "2026-04-06T18:31:00",
    sentiment_label: "부정",
    sentiment_score: -0.38,
    risk_score: 0.58,
    issue_type: "pricing",
    event_name: "가격 정책 변경 논쟁",
    event_date: "2026-04-06",
    event_location: "온라인",
    event_entities: JSON.stringify(["가격 정책", "커뮤니티"]),
    event_keywords: JSON.stringify(["가격", "논쟁", "소비자 반응"]),
    target_name: "브랜드",
    target_related: 1,
    target_mention_type: "direct",
    negative_impact_type: "purchase_intent",
    risk_factor_reason: "부정 의견이 있으나 확산 속도는 제한적입니다.",
    analysis_status: "completed",
    cluster_key: "pricing-sample"
  }
];

export const sampleAlerts = [
  {
    alert_id: 7001,
    article_id: 9001,
    alert_topic: "제품 안전 이슈 위험 알림",
    alert_message: "위험도 0.86의 제품 안전 관련 언론 보도가 확인되었습니다.",
    risk_score: 0.86,
    alert_status: "created",
    created_at: "2026-04-07T09:46:00",
    title: "제품 안전 이슈 관련 언론 보도 확산",
    url: "https://example.com/news/product-safety",
    source: "중앙일보"
  },
  {
    alert_id: 7002,
    article_id: 9002,
    alert_topic: "SNS 고객 응대 이슈 알림",
    alert_message: "SNS 공감 반응이 증가하는 고객 응대 지연 이슈입니다.",
    risk_score: 0.74,
    alert_status: "created",
    created_at: "2026-04-07T11:26:00",
    title: "SNS에서 고객 응대 지연 게시글 다수 공유",
    url: "https://x.com/sample/customer-delay",
    source: "SNS X"
  }
];

export function filterSampleArticles(keyword = "") {
  const value = keyword.trim().toLowerCase();
  if (!value) return sampleArticles;
  return sampleArticles.filter((article) => {
    return [article.title, article.content, article.source]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(value));
  });
}

export function getSampleArticleById(article_id) {
  return sampleArticles.find((article) => String(article.article_id) === String(article_id));
}

export function getSampleArticleByUrl(url) {
  return sampleArticles.find((article) => article.url === url);
}

export function getSampleRiskyArticles(minRisk = 0.7) {
  const threshold = Number(minRisk || 0.7);
  return sampleArticles
    .filter((article) => Number(article.risk_score || 0) >= threshold)
    .sort((a, b) => Number(b.risk_score || 0) - Number(a.risk_score || 0));
}
