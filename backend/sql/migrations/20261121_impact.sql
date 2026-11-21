-- 기존 운영 DB에서 최초 1회 실행합니다. 실행 전에 백업해야 합니다.
-- 신규 설치는 schema2.sql에 동일한 스키마가 포함되어 있습니다.
ALTER TABLE article_analysis
    ADD COLUMN public_relevance FLOAT NULL,
    ADD COLUMN title_sensationalism FLOAT NULL,
    ADD COLUMN initial_spread_score FLOAT NULL,
    ADD COLUMN initial_impact_score FLOAT NULL,
    ADD COLUMN media_influence_origin VARCHAR(20) NULL,
    ADD COLUMN impact_model_version VARCHAR(64) NULL;

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
