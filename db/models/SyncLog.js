const mongoose = require('mongoose');

const syncLogSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  lastSyncTime: { type: Date, required: true },
  syncDuration: Number,
  messagesProcessed: { type: Number, default: 0 },
  reactionsProcessed: { type: Number, default: 0 },
  linksExtracted: { type: Number, default: 0 },
}, {
  timestamps: true,
});

module.exports = mongoose.model('SyncLog', syncLogSchema);
