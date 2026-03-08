const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/discord-archiver';

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✓ Connected to MongoDB');
    return mongoose.connection;
  } catch (error) {
    console.error('✗ Failed to connect to MongoDB:', error.message);
    process.exit(1);
  }
}

async function disconnectDB() {
  try {
    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  } catch (error) {
    console.error('✗ Failed to disconnect from MongoDB:', error.message);
  }
}

module.exports = {
  connectDB,
  disconnectDB,
};
