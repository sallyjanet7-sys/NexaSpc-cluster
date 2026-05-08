require('dotenv').config();

const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const dotenv = require('dotenv');
dotenv.config();


const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET;

const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Instead of writing the whole schema here, you just "require" it
const user = require('../models/user'); 
// Now you can use "User" in your routes as normal

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// In-memory data store (replace with a real DB in production)
const users = {};
const transactions = {};

// Wallet addresses for deposits
const walletAddresses = {
  BTC: '1NdiB8cYvfeXxTCse6UVfR7uMo4MUvKNxB',
  ETH: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  USDT: 'TQn9Y2khDD9SKgGpuJqS4mVkRYHF8e9tPZ',
  XRP: 'rN7n3473SaZBCG4dFL83w7PB5bNNnSfPQ',
  SOL: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB56sC24'
};

// Middleware to verify JWT token
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Register
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields required' });
  if (users[email])
    return res.status(400).json({ error: 'User already exists' });

  const hashed = await bcrypt.hash(password, 10);
  users[email] = {
    username,
    email,
    password: hashed,
    balance: 0,
    deposits: 0,
    profits: 0,
    bonuses: 500, // welcome bonus
    createdAt: new Date().toISOString()
  };
  transactions[email] = [];

  const token = jwt.sign({ email, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { username, email, balance: 0, deposits: 0, profits: 0, bonuses: 500 } });
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = users[email];
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ email, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      username: user.username,
      email,
      balance: user.balance,
      deposits: user.deposits,
      profits: user.profits,
      bonuses: user.bonuses
    }
  });
});

// Get user profile
app.get('/api/profile', authMiddleware, (req, res) => {
  const user = users[req.user.email];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    username: user.username,
    email: user.email,
    balance: user.balance,
    deposits: user.deposits,
    profits: user.profits,
    bonuses: user.bonuses
  });
});

// Get wallet addresses
app.get('/api/wallets', authMiddleware, (req, res) => {
  res.json(walletAddresses);
});

// Simulate deposit (admin would verify blockchain in production)
app.post('/api/deposit', authMiddleware, (req, res) => {
  const { coin, amount, txHash } = req.body;
  if (!coin || !amount || amount <= 0)
    return res.status(400).json({ error: 'Invalid deposit data' });

  const user = users[req.user.email];
  const depositAmount = parseFloat(amount);

  user.deposits += depositAmount;
  user.balance += depositAmount;
  // Simulate 5% profit on deposit
  user.profits += depositAmount * 0.05;
  user.balance += depositAmount * 0.05;

  const tx = {
    id: Date.now(),
    type: 'deposit',
    coin,
    amount: depositAmount,
    txHash: txHash || 'pending',
    status: 'completed',
    date: new Date().toISOString()
  };
  transactions[req.user.email].push(tx);

  res.json({
    success: true,
    transaction: tx,
    balance: user.balance,
    deposits: user.deposits,
    profits: user.profits
  });
});

// Withdrawal request
app.post('/api/withdraw', authMiddleware, (req, res) => {
  const { coin, amount, walletAddress, source } = req.body;
  const user = users[req.user.email];

  if (!coin || !amount || !walletAddress)
    return res.status(400).json({ error: 'All fields required' });

  const withdrawAmount = parseFloat(amount);
  const available = source === 'profits' ? user.profits : user.balance;

  if (withdrawAmount > available)
    return res.status(400).json({ error: 'Insufficient funds' });

  if (source === 'profits') {
    user.profits -= withdrawAmount;
  } else {
    user.balance -= withdrawAmount;
  }

  const tx = {
    id: Date.now(),
    type: 'withdrawal',
    coin,
    amount: withdrawAmount,
    walletAddress,
    source,
    status: 'pending',
    date: new Date().toISOString()
  };
  transactions[req.user.email].push(tx);

  res.json({ success: true, transaction: tx, balance: user.balance, profits: user.profits });
});

// Get transaction history
app.get('/api/transactions', authMiddleware, (req, res) => {
  const txs = transactions[req.user.email] || [];
  res.json(txs.reverse());
});

// Market data (mock)
app.get('/api/markets', (req, res) => {
  res.json([
    { symbol: 'BTC/USDT', price: 67842.50, change: 2.34, volume: '24.5B' },
    { symbol: 'ETH/USDT', price: 3521.20, change: 1.87, volume: '12.1B' },
    { symbol: 'SOL/USDT', price: 185.40, change: -0.92, volume: '3.2B' },
    { symbol: 'XRP/USDT', price: 0.6234, change: 3.15, volume: '2.8B' },
    { symbol: 'BNB/USDT', price: 412.80, change: 0.54, volume: '1.9B' },
    { symbol: 'ADA/USDT', price: 0.4821, change: -1.23, volume: '890M' },
    { symbol: 'DOGE/USDT', price: 0.1543, change: 5.62, volume: '1.1B' },
    { symbol: 'AVAX/USDT', price: 38.92, change: -2.11, volume: '654M' }
  ]);
});

// Serve all pages
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, '../public/index.html'));
// });

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`NexaSpc server running on http://localhost:${PORT}`);
});
