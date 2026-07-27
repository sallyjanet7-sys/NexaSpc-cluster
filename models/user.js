const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, default: '' },
  password: { type: String, required: true },
  walletBalance: { type: Number, default: 0 },
  bonuses: { type: Number, default: 500 },
  deposits: { type: Number, default: 0 },
  profits: { type: Number, default: 0 },
  assets: [{ coin: String, amount: Number }],

  
  // Holdings breakdown per coin
  holdings: [{
    coin: { type: String, required: true }, // e.g. 'BTC', 'ETH', 'USDT'
    amount: { type: Number, default: 0 },   // Amount in crypto unit or USD equivalent
    usdValue: { type: Number, default: 0 }
  }],
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema, 'users');