CREATE DATABASE IF NOT EXISTS news_db;
USE news_db;

CREATE TABLE articles (
  article_id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT,
  url VARCHAR(500) NOT NULL UNIQUE,
  source VARCHAR(100),
  author VARCHAR(100),
  published_at DATETIME,
  collected_at DATETIME NOT NULL
);

CREATE TABLE clusters (
  cluster_id INT AUTO_INCREMENT PRIMARY KEY,
  cluster_key VARCHAR(500) NOT NULL UNIQUE,

  representative_title VARCHAR(255),
  representative_article_id INT,
  issue_type VARCHAR(100),

  -- 클러스터에 포함된 기사 임베딩의 평균 벡터
  -- 새 기사가 편입될 때 누적 평균 방식으로 갱신
  centroid_embedding LONGTEXT,

  first_detected DATETIME NOT NULL,
  last_detected DATETIME NOT NULL,

  article_count INT DEFAULT 1,
  max_risk_score FLOAT DEFAULT 0,

  cluster_status VARCHAR(50) DEFAULT 'active',

  FOREIGN KEY (representative_article_id)
    REFERENCES articles(article_id)
    ON DELETE SET NULL
);

CREATE TABLE article_analysis (
  analysis_id INT AUTO_INCREMENT PRIMARY KEY,
  article_id INT NOT NULL,
  cluster_id INT,

  summary TEXT,
  sentiment_label VARCHAR(20),
  sentiment_score FLOAT,

  target_name VARCHAR(100),
  issue_type VARCHAR(100),
  event_name VARCHAR(255),
  event_date DATE,
  event_location VARCHAR(255),
  event_entities TEXT,
  event_keywords TEXT,

  -- 제목 + 요약문을 BGE-M3로 임베딩한 기사 벡터
  -- centroid 계산, medoid 선정, 클러스터 재검토에 사용
  article_embedding LONGTEXT,

  target_related BOOLEAN,
  spam_override BOOLEAN DEFAULT NULL,
  target_mention_type VARCHAR(50),
  negative_impact_type VARCHAR(100),

-- 위험도 평가에 사용하는 4개 지표와 별도 언론사 영향력 지표
  media_influence FLOAT,
  public_relevance FLOAT,
  title_sensationalism FLOAT,
  initial_spread_score FLOAT,
  initial_impact_score FLOAT,
  media_influence_origin VARCHAR(20),
  impact_model_version VARCHAR(64),
  issue_severity FLOAT,
  target_responsibility FLOAT,
  norm_violation FLOAT,
  similar_crisis_history FLOAT,

  risk_factor_reason TEXT,

  risk_score FLOAT,
  risk_calibrated_factors JSON,
  risk_model_version VARCHAR(64),
  cluster_key VARCHAR(500),

  analysis_status VARCHAR(20),
  analyzed_at DATETIME,

  FOREIGN KEY (article_id)
    REFERENCES articles(article_id),

  FOREIGN KEY (cluster_id)
    REFERENCES clusters(cluster_id)
);

CREATE TABLE alerts (
  alert_id INT AUTO_INCREMENT PRIMARY KEY,
  article_id INT NOT NULL,
  cluster_id INT,

  alert_topic VARCHAR(255),
  alert_message TEXT,
  risk_score FLOAT,
  alert_status VARCHAR(50),
  created_at DATETIME NOT NULL,

  FOREIGN KEY (article_id)
    REFERENCES articles(article_id),

  FOREIGN KEY (cluster_id)
    REFERENCES clusters(cluster_id)
);

CREATE TABLE cluster_links (
  link_id INT AUTO_INCREMENT PRIMARY KEY,

  -- 시간상 이전 클러스터
  from_cluster_id INT NOT NULL,

  -- 시간상 이후 클러스터
  to_cluster_id INT NOT NULL,

  -- 현재는 날짜가 다른 동일 사건의 연결에 사용
  link_type VARCHAR(50)
    NOT NULL
    DEFAULT 'same_event',

  -- 두 클러스터의 유사도 점수
  similarity_score FLOAT NOT NULL,

  created_at DATETIME NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  -- 동일한 연결의 중복 생성을 방지
  UNIQUE KEY uq_cluster_link (
    from_cluster_id,
    to_cluster_id,
    link_type
  ),

  FOREIGN KEY (from_cluster_id)
    REFERENCES clusters(cluster_id)
    ON DELETE CASCADE,

  FOREIGN KEY (to_cluster_id)
    REFERENCES clusters(cluster_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS risk_feedback (
    article_id INT PRIMARY KEY,
    factor_labels JSON,
    overall_label DECIMAL(4,3),
    updated_at DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (article_id)
        REFERENCES articles(article_id)
        ON DELETE CASCADE
);
-- 파급력 평가 및 피드백 테이블
CREATE TABLE IF NOT EXISTS impact_feedback (
    article_id INT PRIMARY KEY,
    factor_labels JSON NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES articles(article_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_source_scores (
    source_key VARCHAR(150) PRIMARY KEY,
    display_name VARCHAR(150) NOT NULL,
    influence_score DECIMAL(3,2) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cluster_impact_snapshots (
    cluster_id INT NOT NULL,
    observation_days INT NOT NULL,
    linked_cluster_ids JSON NOT NULL,
    source_signature CHAR(64) NOT NULL,
    first_article_id INT NULL,
    first_published_at DATETIME NULL,
    observation_ends_at DATETIME NULL,
    news_count INT NULL,
    source_count INT NULL,
    duration_hours FLOAT NULL,
    first_24h_count INT NULL,
    observed_spread_score FLOAT NULL,
    observed_impact_score FLOAT NULL,
    normalization_version VARCHAR(64) NOT NULL,
    calculation_status VARCHAR(24) NOT NULL,
    confirmed_at DATETIME NULL,
    calculated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cluster_id, observation_days),
    FOREIGN KEY (cluster_id) REFERENCES clusters(cluster_id) ON DELETE CASCADE,
    FOREIGN KEY (first_article_id) REFERENCES articles(article_id) ON DELETE SET NULL
);
