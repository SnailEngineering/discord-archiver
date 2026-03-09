const { Client, GatewayIntentBits } = require('discord.js');
const { connectDB, disconnectDB } = require('./db/connection');
const { syncGuild, getSyncStartTime, getBackfillDateRange } = require('./utils/archiver');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let dbConnection;

client.once('ready', async () => {
  console.log(`✓ Bot logged in as ${client.user.tag}`);

  try {
    dbConnection = await connectDB();

    const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    if (!guild) {
      console.error('✗ Guild not found. Please check DISCORD_GUILD_ID in .env');
      process.exit(1);
    }

    console.log(`✓ Found guild: ${guild.name}`);

    // Resolve the date window for this run
    const backfill = getBackfillDateRange();
    let afterDate, beforeDate;

    if (backfill) {
      afterDate = backfill.afterDate;
      beforeDate = backfill.beforeDate;
      const mode = process.env.BACKFILL_MODE;
      console.log(`\n🗂  Backfill mode: ${mode}`);
      console.log(`   From: ${afterDate.toLocaleString()}`);
      console.log(`   To:   ${beforeDate.toLocaleString()}`);
    } else {
      afterDate = await getSyncStartTime(guild.id);
      beforeDate = null;
      console.log(`\n🔄 Incremental sync from: ${afterDate.toLocaleString()}`);
    }

    console.log('\n📦 Starting archive sync...\n');

    const startTime = Date.now();
    await syncGuild(guild, afterDate, beforeDate);
    const duration = Date.now() - startTime;

    console.log(`\n✓ Archive sync completed in ${(duration / 1000).toFixed(2)}s`);

    await disconnectDB();
    await client.destroy();
    process.exit(0);
  } catch (error) {
    console.error('✗ Error during sync:', error);
    if (dbConnection) await disconnectDB();
    process.exit(1);
  }
});

client.login(process.env.DISCORD_TOKEN);
