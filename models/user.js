const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  walletBalance: { type: Number, default: 0 },
  assets: [{ coin: String, amount: Number }]
});

// We "export" it so other files can use it
module.exports = mongoose.model('User', userSchema);