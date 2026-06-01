function buildAnalysisPrompt(article) {
    return `
반드시 유효한 JSON 객체만 출력하세요.
설명, 마크다운, 코드블록, 주석, 추가 문장을 절대 출력하지 마세요.
JSON 앞뒤에 어떤 문장도 붙이지 마세요.

분석 대상:
서울교통공사

대상 설명:
서울교통공사는 서울 지하철을 운영하는 도시철도 공기업입니다.
브랜드 이미지 판단 요소는 안전, 정시성, 시민 편의, 공공성, 사고 대응, 역무 서비스, 시설 관리, 혼잡 관리, 노사 문제입니다.

분석 목적:
1. 같은 사건을 다룬 기사끼리 묶기 위한 사건 식별 정보를 추출합니다.
2. 알림 발송에 사용할 요약, 알림 제목, 알림 메시지를 생성합니다.
3. 위험도 계산에 사용할 팩터를 추출합니다.
4. 최종 risk_score는 출력하지 마세요. risk_score는 서버에서 계산합니다.
5. analysis_status는 출력하지 마세요. analysis_status는 백엔드에서 completed로 저장합니다.
6. cluster_key는 출력하지 마세요. cluster_key는 서버에서 조합합니다.

절대 규칙:
- 기사 제목과 본문에 없는 기관명, 조직명, 인물명, 장소명은 절대 생성하지 마세요.
- 기사에 명시되지 않은 관련 기관을 추측해서 넣지 마세요.
- 정보가 없으면 빈 배열 [] 또는 빈 문자열 "" 또는 JSON null을 사용합니다.
- 숫자 평가는 추측하지 말고 아래 점수 기준에 맞춰 보수적으로 평가합니다.
- 위험도 팩터는 긍정적 개선 기사에는 높게 주지 마세요.
- 단순 안내, 홍보, 개선 계획은 위험도가 낮은 사건으로 평가합니다.
- 기사에서 비중이 낮은 부가 설명, 예시, 기술 소개, 향후 계획을 핵심 사건처럼 강조하지 마세요.

판단 기준:
- target_related는 기사가 서울교통공사 또는 서울 지하철 운영 이미지와 관련 있으면 true입니다.
- target_mention_type은 서울교통공사를 직접 언급하면 direct, 서울 지하철/역/운행/승객 안전 등으로 간접 관련이면 indirect, 무관하면 none입니다.
- sentiment_score는 기사 전체의 감정을 -1.0부터 1.0 사이 숫자로 평가합니다.
- sentiment_label은 sentiment_score를 기준으로 정합니다.
  - -1.0 이상 -0.6 이하: very_negative
  - -0.6 초과 -0.2 이하: negative
  - -0.2 초과 0.2 미만: neutral
  - 0.2 이상 0.6 미만: positive
  - 0.6 이상 1.0 이하: very_positive

요약 기준:
- summary는 기사에서 가장 비중이 큰 사건을 중심으로 작성합니다.
- 기사 제목과 직접 관련된 사건을 우선 요약합니다.
- 반복 언급되거나 기사 전체를 관통하는 내용을 핵심 사건으로 판단합니다.
- 부가 설명, 예시, 배경 정보, 향후 계획은 핵심 사건보다 우선하지 마세요.
- 기사에서 언급 비중이 낮은 기술, 정책, 시스템 도입 내용은 핵심 사건처럼 강조하지 마세요.

사건 정보 기준:
- event_date는 사건 발생일을 알 수 있으면 "YYYY-MM-DD" 형식의 문자열로 출력합니다.
- "지난 21일" 형태는 published_at과 같은 연월 사용
- published_at이 없거나 UNKNOWN이면 event_date를 추측하지 말고 null을 우선 사용합니다.
- 절대 연도를 임의 생성하지 마라
- event_date를 알 수 없으면 문자열 "null"이 아니라 실제 JSON null로 출력합니다.

- event_location은 기사에서 실제 사건 발생 장소가 명시된 경우에만 출력합니다.
- 기관명 또는 조직명에 포함된 지역명만 보고 장소를 추론하지 마세요.
- event_location은 특정 사건이 발생한 장소가 명확할 때만 출력합니다.
- 여러 장소의 통계, 비교, 순위, 현황을 다루는 기사라면 event_location은 빈 문자열 "" 로 출력합니다.
- 장소가 기사의 핵심 사건을 대표하지 않으면 event_location에 넣지 마세요.
- 장소가 명확하지 않으면 빈 문자열 ""로 출력합니다.

- event_name 규칙 (매우 중요):
  1. 기관명이나 지엽적인 조치보다 '사건 자체의 본질'을 중심으로 작성합니다.
  2. 날짜, 수식어, 감정 표현, 언론식 과장 표현은 전부 제거합니다.
  3. 형식을 가능한 한 "핵심 대상/장소 + 핵심 원인 사건"으로 통일하여 다른 기사여도 동일한 event_name이 도출되게 하세요.
  4. 후속 조치나 결과(운행 중단, 복구, 점검, 대책 발표 등)가 아닌 '원인 사건'을 기준으로 삼아야 합니다.

event_name 작성 예시:
- "서울교통공사, 가족과 만든 사랑의 빵 전달" → "사랑의 빵 나눔 행사"
- "부정승차 예방 나선 서울교통공사" → "부정승차 예방 캠페인"
- "전장연 탑승 시위로 출근길 지연" → "전장연 시위로 인한 지하철 운행 지연"
- "○○ 사고로 인한 운행 중단" → "○○ 사고"
- "○○ 사고 복구 작업" → "○○ 사고"
- "○○ 사고 원인 조사 및 대책 발표" → "○○ 사고"
- "○○ 문제로 인한 민원 증가" → "○○ 문제"

- event_entities는 기사 제목 또는 본문에 실제로 등장한 기관, 조직, 인물, 장소만 출력합니다.
- event_entities에는 추측한 기관명, 조직명, 인물명, 장소명을 넣지 마세요.
- event_entities에 넣을 정보가 없으면 빈 배열 [] 로 출력합니다.
- 기사 핵심 사건과 직접 관련 없는 기관, 정책, 배경 설명은 event_entities에 넣지 마세요.

- event_keywords는 반드시 10개를 출력합니다.
- event_keywords는 같은 사건을 묶기 위한 핵심 기준입니다.
- 기사 핵심 사건을 식별할 수 있는 고유명사, 장소, 대상, 원인, 사고 유형 단어를 우선 포함합니다.
- 일반 명사 단독 사용은 피하되, 사건의 핵심 주체나 고유 대상(예: "서소문", "고가차도", "KTX", "노선명")은 기사들이 잘 묶일 수 있도록 반드시 포함하세요.

알림 기준:
- alert_topic은 사용자에게 보여줄 짧은 알림 제목입니다.
- alert_message는 사용자에게 보여줄 한 문장 알림 내용입니다.

대상 기준 및 핵심 주제 판단 규칙 (필수):
- target_name은 항상 "서울교통공사"로 출력합니다.
- 🚨 [핵심 주제 판단 기준]: 
  기사의 '가장 중심이 되는 사건이나 주제(Main Topic)'가 아래 두 가지 중 하나에 해당할 때만 target_related를 true로 평가합니다.
  1. 서울교통공사라는 기관의 직접적인 행동, 정책, 발표, 보도자료, 홍보, 미담, 노사 관계
  2. 서울 지하철 시스템 자체의 물리적 상태 및 인프라 (사고, 고장, 파업, 지연, 안전, 시설 관리, 서비스 개선)

- ❌ [단순 배경 언급 필터링 규칙]:
  기사의 주된 내용이 일반적인 사회적 현상, 트렌드, 커뮤니티 논란, 직장 생활 갈등, 일상적인 개인 간의 에피소드 등이고, '지하철'이나 '지하철 연착/혼잡'이라는 단어가 단순히 인물의 이동 수단, 지각의 변명, 혹은 이야기를 전개하기 위한 '배경/맥락'으로만 소비되는 경우에는 서울교통공사의 이미지나 운영과 무관한 기사입니다. 이 경우 반드시 target_related를 false로, target_mention_type을 none으로 평가하세요.

issue_severity 기준:
- 0.0 ~ 0.2: 단순 안내, 홍보, 개선 계획, 긍정적 서비스 개선
- 0.3 ~ 0.5: 민원 증가, 불편, 경미한 운영 문제
- 0.6 ~ 0.8: 사고, 운행 장애, 안전 문제, 사회적 논란
- 0.9 ~ 1.0: 사망, 대형 사고, 중대 범죄, 대규모 마비

public_sensitivity 기준:
- 0.0 ~ 0.2: 대중 관심 낮음
- 0.3 ~ 0.5: 일부 이용자 관심
- 0.6 ~ 0.8: 시민 다수 관심 가능
- 0.9 ~ 1.0: 전국적 사회 이슈 가능

target_responsibility 기준:
- 0.0 ~ 0.2: 서울교통공사 책임 거의 없음
- 0.3 ~ 0.5: 간접 책임 또는 일부 관련
- 0.6 ~ 0.8: 운영, 관리, 대응 책임 큼
- 0.9 ~ 1.0: 명백한 직접 책임

매우 중요한 규칙:
- issue_severity와 target_responsibility는 서로 독립적으로 평가합니다.
- 사건이 매우 심각하더라도 서울교통공사가 직접 원인을 제공하지 않았다면 target_responsibility를 높게 평가하지 마세요.
- 외부 요인으로 발생한 사건은 target_responsibility를 0.0~0.3 범위로 낮게 평가합니다.
- 서울교통공사가 직접 운영 실패, 관리 부실, 대응 실패 등을 일으킨 경우에만 target_responsibility를 0.6 이상으로 평가합니다.

spread_potential 기준:
- 0.0 ~ 0.2: 확산 가능성 낮음
- 0.3 ~ 0.5: 제한적 확산 가능
- 0.6 ~ 0.8: 온라인/언론 확산 가능
- 0.9 ~ 1.0: 대규모 확산 가능

issue_type 후보:
service_disruption, service, safety, accident, labor, crime, policy, facility, congestion, customer_service, finance, reputation, etc

issue_type 분류 기준:
- service: 사회공헌, 캠페인, 홍보, 일반 서비스 개선
- service_disruption: 운행 지연, 운행 중단, 서비스 장애, 출근길 차질
- safety: 승객 안전, 시설 안전, 화재, 추락, 부상 위험
- accident: 실제 사고 발생
- labor: 노사갈등, 파업, 임금 협상
- finance: 적자, 재정 부담
- policy: 법, 제도, 요금, 정책 논의
- crime: 범죄, 고소, 불법행위

negative_impact_type 후보:
safety, service, labor, crime, accident, management, policy, facility, congestion, reputation, none, etc

출력 형식:
{
  "summary": "string",
  "sentiment_label": "very_negative",
  "sentiment_score": -0.5,
  "alert_topic": "string",
  "alert_message": "string",
  "target_name": "서울교통공사",
  "issue_type": "safety",
  "event_name": "string",
  "event_location": "string",
  "event_date": null,
  "event_entities": ["string"],
  "event_keywords": ["string"],
  "target_related": true,
  "target_mention_type": "direct",
  "negative_impact_type": "safety",
  "issue_severity": 0.0,
  "public_sensitivity": 0.0,
  "target_responsibility": 0.0,
  "spread_potential": 0.0,
  "risk_factor_reason": "string"
}

기사 발행일:
${article.published_at}

기사 제목:
${article.title}

기사 본문:
${article.content}
`;
}

module.exports = buildAnalysisPrompt;