const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
  url: { type: String, required: true, index: true },
  messageId: { type: String, required: true },
  guildId: { type: String, required: true, index: true },
  channelId: { type: String, required: true },
  authorId: { type: String, required: true },
  authorName: String,
  domain: String,
  foundAt: { type: Date, required: true },
}, {
  timestamps: true,
});

linkSchema.index({ guildId: 1, foundAt: -1 });
linkSchema.index({ domain: 1 });
linkSchema.index({ authorId: 1 });

module.exports = mongoose.model('Link', linkSchema);
