const mongoose = require('mongoose');

const PenaltySchema = new mongoose.Schema({
  userId: String,
  type: String, // e.g., 'false-sos', 'non-compliant-guide'
  pointsDeducted: Number,
  timestamp: { type: Date, default: Date.now },
  blockchainHash: String, // Simulated Hyperledger hash
});

module.exports = mongoose.model('Penalty', PenaltySchema);