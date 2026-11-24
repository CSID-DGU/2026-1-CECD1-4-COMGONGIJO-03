CREATE TABLE IF NOT EXISTS risk_overall_feedback (
    article_id INT PRIMARY KEY,
    analysis_id INT NOT NULL,
    cluster_id_at_feedback INT NOT NULL,
    overall_label DECIMAL(4,3) NOT NULL,
    raw_factors JSON NOT NULL,
    calibrated_factors JSON NULL,
    model_score FLOAT NOT NULL,
    model_version VARCHAR(64) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES articles(article_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS risk_weight_training_runs (
    run_id INT AUTO_INCREMENT PRIMARY KEY,
    applied BOOLEAN NOT NULL,
    previous_model JSON NOT NULL,
    candidate_model JSON NULL,
    report JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX risk_weight_active (applied, run_id)
);
