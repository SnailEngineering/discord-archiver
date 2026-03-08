const Message = require('../db/models/Message');
const Reaction = require('../db/models/Reaction');
const Link = require('../db/models/Link');

async function getWeeklyReport(guildId, endDate = new Date()) {
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);

  const report = {
    period: {
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0],
    },
    generatedAt: new Date(),
    stats: {},
  };

  try {
    // Total messages
    const totalMessages = await Message.countDocuments({
      guildId,
      createdAt: { $gte: startDate, $lte: endDate },
    });
    report.stats.totalMessages = totalMessages;

    // Top message posters
    const topPosters = await Message.aggregate([
      {
        $match: {
          guildId,
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: { userId: '$authorId', userName: '$authorName' },
          messageCount: { $sum: 1 },
        },
      },
      { $sort: { messageCount: -1 } },
      { $limit: 10 },
    ]);
    report.stats.topPosters = topPosters.map(p => ({
      userId: p._id.userId,
      userName: p._id.userName,
      messages: p.messageCount,
    }));

    // Messages with edits
    const editedMessages = await Message.countDocuments({
      guildId,
      createdAt: { $gte: startDate, $lte: endDate },
      editHistory: { $exists: true, $ne: [] },
    });
    report.stats.editedMessages = editedMessages;

    // Top editors
    const topEditors = await Message.aggregate([
      {
        $match: {
          guildId,
          createdAt: { $gte: startDate, $lte: endDate },
          editHistory: { $exists: true, $ne: [] },
        },
      },
      {
        $group: {
          _id: { userId: '$authorId', userName: '$authorName' },
          editCount: { $sum: { $size: '$editHistory' } },
        },
      },
      { $sort: { editCount: -1 } },
      { $limit: 10 },
    ]);
    report.stats.topEditors = topEditors.map(e => ({
      userId: e._id.userId,
      userName: e._id.userName,
      edits: e.editCount,
    }));

    // Most used reactions
    const topReactions = await Reaction.aggregate([
      {
        $match: {
          guildId,
          updatedAt: { $gte: startDate, $lte: endDate },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 15 },
      {
        $project: {
          emoji: 1,
          emojiName: 1,
          count: 1,
        },
      },
    ]);
    report.stats.topReactions = topReactions;

    // Most active channels
    const activeChannels = await Message.aggregate([
      {
        $match: {
          guildId,
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: '$channelId',
          messageCount: { $sum: 1 },
        },
      },
      { $sort: { messageCount: -1 } },
      { $limit: 10 },
    ]);
    report.stats.activeChannels = activeChannels.map(ch => ({
      channelId: ch._id,
      messages: ch.messageCount,
    }));

    // Top shared domains
    const topDomains = await Link.aggregate([
      {
        $match: {
          guildId,
          foundAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: '$domain',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 15 },
    ]);
    report.stats.topDomains = topDomains.map(d => ({
      domain: d._id,
      links: d.count,
    }));

    // Total links shared
    const totalLinks = await Link.countDocuments({
      guildId,
      foundAt: { $gte: startDate, $lte: endDate },
    });
    report.stats.totalLinks = totalLinks;

    // Top link sharers
    const topLinkSharers = await Link.aggregate([
      {
        $match: {
          guildId,
          foundAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: { userId: '$authorId', userName: '$authorName' },
          linkCount: { $sum: 1 },
        },
      },
      { $sort: { linkCount: -1 } },
      { $limit: 10 },
    ]);
    report.stats.topLinkSharers = topLinkSharers.map(s => ({
      userId: s._id.userId,
      userName: s._id.userName,
      links: s.linkCount,
    }));

    return report;
  } catch (error) {
    console.error('Error generating report:', error);
    throw error;
  }
}

function formatReport(report) {
  let formatted = `\n📊 Weekly Report - ${report.period.start} to ${report.period.end}\n`;
  formatted += `Generated: ${report.generatedAt.toLocaleString()}\n`;
  formatted += '─'.repeat(60) + '\n\n';

  const stats = report.stats;

  // Total messages
  formatted += `📝 Total Messages: ${stats.totalMessages}\n`;
  formatted += `📝 Edited Messages: ${stats.editedMessages}\n`;
  formatted += `🔗 Total Links Shared: ${stats.totalLinks}\n\n`;

  // Top Posters
  formatted += '🎤 Top Message Posters:\n';
  stats.topPosters.slice(0, 5).forEach((poster, i) => {
    formatted += `  ${i + 1}. ${poster.userName} - ${poster.messages} messages\n`;
  });
  formatted += '\n';

  // Top Editors
  if (stats.topEditors.length > 0) {
    formatted += '✏️ Top Editors:\n';
    stats.topEditors.slice(0, 5).forEach((editor, i) => {
      formatted += `  ${i + 1}. ${editor.userName} - ${editor.edits} edits\n`;
    });
    formatted += '\n';
  }

  // Top Reactions
  formatted += '😂 Top Reactions:\n';
  stats.topReactions.slice(0, 5).forEach((reaction, i) => {
    formatted += `  ${i + 1}. ${reaction.emoji} (${reaction.emojiName}) - ${reaction.count} uses\n`;
  });
  formatted += '\n';

  // Most Active Channels
  formatted += '💬 Most Active Channels:\n';
  stats.activeChannels.slice(0, 5).forEach((channel, i) => {
    formatted += `  ${i + 1}. <#${channel.channelId}> - ${channel.messages} messages\n`;
  });
  formatted += '\n';

  // Top Link Sharers
  if (stats.topLinkSharers.length > 0) {
    formatted += '🔗 Top Link Sharers:\n';
    stats.topLinkSharers.slice(0, 5).forEach((sharer, i) => {
      formatted += `  ${i + 1}. ${sharer.userName} - ${sharer.links} links\n`;
    });
    formatted += '\n';
  }

  // Top Domains
  if (stats.topDomains.length > 0) {
    formatted += '🌐 Most Shared Domains:\n';
    stats.topDomains.slice(0, 5).forEach((domain, i) => {
      formatted += `  ${i + 1}. ${domain.domain} - ${domain.links} links\n`;
    });
    formatted += '\n';
  }

  formatted += '─'.repeat(60) + '\n';

  return formatted;
}

module.exports = {
  getWeeklyReport,
  formatReport,
};
