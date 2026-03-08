const { Client, GatewayIntentBits } = require('discord.js');
const { connectDB, disconnectDB } = require('./db/connection');
const { syncGuild } = require('./utils/archiver');
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
    // Connect to MongoDB
    dbConnection = await connectDB();

    // Get the guild to archive
    const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    if (!guild) {
      console.error('✗ Guild not found. Please check DISCORD_GUILD_ID in .env');
      process.exit(1);
    }

    console.log(`✓ Found guild: ${guild.name}`);
    console.log('\n📦 Starting archive sync...\n');

    // Perform the archive sync
    const startTime = Date.now();
    await syncGuild(guild);
    const duration = Date.now() - startTime;

    console.log(`\n✓ Archive sync completed in ${(duration / 1000).toFixed(2)}s`);

    // Disconnect and exit
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
