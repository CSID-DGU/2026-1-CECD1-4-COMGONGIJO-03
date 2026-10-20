USE news_db;

SET FOREIGN_KEY_CHECKS = 0;

-- clusters를 참조하므로 먼저 초기화합니다.
TRUNCATE TABLE cluster_links;

TRUNCATE TABLE alerts;
TRUNCATE TABLE article_analysis;
TRUNCATE TABLE clusters;
TRUNCATE TABLE articles;

SET FOREIGN_KEY_CHECKS = 1;

-- 테스트용