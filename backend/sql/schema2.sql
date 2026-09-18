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
  target_mention_type VARCHAR(50),
  negative_impact_type VARCHAR(100),

  issue_severity FLOAT,
  public_sensitivity FLOAT,
  target_responsibility FLOAT,
  spread_potential FLOAT,
  risk_factor_reason TEXT,

  risk_score FLOAT,
  cluster_key VARCHAR(500),

  analysis_status VARCHAR(20),
  analyzed_at DATETIME,

  FOREIGN KEY (article_id) REFERENCES articles(article_id),
  FOREIGN KEY (cluster_id) REFERENCES clusters(cluster_id)
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

  FOREIGN KEY (article_id) REFERENCES articles(article_id),
  FOREIGN KEY (cluster_id) REFERENCES clusters(cluster_id)
);