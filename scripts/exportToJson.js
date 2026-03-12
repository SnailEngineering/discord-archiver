/**
 * exportToJson.js — Export all Discord messages and reactions to local JSON files.
 *
 * Walks every text channel in the guild from oldest to newest, saving paginated
 * JSON files to disk. No MongoDB dependency — purely Discord API → local files.
 *
 * Output structure:
 *   exports/<guild-id>/
 *     channels.json              — channel metadata
 *     messages/<channel-id>.json — all messages for that channel
 *     reactions/<channel-id>.json — all reactions for that channel
 *     progress.json              — resume state (safe to re-run)
 *
 * Usage:
 *   node -r dotenv/config scripts/exportToJson.js
 *   npm run export
 *
 * Environment:
 *   DISCORD_TOKEN     — bot token
 *   DISCORD_GUILD_ID  — guild to export
 *   EXPORT_DIR        — output directory (default: ./exports)
 */

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits } = require('discord.js');

// ── Config ──────────────────────────────────────────────────────────────────

const GUILD_ID = process.env.DISCORD_GUILD_ID;
const EXPORT_DIR = process.env.EXPORT_DIR || './exports';
const PAGE_SIZE = 100; // Discord API max
const RATE_LIMIT_BUFFER_MS = 250; // pause between fetches to stay well under limits

if (!process.env.DISCORD_TOKEN || !GUILD_ID) {
  console.error('✗ DISCORD_TOKEN and DISCORD_GUILD_ID are required in .env');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/** Convert a Discord.js Message object to a plain serializable object. */
function serializeMessage(msg) {
  return {
    id: msg.id,
    channelId: msg.channelId,
    guildId: msg.guildId,
    authorId: msg.author.id,
    authorUsername: msg.author.username,
    authorBot: msg.author.bot,
    content: msg.content,
    createdAt: msg.createdAt.toISOString(),
    createdTimestamp: msg.createdTimestamp,
    editedAt: msg.editedAt ? msg.editedAt.toISOString() : null,
    attachments: [...msg.attachments.values()].map(a => ({
      id: a.id,
      name: a.name,
      url: a.url,
      size: a.size,
      contentType: a.contentType,
    })),
    embeds: msg.embeds.map(e => ({
      title: e.title,
      description: e.description,
      url: e.url,
      type: e.data?.type,
    })),
    mentionedUserIds: [...msg.mentions.users.keys()],
    mentionedRoleIds: [...msg.mentions.roles.keys()],
    reactionCounts: [...msg.reactions.cache.values()].map(r => ({
      emoji: r.emoji.toString(),
      emojiName: r.emoji.name,
      emojiId: r.emoji.id,
      count: r.count,
    })),
    type: msg.type,
    pinned: msg.pinned,
  };
}

// ── Progress tracking ───────────────────────────────────────────────────────

class ProgressTracker {
  constructor(guildDir) {
    this.filePath = path.join(guildDir, 'progress.json');
    this.data = readJson(this.filePath) || {
      completedChannels: {},    // channelId → { messageCount, lastMessageId }
      reactionsCompleted: {},   // channelId → true
    };
  }

  isChannelDone(channelId) {
    return !!this.data.completedChannels[channelId];
  }

  markChannelDone(channelId, messageCount, lastMessageId) {
    this.data.completedChannels[channelId] = { messageCount, lastMessageId };
    this.save();
  }

  isReactionsDone(channelId) {
    return !!this.data.reactionsCompleted[channelId];
  }

  markReactionsDone(channelId) {
    this.data.reactionsCompleted[channelId] = true;
    this.save();
  }

  getLastMessageId(channelId) {
    return this.data.completedChannels[channelId]?.lastMessageId || null;
  }

  save() {
    writeJson(this.filePath, this.data);
  }
}

// ── Core export logic ───────────────────────────────────────────────────────

/**
 * Fetch all messages in a channel from oldest to newest.
 * Writes them to a single JSON file as an array.
 */
async function exportChannelMessages(channel, messagesDir, progress) {
  const channelId = channel.id;

  if (progress.isChannelDone(channelId)) {
    const count = progress.data.completedChannels[channelId].messageCount;
    console.log(`  ⏭  #${channel.name} — already exported (${count.toLocaleString()} messages)`);
    return;
  }

  const filePath = path.join(messagesDir, `${channelId}.json`);
  const messages = [];
  let afterId = '0'; // start from the very beginning
  let fetchCount = 0;

  process.stdout.write(`  📥 #${channel.name} — fetching...`);

  while (true) {
    const fetched = await channel.messages.fetch({
      limit: PAGE_SIZE,
      after: afterId,
    });

    if (fetched.size === 0) break;

    // Discord returns newest-first, sort oldest-first
    const sorted = [...fetched.values()].sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp,
    );

    for (const msg of sorted) {
      messages.push(serializeMessage(msg));
    }

    afterId = sorted[sorted.length - 1].id;
    fetchCount++;

    // Progress indicator every 10 pages
    if (fetchCount % 10 === 0) {
      process.stdout.write(`\r  📥 #${channel.name} — ${messages.length.toLocaleString()} messages so far...`);
    }

    await sleep(RATE_LIMIT_BUFFER_MS);
  }

  writeJson(filePath, messages);
  progress.markChannelDone(channelId, messages.length, afterId);
  console.log(`\r  ✓  #${channel.name} — ${messages.length.toLocaleString()} messages exported`);
}

/**
 * Fetch detailed reaction users for all messages in a channel.
 * Reads the messages file to get message IDs with reactions,
 * then fetches user lists from Discord.
 */
async function exportChannelReactions(channel, messagesDir, reactionsDir, progress) {
  const channelId = channel.id;

  if (progress.isReactionsDone(channelId)) {
    console.log(`  ⏭  #${channel.name} reactions — already exported`);
    return;
  }

  const messagesFile = path.join(messagesDir, `${channelId}.json`);
  if (!fs.existsSync(messagesFile)) {
    console.log(`  ⏭  #${channel.name} reactions — no messages file`);
    progress.markReactionsDone(channelId);
    return;
  }

  const messages = readJson(messagesFile);
  const messagesWithReactions = messages.filter(
    m => m.reactionCounts && m.reactionCounts.length > 0,
  );

  if (messagesWithReactions.length === 0) {
    progress.markReactionsDone(channelId);
    console.log(`  ✓  #${channel.name} reactions — no reactions to fetch`);
    return;
  }

  process.stdout.write(`  💬 #${channel.name} reactions — 0/${messagesWithReactions.length} messages...`);

  const reactionDocs = [];
  let processed = 0;

  for (const msg of messagesWithReactions) {
    try {
      const discordMsg = await channel.messages.fetch(msg.id);

      for (const [, reactionObj] of discordMsg.reactions.cache) {
        const users = await reactionObj.users.fetch();
        reactionDocs.push({
          messageId: msg.id,
          channelId: channelId,
          emoji: reactionObj.emoji.toString(),
          emojiName: reactionObj.emoji.name,
          emojiId: reactionObj.emoji.id,
          count: reactionObj.count,
          users: [...users.values()].map(u => ({
            userId: u.id,
            username: u.username,
          })),
        });
        await sleep(RATE_LIMIT_BUFFER_MS);
      }
    } catch (err) {
      // Message may have been deleted since export
      if (err.code === 10008) {
        // Unknown Message — skip silently
      } else {
        console.error(`\n    ⚠  Failed to fetch reactions for ${msg.id}: ${err.message}`);
      }
    }

    processed++;
    if (processed % 10 === 0) {
      process.stdout.write(
        `\r  💬 #${channel.name} reactions — ${processed}/${messagesWithReactions.length} messages...`,
      );
    }

    await sleep(RATE_LIMIT_BUFFER_MS);
  }

  const filePath = path.join(reactionsDir, `${channelId}.json`);
  writeJson(filePath, reactionDocs);
  progress.markReactionsDone(channelId);
  console.log(
    `\r  ✓  #${channel.name} reactions — ${reactionDocs.length.toLocaleString()} reaction entries exported`,
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
  });

  await client.login(process.env.DISCORD_TOKEN);
  console.log(`✓ Logged in as ${client.user.tag}`);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.error('✗ Guild not found. Check DISCORD_GUILD_ID.');
    process.exit(1);
  }
  console.log(`✓ Found guild: ${guild.name} (${guild.id})`);

  // Set up directory structure
  const guildDir = path.join(EXPORT_DIR, guild.id);
  const messagesDir = path.join(guildDir, 'messages');
  const reactionsDir = path.join(guildDir, 'reactions');
  ensureDir(messagesDir);
  ensureDir(reactionsDir);

  const progress = new ProgressTracker(guildDir);

  // Get all text channels
  const channels = guild.channels.cache
    .filter(ch => ch.isTextBased() && !ch.isDMBased())
    .filter(ch => ch.permissionsFor(guild.members.me).has('ViewChannel'))
    .sort((a, b) => a.position - b.position);

  console.log(`\nFound ${channels.size} accessible text channels\n`);

  // Save channel metadata
  const channelMeta = channels.map(ch => ({
    id: ch.id,
    name: ch.name,
    type: ch.type,
    parentName: ch.parent?.name || null,
    position: ch.position,
    topic: ch.topic,
    createdAt: ch.createdAt.toISOString(),
  }));
  writeJson(path.join(guildDir, 'channels.json'), channelMeta);

  // Phase 1: Export messages
  console.log('═══ Phase 1: Messages ═══\n');
  for (const [, channel] of channels) {
    try {
      await exportChannelMessages(channel, messagesDir, progress);
    } catch (err) {
      console.error(`\n  ✗ Error exporting #${channel.name}: ${err.message}`);
    }
  }

  // Phase 2: Export reactions (requires re-fetching messages for user lists)
  console.log('\n═══ Phase 2: Reactions ═══\n');
  for (const [, channel] of channels) {
    try {
      await exportChannelReactions(channel, messagesDir, reactionsDir, progress);
    } catch (err) {
      console.error(`\n  ✗ Error exporting reactions for #${channel.name}: ${err.message}`);
    }
  }

  // Summary
  const totalMessages = Object.values(progress.data.completedChannels)
    .reduce((sum, ch) => sum + ch.messageCount, 0);
  const totalChannels = Object.keys(progress.data.completedChannels).length;

  console.log('\n════════════════════════════════════');
  console.log('📊 Export Complete');
  console.log(`   Channels: ${totalChannels}`);
  console.log(`   Messages: ${totalMessages.toLocaleString()}`);
  console.log(`   Output:   ${path.resolve(guildDir)}`);
  console.log('════════════════════════════════════\n');

  await client.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error('✗ Fatal error:', err);
  process.exit(1);
});
