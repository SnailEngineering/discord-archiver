const Link = require('../db/models/Link');

// URL regex pattern - matches http(s) URLs
const URL_REGEX = /https?:\/\/[^\s<>"\]]+/gi;

// Build bulkWrite ops for all links in a message and its edit history.
function buildLinkOps(message, editHistory = []) {
  const ops = [];

  const addOps = (content) => {
    const urls = content.match(URL_REGEX) || [];
    for (const url of urls) {
      try {
        const urlObj = new URL(url);
        ops.push({
          updateOne: {
            filter: { url, messageId: message.id },
            update: {
              $set: {
                url,
                messageId: message.id,
                guildId: message.guildId,
                channelId: message.channelId,
                authorId: message.author.id,
                authorName: message.author.username,
                domain: urlObj.hostname,
                foundAt: message.createdAt,
              },
            },
            upsert: true,
          },
        });
      } catch {
        // invalid URL, skip
      }
    }
  };

  addOps(message.content);
  for (const edit of editHistory) addOps(edit.content);

  return ops;
}

// Execute one bulkWrite for all links across a batch of { message, editHistory } pairs.
async function extractLinksFromBatch(batch) {
  const ops = batch.flatMap(({ message, editHistory }) => buildLinkOps(message, editHistory));
  if (ops.length > 0) await Link.bulkWrite(ops, { ordered: false });
  return ops.length;
}

module.exports = { URL_REGEX, buildLinkOps, extractLinksFromBatch };
