const Message = require('../db/models/Message');
const Reaction = require('../db/models/Reaction');
const SyncLog = require('../db/models/SyncLog');
const { extractLinksFromBatch } = require('./linkExtractor');

// Convert a Date to a Discord snowflake string.
// Used to anchor paginated fetches to a specific point in time.
function dateToSnowflake(date) {
  const DISCORD_EPOCH = 1420070400000n;
  return String((BigInt(date.getTime()) - DISCORD_EPOCH) << 22n);
}

/**
 * Resolve the [afterDate, beforeDate] window to archive.
 *
 * BACKFILL_MODE values:
 *   yesterday   — past 24 hours
 *   last_week   — past 7 days
 *   last_month  — past 30 days
 *   last_year   — past 365 days
 *   all         — everything since Discord launched (2015-01-01)
 *   custom      — BACKFILL_START_DATE … BACKFILL_END_DATE (or now)
 *   (unset)     — incremental: use SyncLog, fall back to 7 days ago
 *
 * Returns { afterDate, beforeDate } or null for incremental mode.
 */
function getBackfillDateRange() {
  const mode = (process.env.BACKFILL_MODE || '').trim();
  if (!mode) return null;

  const now = new Date();
  const DAY = 24 * 60 * 60 * 1000;

  const ranges = {
    yesterday:  new Date(now - DAY),
    last_week:  new Date(now - 7   * DAY),
    last_month: new Date(now - 30  * DAY),
    last_year:  new Date(now - 365 * DAY),
    all:        new Date('2015-01-01T00:00:00.000Z'),
  };

  if (mode === 'custom') {
    if (!process.env.BACKFILL_START_DATE) {
      console.error('✗ BACKFILL_MODE=custom requires BACKFILL_START_DATE');
      process.exit(1);
    }
    const afterDate = new Date(process.env.BACKFILL_START_DATE);
    const beforeDate = process.env.BACKFILL_END_DATE
      ? new Date(process.env.BACKFILL_END_DATE)
      : now;
    if (isNaN(afterDate) || isNaN(beforeDate)) {
      console.error('✗ Invalid BACKFILL_START_DATE or BACKFILL_END_DATE (use ISO 8601)');
      process.exit(1);
    }
    return { afterDate, beforeDate };
  }

  if (!ranges[mode]) {
    console.error(`✗ Unknown BACKFILL_MODE "${mode}". Valid: yesterday, last_week, last_month, last_year, all, custom`);
    process.exit(1);
  }

  return { afterDate: ranges[mode], beforeDate: now };
}

async function getSyncStartTime(guildId) {
  const lastSync = await SyncLog.findOne({ guildId });

  if (!lastSync) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return sevenDaysAgo;
  }

  return lastSync.lastSyncTime;
}

// Archive a batch of { message, editHistory } pairs.
// Skips messages that already exist in the DB and inserts only new ones.
// Returns the subset of the batch that was actually inserted.
async function archiveMessages(batch) {
  const ids = batch.map(({ message }) => message.id);
  const existingIds = new Set(
    (await Message.find({ messageId: { $in: ids } }, { messageId: 1 }).lean())
      .map(m => m.messageId)
  );

  const newBatch = batch.filter(({ message }) => !existingIds.has(message.id));
  if (newBatch.length === 0) return newBatch;

  await Message.insertMany(
    newBatch.map(({ message, editHistory }) => ({
      messageId: message.id,
      guildId: message.guildId,
      channelId: message.channelId,
      authorId: message.author.id,
      authorName: message.author.username,
      authorDiscriminator: message.author.discriminator,
      content: message.content,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      editHistory,
      mentionedUserIds: Array.from(message.mentions.users.keys()),
      mentionedRoleIds: Array.from(message.mentions.roles.keys()),
    })),
    { ordered: false }
  );

  return newBatch;
}

async function archiveReactions(message) {
  try {
    for (const [emoji, reactionObj] of message.reactions.cache) {
      const users = await reactionObj.users.fetch();
      const userArray = Array.from(users.values()).map(user => ({
        userId: user.id,
        userName: user.username,
        addedAt: new Date(),
      }));

      await Reaction.findOneAndUpdate(
        { messageId: message.id, emoji: emoji },
        {
          $set: {
            messageId: message.id,
            guildId: message.guildId,
            emoji: emoji,
            emojiName: reactionObj.emoji.name,
            emojiId: reactionObj.emoji.id,
            count: reactionObj.count,
            users: userArray,
          },
        },
        { upsert: true, new: true }
      );
    }
    return true;
  } catch (error) {
    console.error(`Failed to archive reactions for message ${message.id}:`, error.message);
    return false;
  }
}

/**
 * Fetch all messages in a channel between afterDate and beforeDate.
 * Paginates backwards through Discord's API.
 *
 * @param {TextChannel} channel
 * @param {Date}        afterDate  - stop fetching messages older than this
 * @param {Date}        beforeDate - start fetching from this point backwards (default: now)
 */
async function fetchMessageHistory(channel, afterDate, beforeDate = null) {
  const messages = [];
  // If beforeDate is provided and isn't "now", anchor the first page there.
  let lastMessageId = beforeDate ? dateToSnowflake(beforeDate) : null;
  let hasMore = true;

  console.log(
    `  Fetching #${channel.name}` +
    ` after ${afterDate.toLocaleString()}` +
    (beforeDate ? ` before ${beforeDate.toLocaleString()}` : '')
  );

  while (hasMore) {
    try {
      const options = { limit: 100 };
      if (lastMessageId) options.before = lastMessageId;

      const fetchedMessages = await channel.messages.fetch(options);

      if (fetchedMessages.size === 0) {
        hasMore = false;
        break;
      }

      for (const [, message] of fetchedMessages) {
        if (message.createdAt <= afterDate) {
          hasMore = false;
          break;
        }
        messages.push(message);
      }

      if (hasMore && fetchedMessages.size > 0) {
        lastMessageId = fetchedMessages.last().id;
      }
    } catch (error) {
      console.error(`  Error fetching messages from #${channel.name}:`, error.message);
      break;
    }
  }

  return messages.reverse();
}

async function syncGuild(guild, afterDate, beforeDate = null) {
  const startSyncTime = new Date();
  let totalMessagesProcessed = 0;
  let totalReactionsProcessed = 0;
  let totalLinksExtracted = 0;

  try {
    console.log(`Syncing guild: ${guild.name}`);
    console.log(`Window: ${afterDate.toLocaleString()} → ${(beforeDate || new Date()).toLocaleString()}\n`);

    const channels = guild.channels.cache.filter(ch => ch.isTextBased() && !ch.isDMBased());

    if (channels.size === 0) {
      console.log('✗ No text channels found');
      return;
    }

    console.log(`Found ${channels.size} text channels\n`);

    for (const [, channel] of channels) {
      try {
        if (!channel.permissionsFor(guild.members.me).has('ViewChannel')) {
          console.log(`⊘ Skipping #${channel.name} (no access)`);
          continue;
        }

        const channelStart = Date.now();
        const channelMessages = await fetchMessageHistory(channel, afterDate, beforeDate);

        if (channelMessages.length === 0) {
          const elapsed = ((Date.now() - channelStart) / 1000).toFixed(1);
          console.log(`✓ #${channel.name} — no messages in window (${elapsed}s)`);
          continue;
        }

        const batch = channelMessages
          .filter(m => !m.author.bot)
          .map(m => ({
            message: m,
            editHistory: m.editedAt ? [{ content: m.content, editedAt: m.editedAt }] : [],
          }));

        if (batch.length > 0) {
          const newBatch = await archiveMessages(batch);
          totalMessagesProcessed += newBatch.length;
          totalLinksExtracted += await extractLinksFromBatch(newBatch);

          for (const { message } of newBatch) {
            const reactionsArchived = await archiveReactions(message);
            if (reactionsArchived) {
              totalReactionsProcessed += message.reactions.cache.size;
            }
          }
        }

        const elapsed = ((Date.now() - channelStart) / 1000).toFixed(1);
        console.log(`✓ #${channel.name} — processed ${channelMessages.length} messages (${elapsed}s)`);
      } catch (error) {
        console.error(`Error processing channel #${channel.name}:`, error.message);
      }
    }

    // Only update SyncLog for incremental runs (not explicit backfill batches)
    if (!process.env.BACKFILL_MODE) {
      await SyncLog.findOneAndUpdate(
        { guildId: guild.id },
        {
          $set: {
            guildId: guild.id,
            lastSyncTime: startSyncTime,
            syncDuration: Date.now() - startSyncTime.getTime(),
            messagesProcessed: totalMessagesProcessed,
            reactionsProcessed: totalReactionsProcessed,
            linksExtracted: totalLinksExtracted,
          },
        },
        { upsert: true, new: true }
      );
    }

    console.log(`\n📊 Sync Summary:`);
    console.log(`  Messages:  ${totalMessagesProcessed}`);
    console.log(`  Reactions: ${totalReactionsProcessed}`);
    console.log(`  Links:     ${totalLinksExtracted}`);
  } catch (error) {
    console.error('Error during guild sync:', error);
    throw error;
  }
}

async function printDatabaseTotals() {
  const [messages, reactions, links] = await Promise.all([
    Message.countDocuments(),
    Reaction.countDocuments(),
    require('../db/models/Link').countDocuments(),
  ]);
  console.log('\n📈 Database totals:');
  console.log(`  Messages:  ${messages.toLocaleString()}`);
  console.log(`  Reactions: ${reactions.toLocaleString()}`);
  console.log(`  Links:     ${links.toLocaleString()}`);
}

module.exports = {
  syncGuild,
  archiveMessages,
  archiveReactions,
  fetchMessageHistory,
  getSyncStartTime,
  getBackfillDateRange,
  printDatabaseTotals,
};
