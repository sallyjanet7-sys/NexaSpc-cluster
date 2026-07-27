const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userEmail: { type: String, required: true },
  type: { type: String, enum: ['deposit', 'withdrawal', 'bonus', 'trade'], required: true },
  coin: { type: String, required: true },
  amount: { type: Number, required: true },
  txHash: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema);