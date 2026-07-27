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
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema, 'users');