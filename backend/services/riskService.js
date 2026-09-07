function calculateRiskScore(analysis) {
    return (
        Number(analysis.issue_severity || 0) * 0.3 +
        Number(analysis.public_sensitivity || 0) * 0.25 +
        Number(analysis.target_responsibility || 0) * 0.25 +
        Number(analysis.spread_potential || 0) * 0.2
    );
}

module.exports = {
    calculateRiskScore
};
