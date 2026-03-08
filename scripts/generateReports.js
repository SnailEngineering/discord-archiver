const { connectDB, disconnectDB } = require('../db/connection');
const { getWeeklyReport, formatReport } = require('../utils/reportGenerator');
require('dotenv').config();

async function generateReports() {
  try {
    // Connect to MongoDB
    await connectDB();

    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
      console.error('✗ DISCORD_GUILD_ID not found in .env');
      process.exit(1);
    }

    console.log('📊 Generating weekly report...\n');

    // Generate the weekly report
    const report = await getWeeklyReport(guildId);
    const formattedReport = formatReport(report);

    console.log(formattedReport);

    // Save report to file
    const fs = require('fs');
    const path = require('path');
    const timestamp = new Date().toISOString().split('T')[0];
    const reportDir = path.join(__dirname, '../reports');

    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportFile = path.join(reportDir, `report-${timestamp}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`\n✓ Report saved to: ${reportFile}`);

    // Save formatted report
    const formattedReportFile = path.join(reportDir, `report-${timestamp}.txt`);
    fs.writeFileSync(formattedReportFile, formattedReport);
    console.log(`✓ Formatted report saved to: ${formattedReportFile}`);

    await disconnectDB();
    process.exit(0);
  } catch (error) {
    console.error('✗ Error generating reports:', error);
    await disconnectDB();
    process.exit(1);
  }
}

generateReports();
