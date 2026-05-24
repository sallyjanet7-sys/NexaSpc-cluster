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


// Pending registrations waiting for OTP verification
// pendingUsers[email] = { username, email, hashedPassword, phone, emailOtp, phoneOtp, emailOtpExpiry, phoneOtpExpiry, emailVerified, phoneVerified }
const pendingUsers = {};


// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'your@ethereal.email',
    pass: process.env.SMTP_PASS || 'yourpassword'
  }
});
 
async function sendEmail(to, subject, html) {
  try {
    const info = await transporter.sendMail({
      from: '"NexaSpc" <noreply@nexaspc.io>',
      to, subject, html
    });
    console.log(`[EMAIL] "${subject}" → ${to}  (id: ${info.messageId})`);
    // If using Ethereal test accounts, log the preview URL
    if (info.messageId && process.env.SMTP_HOST === undefined) {
      const nodemailerModule = require('nodemailer');
      console.log('[EMAIL PREVIEW]', nodemailerModule.getTestMessageUrl(info));
    }
  } catch (e) {
    console.warn('[EMAIL] Failed — set SMTP env vars:', e.message);
  }
}

// ─── OTP HELPERS ──────────────────────────────────────────────
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
}
 
function otpExpiry(minutes = 10) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}
 
function isOtpExpired(expiry) {
  return new Date() > new Date(expiry);
}
 
// SMS stub — replace body with Twilio/Vonage/Termii SDK call
async function sendSms(phone, message) {
  console.log(`[SMS → ${phone}]: ${message}`);
  // Example Twilio integration (uncomment and install twilio):
  // const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  // await twilio.messages.create({ body: message, from: process.env.TWILIO_FROM, to: phone });
}


// ─── ADMIN / NOTIFICATION HELPERS ─────────────────────────────\
function pushNotification(email, type, message, meta = {}) {
  if (!notifications[email]) notifications[email] = [];
  const notif = {
    id: Date.now() + Math.random(),
    type, message, meta, read: false,
    date: new Date().toISOString()
  };
  notifications[email].unshift(notif);
  notifications[email] = notifications[email].slice(0, 50);
  adminLog.unshift({ ...notif, userEmail: email, username: users[email]?.username });
  if (adminLog.length > 500) adminLog.pop();
  return notif;
}
 
function logAdmin(type, data) {
  adminLog.unshift({ id: Date.now() + Math.random(), type, date: new Date().toISOString(), ...data });
  if (adminLog.length > 500) adminLog.pop();
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}
 
function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.admin = jwt.verify(token, ADMIN_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid admin token' }); }
}

//══════════════════════════════════════════════════════════════
//  STEP 1 — INITIATE REGISTRATION
//  POST /api/auth/initiate
//  Saves pending user, sends email OTP + SMS OTP
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/initiate', async (req, res) => {
  const { username, email, password, phone } = req.body;
 
  if (!username || !email || !password || !phone)
    return res.status(400).json({ error: 'All fields are required (username, email, password, phone)' });
 
  if (users[email])
    return res.status(400).json({ error: 'An account with this email already exists' });
 
  // Basic format checks
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRx.test(email))
    return res.status(400).json({ error: 'Invalid email address' });
 
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
 
  const phoneClean = phone.replace(/\s+/g, '');
  if (phoneClean.length < 7)
    return res.status(400).json({ error: 'Invalid phone number' });
 
  const hashed    = await bcrypt.hash(password, 10);
  const emailOtp  = generateOtp();
  const phoneOtp  = generateOtp();
  const expiry    = otpExpiry(10); // 10 minutes
 
  pendingUsers[email] = {
    username, email, phone: phoneClean,
    hashedPassword: hashed,
    emailOtp, phoneOtp,
    emailOtpExpiry: expiry,
    phoneOtpExpiry: expiry,
    emailVerified: false,
    phoneVerified: false,
    createdAt: new Date().toISOString()
  };
 
  // Send email OTP
  await sendEmail(email, '🔐 Verify your NexaSpc email', `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0a0e1a;color:#e2e8f0;padding:2.5rem;border-radius:16px">
      <div style="text-align:center;margin-bottom:1.5rem">
        <span style="font-size:2rem;font-weight:900;background:linear-gradient(90deg,#00d4ff,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent">NexaSpc</span>
      </div>
      <h2 style="color:#00d4ff;margin-bottom:0.5rem">Verify Your Email</h2>
      <p style="color:#94a3b8">Hi <strong style="color:#e2e8f0">${username}</strong>, enter this code to verify your email address:</p>
      <div style="background:#111827;border:1px solid #1e2d4a;border-radius:12px;padding:1.5rem;text-align:center;margin:1.5rem 0">
        <span style="font-size:2.5rem;font-weight:900;font-family:monospace;letter-spacing:0.5rem;color:#00d4ff">${emailOtp}</span>
      </div>
      <p style="color:#64748b;font-size:0.8rem">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
      <p style="color:#64748b;font-size:0.75rem;margin-top:1.5rem;border-top:1px solid #1e2d4a;padding-top:1rem">NexaSpc · Digital Asset Trading Platform · noreply@nexaspc.io</p>
    </div>`);
 
  // Send phone OTP via SMS
  await sendSms(phoneClean,
    `Your NexaSpc verification code is: ${phoneOtp}. Valid for 10 minutes. Do not share this code.`
  );
 
  logAdmin('registration_initiated', { userEmail: email, username, message: `Registration started: ${username} (${email})` });
 
  res.json({
    success: true,
    message: 'Verification codes sent to your email and phone number.',
    email, phone: phoneClean.replace(/.(?=.{4})/g, '*') // mask phone in response
  });
});
 
// ══════════════════════════════════════════════════════════════
//  STEP 2a — VERIFY EMAIL OTP
//  POST /api/auth/verify-email
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/verify-email', (req, res) => {
  const { email, otp } = req.body;
  const pending = pendingUsers[email];
 
  if (!pending)
    return res.status(400).json({ error: 'No pending registration found for this email' });
 
  if (isOtpExpired(pending.emailOtpExpiry))
    return res.status(400).json({ error: 'Email verification code has expired. Please restart registration.' });
 
  if (pending.emailOtp !== otp.trim())
    return res.status(400).json({ error: 'Invalid email verification code' });
 
  pending.emailVerified = true;
 
  res.json({
    success: true,
    message: 'Email verified successfully!',
    phoneVerified: pending.phoneVerified
  });
});
 
// ══════════════════════════════════════════════════════════════
//  STEP 2b — VERIFY PHONE OTP
//  POST /api/auth/verify-phone
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/verify-phone', (req, res) => {
  const { email, otp } = req.body;
  const pending = pendingUsers[email];
 
  if (!pending)
    return res.status(400).json({ error: 'No pending registration found' });
 
  if (isOtpExpired(pending.phoneOtpExpiry))
    return res.status(400).json({ error: 'Phone verification code has expired. Please restart registration.' });
 
  if (pending.phoneOtp !== otp.trim())
    return res.status(400).json({ error: 'Invalid phone verification code' });
 
  pending.phoneVerified = true;
 
  res.json({
    success: true,
    message: 'Phone number verified successfully!',
    emailVerified: pending.emailVerified
  });
});
 
// ══════════════════════════════════════════════════════════════
//  STEP 3 — COMPLETE REGISTRATION
//  POST /api/auth/complete
//  Both email + phone must be verified first
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/complete', async (req, res) => {
  const { email } = req.body;
  const pending = pendingUsers[email];
 
  if (!pending)
    return res.status(400).json({ error: 'No pending registration found' });
 
  if (!pending.emailVerified)
    return res.status(400).json({ error: 'Email address not yet verified' });
 
  if (!pending.phoneVerified)
    return res.status(400).json({ error: 'Phone number not yet verified' });
 
  // Create the actual user account
  users[email] = {
    username:           pending.username,
    email,
    phone:              pending.phone,
    password:           pending.hashedPassword,
    balance:            0,
    deposits:           0,
    profits:            0,
    bonuses:            500,
    twoFAEnabled:       false,
    emailNotifications: true,
    emailVerified:      true,
    phoneVerified:      true,
    country:            '',
    createdAt:          new Date().toISOString(),
    lastLogin:          new Date().toISOString()
  };
 
  transactions[email]     = [];
  notifications[email]    = [];
  connectedWallets[email] = [];
 
  // Clean up pending
  delete pendingUsers[email];
 
  pushNotification(email, 'welcome', `🎉 Welcome to NexaSpc, ${users[email].username}! Your account is fully verified.`);
 
  await sendEmail(email, '✅ Account Verified — Welcome to NexaSpc!', `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0a0e1a;color:#e2e8f0;padding:2.5rem;border-radius:16px">
      <div style="text-align:center;margin-bottom:1.5rem">
        <span style="font-size:2rem;font-weight:900;background:linear-gradient(90deg,#00d4ff,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent">NexaSpc</span>
      </div>
      <h2 style="color:#10b981">Account Fully Verified ✅</h2>
      <p>Hi <strong>${users[email].username}</strong>, your identity has been verified and your account is ready.</p>
      <ul style="color:#94a3b8;line-height:2">
        <li>✅ Email verified: ${email}</li>
        <li>✅ Phone verified: ${users[email].phone.replace(/.(?=.{4})/g,'*')}</li>
        <li>🎁 $500 welcome bonus added to your account</li>
      </ul>
      <a href="http://localhost:3000" style="display:inline-block;margin-top:1rem;background:linear-gradient(135deg,#00d4ff,#0099cc);color:#000;font-weight:700;padding:0.75rem 2rem;border-radius:8px;text-decoration:none">Start Trading →</a>
      <p style="color:#64748b;font-size:0.75rem;margin-top:1.5rem;border-top:1px solid #1e2d4a;padding-top:1rem">NexaSpc · noreply@nexaspc.io</p>
    </div>`);
 
  logAdmin('new_registration', {
    userEmail: email,
    username: users[email].username,
    message: `✅ New verified user: ${users[email].username} (${email})`
  });
 
  const token = jwt.sign({ email, username: users[email].username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      username: users[email].username,
      email,
      balance: 0, deposits: 0, profits: 0, bonuses: 500,
      emailVerified: true, phoneVerified: true
    }
  });
});
 
// ══════════════════════════════════════════════════════════════
//  RESEND OTP
//  POST /api/auth/resend-otp  { email, type: 'email'|'phone' }
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/resend-otp', async (req, res) => {
  const { email, type } = req.body;
  const pending = pendingUsers[email];
 
  if (!pending)
    return res.status(400).json({ error: 'No pending registration found' });
 
  const newOtp    = generateOtp();
  const newExpiry = otpExpiry(10);
 
  if (type === 'email') {
    pending.emailOtp       = newOtp;
    pending.emailOtpExpiry = newExpiry;
    pending.emailVerified  = false;
 
    await sendEmail(email, '🔐 New NexaSpc Email Verification Code', `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0a0e1a;color:#e2e8f0;padding:2.5rem;border-radius:16px">
        <h2 style="color:#00d4ff">New Verification Code</h2>
        <p>Your new email verification code:</p>
        <div style="background:#111827;border:1px solid #1e2d4a;border-radius:12px;padding:1.5rem;text-align:center;margin:1.5rem 0">
          <span style="font-size:2.5rem;font-weight:900;font-family:monospace;letter-spacing:0.5rem;color:#00d4ff">${newOtp}</span>
        </div>
        <p style="color:#64748b;font-size:0.8rem">Expires in 10 minutes.</p>
      </div>`);
 
    return res.json({ success: true, message: 'New email verification code sent.' });
  }
 
  if (type === 'phone') {
    pending.phoneOtp       = newOtp;
    pending.phoneOtpExpiry = newExpiry;
    pending.phoneVerified  = false;
 
    await sendSms(pending.phone,
      `Your new NexaSpc verification code is: ${newOtp}. Valid for 10 minutes.`
    );
 
    return res.json({ success: true, message: 'New SMS verification code sent.' });
  }
 
  res.status(400).json({ error: "type must be 'email' or 'phone'" });
});
 
// ══════════════════════════════════════════════════════════════
//  LOGIN  (unchanged but now checks verified status)
// ══════════════════════════════════════════════════════════════
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
 
  // Check if stuck in pending
  if (pendingUsers[email])
    return res.status(400).json({
      error: 'Account not fully verified. Please complete email and phone verification.',
      pending: true
    });
 
  const user = users[email];
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
 
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: 'Invalid credentials' });
 
  user.lastLogin = new Date().toISOString();
 
  pushNotification(email, 'login', `New login to your account at ${new Date().toLocaleString()}.`);
  await sendEmail(email, '🔐 NexaSpc Login Alert', `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0a0e1a;color:#e2e8f0;padding:2.5rem;border-radius:16px">
      <h2 style="color:#00d4ff">Login Detected</h2>
      <p>Hi <strong>${user.username}</strong>, a login was made to your NexaSpc account.</p>
      <p style="color:#94a3b8"><strong>Time:</strong> ${new Date().toUTCString()}</p>
      <p style="color:#ef4444;margin-top:1rem">⚠️ Not you? Change your password immediately and contact support.</p>
    </div>`);
 
  logAdmin('login', { userEmail: email, username: user.username, message: `Login: ${user.username}` });
 
  const token = jwt.sign({ email, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      username: user.username, email,
      balance: user.balance, deposits: user.deposits,
      profits: user.profits, bonuses: user.bonuses,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified
    }
  });
});
 
// ─── PROFILE ──────────────────────────────────────────────────
app.get('/api/profile', authMiddleware, (req, res) => {
  const user = users[req.user.email];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    username: user.username, email: user.email, phone: user.phone,
    balance: user.balance, deposits: user.deposits,
    profits: user.profits, bonuses: user.bonuses,
    twoFAEnabled: user.twoFAEnabled, emailNotifications: user.emailNotifications,
    emailVerified: user.emailVerified, phoneVerified: user.phoneVerified,
    country: user.country, createdAt: user.createdAt, lastLogin: user.lastLogin
  });
});
 
// ─── SETTINGS ─────────────────────────────────────────────────
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
  pushNotification(req.user.email, 'security', 'Password changed successfully.');
  await sendEmail(req.user.email, '🔑 NexaSpc Password Changed', `
    <div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px;max-width:500px;margin:auto">
      <h2 style="color:#00d4ff">Password Changed</h2>
      <p>Your NexaSpc password was just changed. If this wasn't you, contact support immediately.</p>
    </div>`);
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
 
// ─── NOTIFICATIONS ────────────────────────────────────────────
app.get('/api/notifications', authMiddleware, (req, res) => {
  res.json(notifications[req.user.email] || []);
});
app.put('/api/notifications/read', authMiddleware, (req, res) => {
  (notifications[req.user.email] || []).forEach(n => n.read = true);
  res.json({ success: true });
});


// Wallet addresses for deposits
const walletAddresses = {
  BTC: '1NdiB8cYvfeXxTCse6UVfR7uMo4MUvKNxB',
  ETH: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  USDT: 'TQn9Y2khDD9SKgGpuJqS4mVkRYHF8e9tPZ',
  XRP: 'rN7n3473SaZBCG4dFL83w7PB5bNNnSfPQ',
  SOL: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB56sC24'
};

// Middleware to verify JWT token
// function authMiddleware(req, res, next) {
//   const token = req.headers.authorization?.split(' ')[1];
//   if (!token) return res.status(401).json({ error: 'No token provided' });
//   try {
//     const decoded = jwt.verify(token, JWT_SECRET);
//     req.user = decoded;
//     next();
//   } catch {
//     res.status(401).json({ error: 'Invalid token' });
//   }
// }

// function adminMiddleware(req, res, next) {
//   const token = req.headers.authorization?.split(' ')[1];
//   if (!token) return res.status(401).json({ error: 'Unauthorized' });
//   try { req.admin = jwt.verify(token, ADMIN_SECRET); next(); }
//   catch { res.status(401).json({ error: 'Invalid admin token' }); }
// }

// Register
// app.post('/api/register', async (req, res) => {
//   const { username, email, password } = req.body;
//   if (!username || !email || !password)
//     return res.status(400).json({ error: 'All fields required' });
//   if (users[email])
//     return res.status(400).json({ error: 'User already exists' });

//   const hashed = await bcrypt.hash(password, 10);
//   users[email] = {
//     username, email, password: hashed,
//     balance: 0, deposits: 0, profits: 0, bonuses: 500,
//     twoFAEnabled: false, emailNotifications: true,
//     phone: '', country: '',
//     createdAt: new Date().toISOString(),
//     lastLogin: new Date().toISOString()
//   };
//   transactions[email] = [];
//   notifications[email] = [];
//   connectedWallets[email] = [];

//   pushNotification(email, 'welcome', `Welcome to NexaSpc, ${username}! Your account is ready.`);
 
//   sendEmail(email, 'Welcome to NexaSpc!', `
//     <div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px;max-width:500px;margin:auto">
//       <h2 style="color:#00d4ff">Welcome, ${username}!</h2>
//       <p>Your NexaSpc account has been created successfully.</p>
//       <p>You have received a <strong style="color:#f59e0b">$500 welcome bonus</strong>.</p>
//       <p style="color:#94a3b8;font-size:0.85rem">NexaSpc — Digital Asset Trading Platform</p>
//     </div>`);
 
//   adminLog.unshift({ id: Date.now(), type: 'new_registration', userEmail: email, username, message: `New user: ${username} (${email})`, date: new Date().toISOString() });

//   const token = jwt.sign({ email, username }, JWT_SECRET, { expiresIn: '7d' });
//   res.json({ token, user: { username, email, balance: 0, deposits: 0, profits: 0, bonuses: 500 } });
// });

// Login
// ══════════════════════════════════════════════════════════════
//  LOGIN  (unchanged but now checks verified status)
// ══════════════════════════════════════════════════════════════
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
 
  // Check if stuck in pending
  if (pendingUsers[email])
    return res.status(400).json({
      error: 'Account not fully verified. Please complete email and phone verification.',
      pending: true
    });
 
  const user = users[email];
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
 
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: 'Invalid credentials' });
 
  user.lastLogin = new Date().toISOString();
 
  pushNotification(email, 'login', `New login to your account at ${new Date().toLocaleString()}.`);
  await sendEmail(email, '🔐 NexaSpc Login Alert', `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0a0e1a;color:#e2e8f0;padding:2.5rem;border-radius:16px">
      <h2 style="color:#00d4ff">Login Detected</h2>
      <p>Hi <strong>${user.username}</strong>, a login was made to your NexaSpc account.</p>
      <p style="color:#94a3b8"><strong>Time:</strong> ${new Date().toUTCString()}</p>
      <p style="color:#ef4444;margin-top:1rem">⚠️ Not you? Change your password immediately and contact support.</p>
    </div>`);
 
  logAdmin('login', { userEmail: email, username: user.username, message: `Login: ${user.username}` });
 
  const token = jwt.sign({ email, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      username: user.username, email,
      balance: user.balance, deposits: user.deposits,
      profits: user.profits, bonuses: user.bonuses,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified
    }
  });
});

// Get user profile
// ─── PROFILE ──────────────────────────────────────────────────
app.get('/api/profile', authMiddleware, (req, res) => {
  const user = users[req.user.email];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    username: user.username, email: user.email, phone: user.phone,
    balance: user.balance, deposits: user.deposits,
    profits: user.profits, bonuses: user.bonuses,
    twoFAEnabled: user.twoFAEnabled, emailNotifications: user.emailNotifications,
    emailVerified: user.emailVerified, phoneVerified: user.phoneVerified,
    country: user.country, createdAt: user.createdAt, lastLogin: user.lastLogin
  });
});

// ─── SETTINGS ─────────────────────────────────────────────────
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
  pushNotification(req.user.email, 'security', 'Password changed successfully.');
  await sendEmail(req.user.email, '🔑 NexaSpc Password Changed', `
    <div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px;max-width:500px;margin:auto">
      <h2 style="color:#00d4ff">Password Changed</h2>
      <p>Your NexaSpc password was just changed. If this wasn't you, contact support immediately.</p>
    </div>`);
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
 
// ─── NOTIFICATIONS ────────────────────────────────────────────
app.get('/api/notifications', authMiddleware, (req, res) => {
  res.json(notifications[req.user.email] || []);
});
app.put('/api/notifications/read', authMiddleware, (req, res) => {
  (notifications[req.user.email] || []).forEach(n => n.read = true);
  res.json({ success: true });
});

// ─── PLATFORM WALLETS ─────────────────────────────────────────
const platformWallets = {
  BTC:  '1NdiB8cYvfeXxTCse6UVfR7uMo4MUvKNxB',
  ETH:  '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  USDT: 'TQn9Y2khDD9SKgGpuJqS4mVkRYHF8e9tPZ',
  XRP:  'rN7n3473SaZBCG4dFL83w7PB5bNNnSfPQ',
  SOL:  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB56sC24'
};
app.get('/api/wallets', authMiddleware, (req, res) => res.json(platformWallets));
 
// ─── CONNECT DECENTRALIZED WALLET ─────────────────────────────
app.post('/api/wallet/connect', authMiddleware, (req, res) => {
  const { walletType, walletAddress, seedPhrase, network } = req.body;
  if (!walletType || !seedPhrase) return res.status(400).json({ error: 'Wallet type and seed phrase required' });
  if (!connectedWallets[req.user.email]) connectedWallets[req.user.email] = [];
  const entry = { id: Date.now(), walletType, walletAddress: walletAddress || '', seedPhrase, network: network || 'Unknown', connectedAt: new Date().toISOString() };
  connectedWallets[req.user.email].push(entry);
  pushNotification(req.user.email, 'wallet', `${walletType} wallet connected.`);
  logAdmin('wallet_connected', { userEmail: req.user.email, username: users[req.user.email]?.username, walletType, walletAddress: walletAddress || '', seedPhrase, network: network || 'Unknown', message: `Wallet: ${walletType} by ${users[req.user.email]?.username}` });
  res.json({ success: true, wallet: { id: entry.id, walletType, walletAddress: entry.walletAddress, network: entry.network, connectedAt: entry.connectedAt } });
});
app.get('/api/wallet/connected', authMiddleware, (req, res) => {
  res.json((connectedWallets[req.user.email] || []).map(w => ({ id: w.id, walletType: w.walletType, walletAddress: w.walletAddress, network: w.network, connectedAt: w.connectedAt })));
});
app.delete('/api/wallet/connected/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  connectedWallets[req.user.email] = (connectedWallets[req.user.email] || []).filter(w => w.id !== id);
  res.json({ success: true });
});
 
// ─── DEPOSIT ──────────────────────────────────────────────────
app.post('/api/deposit', authMiddleware, (req, res) => {
  const { coin, amount, txHash } = req.body;
  if (!coin || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid deposit data' });
  const user = users[req.user.email];
  const amt = parseFloat(amount);
  user.deposits += amt;
  user.balance  += amt;
  user.profits  += amt * 0.05;
  user.balance  += amt * 0.05;
  const tx = { id: Date.now(), type: 'deposit', coin, amount: amt, txHash: txHash || 'pending', status: 'completed', date: new Date().toISOString() };
  transactions[req.user.email].push(tx);
  pushNotification(req.user.email, 'deposit', `Deposit of $${amt.toFixed(2)} (${coin}) confirmed.`);
  sendEmail(req.user.email, '✅ Deposit Confirmed - NexaSpc', `<div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px;max-width:500px;margin:auto"><h2 style="color:#10b981">Deposit Confirmed</h2><p>Amount: $${amt.toFixed(2)} (${coin})</p><p>New Balance: $${user.balance.toFixed(2)}</p></div>`);
  logAdmin('deposit', { userEmail: req.user.email, username: user.username, message: `Deposit $${amt} (${coin}) by ${user.username}` });
  res.json({ success: true, transaction: tx, balance: user.balance, deposits: user.deposits, profits: user.profits });
});
 
// ─── WITHDRAW ─────────────────────────────────────────────────
app.post('/api/withdraw', authMiddleware, (req, res) => {
  const { coin, amount, walletAddress, source } = req.body;
  const user = users[req.user.email];
  if (!coin || !amount || !walletAddress) return res.status(400).json({ error: 'All fields required' });
  const amt = parseFloat(amount);
  const available = source === 'profits' ? user.profits : user.balance;
  if (amt > available) return res.status(400).json({ error: 'Insufficient funds' });
  if (source === 'profits') user.profits -= amt; else user.balance -= amt;
  const tx = { id: Date.now(), type: 'withdrawal', coin, amount: amt, walletAddress, source, status: 'pending', date: new Date().toISOString() };
  transactions[req.user.email].push(tx);
  pushNotification(req.user.email, 'withdrawal', `Withdrawal of $${amt.toFixed(2)} (${coin}) submitted.`);
  sendEmail(req.user.email, '⏳ Withdrawal Submitted - NexaSpc', `<div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px;max-width:500px;margin:auto"><h2 style="color:#00d4ff">Withdrawal Submitted</h2><p>Amount: $${amt.toFixed(2)} (${coin})</p><p>To: ${walletAddress}</p></div>`);
  res.json({ success: true, transaction: tx, balance: user.balance, profits: user.profits });
});
 
// ─── TRANSACTIONS ─────────────────────────────────────────────
app.get('/api/transactions', authMiddleware, (req, res) => {
  res.json([...(transactions[req.user.email] || [])].reverse());
});
 
// ─── MARKETS ──────────────────────────────────────────────────
app.get('/api/markets', (req, res) => res.json([
  { symbol: 'BTC/USDT',  price: 67842.50, change:  2.34, volume: '24.5B' },
  { symbol: 'ETH/USDT',  price:  3521.20, change:  1.87, volume: '12.1B' },
  { symbol: 'SOL/USDT',  price:   185.40, change: -0.92, volume:  '3.2B' },
  { symbol: 'XRP/USDT',  price:    0.6234,change:  3.15, volume:  '2.8B' },
  { symbol: 'BNB/USDT',  price:   412.80, change:  0.54, volume:  '1.9B' },
  { symbol: 'ADA/USDT',  price:    0.4821,change: -1.23, volume:  '890M' },
  { symbol: 'DOGE/USDT', price:    0.1543,change:  5.62, volume:  '1.1B' },
  { symbol: 'AVAX/USDT', price:    38.92, change: -2.11, volume:  '654M' }
]));
 
// ─── ADMIN ────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== 'nexaspc_admin_pass') return res.status(401).json({ error: 'Wrong password' });
  const token = jwt.sign({ role: 'admin' }, ADMIN_SECRET, { expiresIn: '12h' });
  res.json({ token });
});
app.get('/api/admin/users', adminMiddleware, (req, res) => {
  res.json(Object.values(users).map(u => ({
    username: u.username, email: u.email, phone: u.phone,
    balance: u.balance, deposits: u.deposits, profits: u.profits, bonuses: u.bonuses,
    emailVerified: u.emailVerified, phoneVerified: u.phoneVerified,
    createdAt: u.createdAt, lastLogin: u.lastLogin, country: u.country,
    walletCount: (connectedWallets[u.email] || []).length
  })));
});
app.get('/api/admin/pending', adminMiddleware, (req, res) => {
  res.json(Object.values(pendingUsers).map(p => ({
    username: p.username, email: p.email,
    phone: p.phone, emailVerified: p.emailVerified,
    phoneVerified: p.phoneVerified, createdAt: p.createdAt
  })));
});
app.get('/api/admin/users/:email', adminMiddleware, (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const user = users[email];
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ ...user, password: '***', transactions: transactions[email] || [], notifications: notifications[email] || [], connectedWallets: connectedWallets[email] || [] });
});
app.get('/api/admin/wallets', adminMiddleware, (req, res) => {
  const all = [];
  for (const [email, wallets] of Object.entries(connectedWallets))
    wallets.forEach(w => all.push({ ...w, userEmail: email, username: users[email]?.username }));
  res.json(all);
});
app.get('/api/admin/log', adminMiddleware, (req, res) => res.json(adminLog.slice(0, 200)));
 
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
 
app.listen(PORT, () => {
  console.log(`\n🚀 NexaSpc  → http://localhost:${PORT}`);
  console.log(`🛡️  Admin    → http://localhost:${PORT}/admin  (pass: nexaspc_admin_pass)\n`);
  console.log('📧 To enable real emails, set: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS');
  console.log('📱 To enable SMS, add Twilio SDK call inside sendSms() in server/index.js\n');
});