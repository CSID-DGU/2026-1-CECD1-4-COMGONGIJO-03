const db = require("../db");

async function main() {
    try {
        const [columns] = await db.query(
            "SHOW COLUMNS FROM article_analysis"
        );

        const found = new Set(
            columns.map(row => row.Field)
        );

        if (!found.has("risk_calibrated_factors")) {
            await db.query(`
                ALTER TABLE article_analysis
                ADD COLUMN risk_calibrated_factors JSON NULL
            `);
            console.log("Added risk_calibrated_factors");
        }

        if (!found.has("risk_model_version")) {
            await db.query(`
                ALTER TABLE article_analysis
                ADD COLUMN risk_model_version VARCHAR(64) NULL
            `);
            console.log("Added risk_model_version");
        }

        await db.query(`
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
            )
        `);

        console.log("Risk feedback schema ready");
    } finally {
        await db.end();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});