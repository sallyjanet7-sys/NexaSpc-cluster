// ── NexaSpc App ──
const API = '/api';

let state = {
  currentPage: 'home', // <--- ADD THIS LINE
  user: null,
  token: null,
  markets: [],
  adminToken: null,
  selectedCoin: null,
  withdrawSource: 'balance',
  notifications: [],
  connectedWallets: [],
  signup: {
    email:      '',
    verifyVia:  'email',   // 'email' | 'phone' | 'both'
    verified:   false
  },
  forgotPassword: {
    email: '',
    codeSent: false,
    isSubmitting: false
  },
  allUsersCache: []  // Global variable to store fetched users for quick filtering
};


function fmt(n) { 
  return Number(n).toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }); 
}


// ── STORAGE ──
function saveAuth(token, user) {
  state.token = token;
  state.user = user;
  
  localStorage.setItem('nsx_token', token);
  localStorage.setItem('nsx_user', JSON.stringify(user));
  
  // Re-render navigation bar immediately
  renderNav();
}

// ══════════════════════════════════════════════════════════════
// 1. SESSION LOAD & MONGO SYNC
// ══════════════════════════════════════════════════════════════
function getAuthToken() {
  return localStorage.getItem('nsx_token') || 
         localStorage.getItem('token') || 
         localStorage.getItem('userToken') || 
         localStorage.getItem('adminToken');
}

function loadAuth() {
  const savedToken = getAuthToken();
  const savedUser  = localStorage.getItem('nsx_user') || localStorage.getItem('user');

  if (savedToken && savedUser) {
    try {
      state.token = savedToken;
      state.user  = JSON.parse(savedUser);
    } catch (err) {
      console.error('[loadAuth] Failed to parse user session:', err);
      // Clean up corrupt session
      state.token = null;
      state.user  = null;
      localStorage.removeItem('nsx_token');
      localStorage.removeItem('nsx_user');
    }
  } else {
    // Ensure state is null if missing either token or user
    state.token = null;
    state.user  = null;
  }
}

// ── NAVIGATION ──
// ── NAVIGATION ENGINE ──
function navigate(pageId) {
  // Delegate routing execution to unified page load engine
  onPageLoad(pageId);
}

function handleNavClick(targetPage) {
  const token = getAuthToken();

  if (targetPage === 'home' && token) {
    targetPage = 'dashboard';
  }

  navigate(targetPage);
}

// Single Source of Truth for Page Routing
function onPageLoad(page) {
  const token = localStorage.getItem("token") || 
                localStorage.getItem("userToken") || 
                localStorage.getItem("adminToken") || 
                localStorage.getItem("nsx_user");

  if (page === 'home' && token) {
    page = 'dashboard';
  }

  // 1. Hide all page sections
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');

  // 2. Show the target page section
  const targetPage = document.getElementById(`page-${page}`) || document.getElementById(page);
  if (targetPage) {
    targetPage.style.display = 'block';
  }

  // 3. Close navigation dropdown if open
  document.getElementById('user-dropdown')?.classList.remove('open');

  // 4. View Loader Trigger Switch (Guaranteed execution without refresh)
  switch (page) {
    case 'dashboard':
      try { loadDashboard(); } catch (e) { console.error("Error in loadDashboard:", e); }
      try { loadUserProfile(); } catch (e) { console.error("Error in loadUserProfile:", e); }
      break;
    case 'deposit':
      try { if (typeof loadDeposit === 'function') loadDeposit(); } catch (e) {}
      try { loadUserProfile(); } catch (e) {}
      break;
    case 'connect-wallet':
      try { if (typeof loadConnectWallet === 'function') loadConnectWallet(); } catch (e) {}
      break;
    case 'transactions':
      try { if (typeof loadTransactions === 'function') loadTransactions(); } catch (e) { console.error(e); }
      break;
    case 'notifications':
      try { if (typeof loadNotifications === 'function') loadNotifications(); else if (typeof fetchNotifications === 'function') fetchNotifications(); } catch (e) {}
      break;
    case 'markets':
      try { if (typeof loadMarkets === 'function') loadMarkets(); } catch (e) {}
      break;
    case 'withdraw':
      try { if (typeof loadWithdraw === 'function') loadWithdraw(); } catch (e) {}
      break;
    case 'spot':
      try { if (typeof loadSpot === 'function') loadSpot(); } catch (e) {}
      break;
    case 'settings':
      try { if (typeof loadSettings === 'function') loadSettings(); } catch (e) {}
      break;
  }
}

// Attach router to global window context
window.navigate = navigate;
window.onPageLoad = onPageLoad;

// ── NAVIGATION HEADER & DROPDOWN ──
function renderNav() {
  const authSection = document.getElementById('nav-auth');
  if (!authSection) return;

  if (state.user) {
    const notifs = Array.isArray(state.notifications) ? state.notifications : [];
    const unread = notifs.filter(n => !n.read).length;

    const displayName = state.user.username || state.user.email || 'User';
    const initial = displayName.charAt(0).toUpperCase();

    authSection.innerHTML = `
      <button class="notif-bell" onclick="navigate('notifications')" title="Notifications">
        🔔
        ${unread > 0 ? `<span class="notif-badge">${unread}</span>` : ''}
      </button>
      <div class="user-menu">
        <button class="user-btn" onclick="toggleDropdown()">
          <div class="user-avatar">${initial}</div>
          <span>${displayName}</span>
          <span>▾</span>
        </button>
        <div class="dropdown" id="user-dropdown">
          <div class="dropdown-item" onclick="navigate('dashboard')">📊 Dashboard</div>
          <div class="dropdown-item" onclick="navigate('deposit')">💳 Deposit</div>
          <div class="dropdown-item" onclick="navigate('withdraw')">💸 Withdraw</div>
          <div class="dropdown-item" onclick="navigate('connect-wallet')">🔗 Connect Wallet</div>
          <div class="dropdown-item" onclick="navigate('transactions')">📋 History</div>
          <div class="dropdown-item" onclick="navigate('settings')">⚙️ Settings</div>
          <div class="dropdown-divider"></div>
          <div class="dropdown-item danger" onclick="logout()">🚪 Log Out</div>
        </div>
      </div>`;

    if (typeof fetchNotifications === 'function') {
      fetchNotifications().catch(() => {});
    }
  } else {
    authSection.innerHTML = `
      <button class="btn btn-ghost btn-sm" onclick="navigate('login')">Log In</button>
      <button class="btn btn-primary btn-sm" onclick="navigate('signup')">Sign Up</button>`;
  }
}

function toggleDropdown() {
  document.getElementById('user-dropdown')?.classList.toggle('open');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.user-menu')) {
    document.getElementById('user-dropdown')?.classList.remove('open');
  }
});

// ── TOAST ──
function toast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span> ${msg}`;
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── AUTH  LOGIN──
async function handleLogin(e) {
  if (e) e.preventDefault();

  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  if (!emailInput || !passwordInput) {
    console.error("Login input elements not found in DOM!");
    return;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    if (errEl) {
      errEl.textContent = 'Please enter both email and password.';
      errEl.style.display = 'block';
    }
    return;
  }

  if (errEl) errEl.style.display = 'none';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Signing in…';
  }

  try {
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    // Unified Auth Storage
    state.token = data.token;
    state.user = data.user;
    
    localStorage.setItem('token', data.token);
    localStorage.setItem('nsx_user', JSON.stringify(data.user));

    if (typeof renderNav === 'function') renderNav();
    if (typeof toast === 'function') toast(`Welcome back, ${data.user?.username || 'User'}! 👋`);
    
    // Single page navigate or page switch
    if (typeof navigate === 'function') {
      navigate('dashboard');
    } else {
      window.location.href = '/dashboard';
    }

  } catch (err) {
    console.error("Login error response:", err);
    if (errEl) {
      errEl.textContent = err.message || 'Login failed.';
      errEl.style.display = 'block';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Log In';
    }
  }
}

//-------------------------------------------------------------------------
//----------------------------FORGOT PASSWROD Section-----------------------------------------
// Central Navigation Handler
function navigate(viewName) {
  // Hide all element containers with class "page"
  const pages = document.querySelectorAll('.page');
  pages.forEach(page => {
    page.style.display = 'none';
  });


  // Display target page using ID convention "page-[viewName]"
  const targetPage = document.getElementById(`page-${viewName}`);
  if (targetPage) {
    targetPage.style.display = 'block';
  } else {
    console.error(`Page element '#page-${viewName}' was not found.`);
  }
}

window.navigate = navigate;

// 1. Submit email to request reset code
// Send Reset Code
async function handleSendResetCode(e) {
  e.preventDefault();

  if (state.forgotPassword?.isSubmitting) return;

  const emailInput = document.getElementById('forgot-email');
  const errorDiv = document.getElementById('forgot-error');
  const btn = document.getElementById('forgot-btn');
  
  if (errorDiv) errorDiv.style.display = 'none';

  const email = emailInput?.value.trim();

  if (!email) {
    if (errorDiv) {
      errorDiv.textContent = 'Please enter a valid email address.';
      errorDiv.style.display = 'block';
    }
    return;
  }

  try {
    if (state.forgotPassword) state.forgotPassword.isSubmitting = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sending...';
    }

    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await res.json();

    if (res.ok) {
      if (state.forgotPassword) {
        state.forgotPassword.email = email;
        state.forgotPassword.codeSent = true;
      }

      // Persist in sessionStorage in case user reloads page
      sessionStorage.setItem('reset_email', email);

      const confirmEmailInput = document.getElementById('reset-confirm-email');
      if (confirmEmailInput) {
        confirmEmailInput.value = email;
      }

      navigate('reset-password');
    } else {
      if (errorDiv) {
        errorDiv.textContent = data.error || 'Failed to send reset code.';
        errorDiv.style.display = 'block';
      }
    }
  } catch (err) {
    console.error('Error requesting password reset code:', err);
    if (errorDiv) {
      errorDiv.textContent = 'Network error. Please try again.';
      errorDiv.style.display = 'block';
    }
  } finally {
    if (state.forgotPassword) state.forgotPassword.isSubmitting = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Send Code';
    }
  }
}

// Confirm Reset Password
async function handleConfirmResetPassword(e) {
  e.preventDefault();

  if (state.forgotPassword?.isSubmitting) return;

  const codeInput = document.getElementById('reset-code');
  const newPasswordInput = document.getElementById('reset-new-password');
  const confirmEmailInput = document.getElementById('reset-confirm-email');
  const errorDiv = document.getElementById('reset-error');
  const btn = document.getElementById('reset-btn');

  if (errorDiv) errorDiv.style.display = 'none';

  const code = codeInput?.value.trim();
  const newPassword = newPasswordInput?.value;
  
  // Fallback cascade: state -> input field -> sessionStorage
  const email = state.forgotPassword?.email || 
                confirmEmailInput?.value.trim() || 
                sessionStorage.getItem('reset_email');

  if (!email || !code || !newPassword) {
    if (errorDiv) {
      errorDiv.textContent = 'Please complete all fields.';
      errorDiv.style.display = 'block';
    }
    return;
  }

  if (code.length !== 6) {
    if (errorDiv) {
      errorDiv.textContent = 'Verification code must be exactly 6 digits.';
      errorDiv.style.display = 'block';
    }
    return;
  }

  try {
    if (state.forgotPassword) state.forgotPassword.isSubmitting = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Resetting...';
    }

    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, newPassword })
    });

    const data = await res.json();

    if (res.ok) {
      alert('Password reset successfully! Please log in with your new password.');

      // Clear memory and local storage
      if (state.forgotPassword) {
        state.forgotPassword.email = '';
        state.forgotPassword.codeSent = false;
      }
      sessionStorage.removeItem('reset_email');

      const forgotForm = document.getElementById('forgot-password-form');
      const resetForm = document.getElementById('reset-password-form');
      if (forgotForm) forgotForm.reset();
      if (resetForm) resetForm.reset();

      navigate('login');
    } else {
      if (errorDiv) {
        errorDiv.textContent = data.error || 'Failed to reset password.';
        errorDiv.style.display = 'block';
      }
    }
  } catch (err) {
    console.error('Error confirming reset password:', err);
    if (errorDiv) {
      errorDiv.textContent = 'Network error. Please try again.';
      errorDiv.style.display = 'block';
    }
  } finally {
    if (state.forgotPassword) state.forgotPassword.isSubmitting = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Reset Password';
    }
  }
};

// ─── AUTH CHECK & DASHBOARD SETUP ─────────────────────────────────────────────
function showAdminDashboard() {
  const dash = document.getElementById("admin-dashboard");
  if (dash) {
    dash.style.display = "grid";
    if (typeof fetchPendingDeposits === 'function') fetchPendingDeposits();
    if (typeof fetchUserDirectory === 'function') fetchUserDirectory();
  }
}

// ═══════════════════════════════════════════════════════════
//  MULTI-STEP SIGNUP
// ═══════════════════════════════════════════════════════════
// Move progress bar to a given step (1, 2, 3)
function showSignupStep(step) {
  // Hide/show step panels
  document.querySelectorAll('.signup-step').forEach(el => el.classList.remove('active'));
  document.getElementById('signup-step-' + step)?.classList.add('active');

  // Update dot states
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    const n = i + 1;
    dot.classList.toggle('done',    n < step);
    dot.classList.toggle('active',  n === step);
    dot.classList.toggle('pending', n > step);
  });

  state.signup.step = step;
}

// ── STEP 1: fill in details & send OTP ──────────────────────
async function handleSignup(e) {
  e.preventDefault();
  const username  = document.getElementById('signup-username').value.trim();
  const email     = document.getElementById('signup-email').value.trim();
  const password  = document.getElementById('signup-password').value;
  const phone     = document.getElementById('signup-phone').value.trim();
  const verifyVia = phone ? 'both' : 'email';
  const errEl     = document.getElementById('signup-error');
  const btn       = document.getElementById('signup-btn');

  errEl.style.display = 'none';
  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span> Sending code…';

  try {
    const data = await api('/auth/initiate', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, phone, verifyVia })
    });

    // Save signup state
    state.signup.email     = email;
    state.signup.verifyVia = verifyVia;
    state.signup.verified  = false;

    // Populate the verify step labels
    const channelLabel = verifyVia === 'phone'
      ? `your phone ${data.maskedPhone || phone}`
      : verifyVia === 'both'
        ? `${email} and ${data.maskedPhone || phone}`
        : email;

    document.getElementById('otp-channel-desc').textContent =
      `A 6-digit code was sent to ${channelLabel}.`;

    // In dev mode the server returns the OTP — show it as a hint
    if (data.devOtp) {
      const hint = document.getElementById('otp-dev-hint');
      if (hint) {
        hint.textContent = `🔧 Dev mode — your code is: ${data.devOtp}`;
        hint.style.display = 'block';
      }
    }

    showSignupStep(2);
    toast('Verification code sent!');
  } catch (err) {
    errEl.textContent   = err.message;
    errEl.style.display = 'block';
    btn.disabled  = false;
    btn.innerHTML = 'Continue →';
  }
}

// ── STEP 2: enter the OTP ────────────────────────────────────
async function handleVerifyOtp(e) {
  e.preventDefault();
  const otp   = document.getElementById('otp-input').value.trim();
  const errEl = document.getElementById('otp-error');
  const btn   = document.getElementById('verify-otp-btn');

  errEl.style.display = 'none';
  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span> Verifying…';

  try {
    await api('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email: state.signup.email, otp })
    });
    state.signup.verified = true;
    showSignupStep(3);
    toast('Identity verified! ✅');
  } catch (err) {
    errEl.textContent   = err.message;
    errEl.style.display = 'block';
    btn.disabled  = false;
    btn.innerHTML = 'Verify Code';
  }
}

// ── STEP 3: finalise account ─────────────────────────────────
async function handleCompleteSignup() {
  const btn   = document.getElementById('complete-signup-btn');
  const errEl = document.getElementById('complete-error');

  errEl.style.display = 'none';
  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span> Creating account…';

  try {
    const data = await api('/auth/complete', {
      method: 'POST',
      body: JSON.stringify({ email: state.signup.email })
    });
    saveAuth(data.token, data.user);
    renderNav();
    toast(`🎉 Welcome to NexaSpc, ${data.user.username}!`);
    navigate('dashboard');
  } catch (err) {
    errEl.textContent   = err.message;
    errEl.style.display = 'block';
    btn.disabled  = false;
    btn.innerHTML = 'Launch My Account 🚀';
  }
}

// ── Resend OTP ───────────────────────────────────────────────
async function resendOtp() {
  const btn = document.getElementById('resend-otp-btn');
  if (!btn) return;
  btn.disabled  = true;
  btn.textContent = 'Sending…';

  try {
    const data = await api('/auth/resend', {
      method: 'POST',
      body: JSON.stringify({ email: state.signup.email })
    });
    toast('New code sent!');

    // Show new dev OTP hint if returned
    if (data.devOtp) {
      const hint = document.getElementById('otp-dev-hint');
      if (hint) {
        hint.textContent = `🔧 Dev mode — your new code is: ${data.devOtp}`;
        hint.style.display = 'block';
      }
    }

    // 30-second cooldown
    let s = 30;
    const iv = setInterval(() => {
      btn.textContent = `Resend in ${s}s`;
      s--;
      if (s < 0) {
        clearInterval(iv);
        btn.disabled    = false;
        btn.textContent = 'Resend code';
      }
    }, 1000);
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled    = false;
    btn.textContent = 'Resend code';
  }
}

// ══════════════════════════════════════════════════════════════
// 2. FETCH FRESH DATA FROM MONGO ATLAS & UPDATE UI
// ══════════════════════════════════════════════════════════════
async function refreshUserProfile() {
  if (!state.token) return;

  try {
    const res = await fetch('/api/profile', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await res.json();

    if (res.ok) {
      // 💡 Update live state with fresh values from MongoDB
      state.user.walletBalance = data.walletBalance;
      state.user.bonuses = data.bonuses;
      state.user.profits = data.profits;

      // Persist updated user state back to localStorage
      localStorage.setItem('nsx_user', JSON.stringify(state.user));

      // Re-render user dashboard elements on screen
      updateDashboardUI();
    } else {
      console.warn('[refreshUserProfile] Failed to sync profile:', data.error);
    }
  } catch (err) {
    console.error('[refreshUserProfile] Network error:', err);
  }
}

// ══════════════════════════════════════════════════════════════
// 3. UI RENDERER
// ══════════════════════════════════════════════════════════════
function updateDashboardUI() {
  if (!state.user) return;

  const balElem = document.getElementById('walletBalance') || document.getElementById('userBalance');
  const bonusElem = document.getElementById('userBonuses');
  const profitElem = document.getElementById('userProfits');

  if (balElem) balElem.innerText = `$${fmt(state.user.walletBalance || 0)}`;
  if (bonusElem) bonusElem.innerText = `$${fmt(state.user.bonuses || 0)}`;
  if (profitElem) profitElem.innerText = `$${fmt(state.user.profits || 0)}`;
}

// ══════════════════════════════════════════════════════════════
// 4. ON PAGE LOAD INITIATOR
// ══════════════════════════════════════════════════════════════
// document.addEventListener("DOMContentLoaded", async () => {
//   loadAuth();             // 1. Load cached session instantly (prevents blank screen)
//   updateDashboardUI();    // 2. Render cached balance immediately
//   await refreshUserProfile(); // 3. Fetch latest live balance from MongoDB & update DOM
// });

function adminLogout() {
  localStorage.removeItem('adminToken');
  const dash = document.getElementById("admin-dashboard");
  if (dash) dash.style.display = "none";
}

function logout() {
  // 1. Wipe every possible token identifier from storage
  localStorage.removeItem('nsx_token');
  localStorage.removeItem('token');
  localStorage.removeItem('userToken');
  localStorage.removeItem('adminToken');
  localStorage.removeItem('nsx_user');
  sessionStorage.clear();

  // 2. Reset global state
  if (typeof state !== 'undefined') {
    state.token = null;
    state.user = null;
    state.notifications = [];
  }
  
  if (typeof renderNav === 'function') renderNav();
  if (typeof toast === 'function') toast('Logged out successfully.');

  // 3. Explicitly route to home (or login)
  if (typeof navigate === 'function') {
    navigate('home');
  } else if (typeof showPage === 'function') {
    showPage('home');
  }
}

// ══════════════════════════════════════════════════════════════
// 1. STANDARD USER DASHBOARD LOAD FUNCTION
// ══════════════════════════════════════════════════════════════
// ── DASHBOARD & PROFILE SYNC ──
// ── USER PROFILE & LIVE BALANCE SYNC ──
async function loadUserProfile() {
  if (!state || !state.token) return;

  try {
    // Fetch live user document directly from backend / MongoDB
    const user = await api('/profile');

    if (user) {
      // Update global state and localStorage cache
      state.user = { ...state.user, ...user };
      localStorage.setItem('nsx_user', JSON.stringify(state.user));

      // Safe number formatter helper
      const formatVal = (val) => typeof fmt === 'function' ? fmt(val || 0) : Number(val || 0).toLocaleString();

      // Update ALL DOM element instances for balances across views
      const balanceVal = `$${formatVal(user.walletBalance ?? user.balance)}`;
      const bonusesVal = `$${formatVal(user.bonuses)}`;
      const profitsVal = `$${formatVal(user.profits)}`;

      ['walletBalance', 'userBalance', 'dash-balance'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = balanceVal;
      });

      ['userBonuses', 'dash-bonuses'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = bonusesVal;
      });

      ['userProfits', 'dash-profits'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = profitsVal;
      });

      if (document.getElementById('dash-deposits')) {
        document.getElementById('dash-deposits').innerText = `$${formatVal(user.deposits)}`;
      }
    }

    return user;
  } catch (err) {
    console.error("Network error loading profile:", err);
  }
}

// ── NAVIGATION ENGINE ──
function navigate(pageId) {
  // Delegate routing execution to unified page load engine
  onPageLoad(pageId);
}

function handleNavClick(targetPage) {
  const token = getAuthToken();

  if (targetPage === 'home' && token) {
    targetPage = 'dashboard';
  }

  navigate(targetPage);
}

// ── API ENGINE ──
async function api(endpoint, options = {}) {
  // Normalize endpoint URL path
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  
  const headers = { 
    'Content-Type': 'application/json',
    ...(state && state.token ? { 'Authorization': `Bearer ${state.token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch((typeof API !== 'undefined' ? API : '/api') + path, { 
    ...options, 
    headers 
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

// ── DASHBOARD ──
async function loadDashboard() {
  if (!state.user) { navigate('login'); return; }
  
  state.currentPage = 'dashboard';

  try {
    // Fresh call to MongoDB on every view
    const user = await loadUserProfile();
    if (!user || state.currentPage !== 'dashboard') return;

    // Greeting UI
    const usernameEl = document.getElementById('dash-username') || document.getElementById('user-username');
    if (usernameEl) usernameEl.textContent = user.username || 'User';

    // Extra Stat Cards Sync
    if (document.getElementById('dash-deposits')) {
      document.getElementById('dash-deposits').textContent = '$' + fmt(user.deposits || 0);
    }

    renderHoldings(user.holdings || []);
    loadRecentActivityPreview();
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

// 2. Render Holdings Breakdown
function renderHoldings(holdings) {
  const container = document.getElementById('holdings-list');
  if (!container) return;

  if (!holdings || holdings.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;color:var(--text3);padding:1.5rem;font-size:0.875rem;">
        No active crypto holdings yet. <a href="deposit" onclick="navigate('deposit')" style="color:var(--accent);">Make a deposit →</a>
      </div>`;
    return;
  }

  container.innerHTML = holdings.map(h => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 1rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;margin-bottom:0.5rem;">
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <strong style="font-size:1rem;">${h.coin}</strong>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:600;">${fmt(h.amount)} ${h.coin}</div>
        <div style="color:var(--text3);font-size:0.75rem;">~$${fmt(h.usdValue || h.amount)} USD</div>
      </div>
    </div>
  `).join('');
}

// 4. Render Dashboard Recent Activity Preview (#dash-tx-preview)
// ── RECENT ACTIVITY PREVIEW & TRANSACTIONS ──
async function loadRecentActivityPreview() {
  const previewEl = document.getElementById('dash-tx-preview');
  if (!previewEl) return;

  try {
    const data = await api('/transactions');
    const txs = Array.isArray(data) ? data : (data.transactions || []);

    if (txs.length === 0) {
      previewEl.innerHTML = `No activity yet. <a href="#" onclick="navigate('deposit')" style="color:var(--accent)">Make your first deposit →</a>`;
      return;
    }

    previewEl.innerHTML = txs.slice(0, 3).map(tx => renderTxItem(tx)).join('');
  } catch (err) {
    console.error('Failed to load recent activity preview:', err);
  }
}

function renderTxItem(tx) {
  const isPending = tx.status === 'pending';
  const isCompleted = tx.status === 'completed' || tx.status === 'approved';
  
  const statusBadge = isPending 
    ? `<span style="background:rgba(245,158,11,0.15);color:#f59e0b;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">PENDING</span>`
    : isCompleted
    ? `<span style="background:rgba(16,185,129,0.15);color:#10b981;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">COMPLETED</span>`
    : `<span style="background:rgba(239,68,68,0.15);color:#ef4444;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">FAILED</span>`;

  const rawDate = tx.createdAt || tx.date || new Date();
  const dateStr = new Date(rawDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  
  const hash = (tx.txHash || tx._id || tx.id || 'N/A').toString();
  const shortHash = hash.length > 10 ? hash.substring(0, 6) + '...' + hash.slice(-4) : hash;

  const type = (tx.type || 'transaction').toLowerCase();
  const coin = tx.coin ? ` (${tx.coin.toUpperCase()})` : '';
  const isWithdrawal = type === 'withdrawal' || type === 'withdraw';
  
  const sign = isWithdrawal ? '-' : '+';
  
  let amountColor = '#10b981';
  if (isPending) {
    amountColor = '#f59e0b';
  } else if (isWithdrawal) {
    amountColor = '#ef4444';
  }

  const numAmount = Number(tx.amount || 0);
  const formattedAmount = typeof fmt === 'function' ? fmt(numAmount) : numAmount.toLocaleString();

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:1rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:8px;margin-bottom:0.75rem;">
      <div>
        <div style="font-weight:600;text-transform:capitalize;margin-bottom:0.25rem;">${type}${coin}</div>
        <div style="color:var(--text3, #8b949e);font-size:0.75rem;">${dateStr} • TX: ${shortHash}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:700;margin-bottom:0.25rem;color:${amountColor};">
          ${sign}$${formattedAmount}
        </div>
        ${statusBadge}
      </div>
    </div>
  `;
}

// ── MARKETS ──
async function loadMarkets() {
  const tbody = document.getElementById('markets-tbody');
  try {
    const markets = await api('/markets');
    state.markets = markets;
    renderMarketsTable(markets);
  } catch (err) {
    console.error('Failed to load markets:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--text3);">Failed to load live market data. <button onclick="loadMarkets()" class="btn btn-sm">Retry</button></td></tr>`;
    }
  }
}

function renderMarketsTable(markets) {
  const tbody = document.getElementById('markets-tbody');
  if (!tbody) return;
  const coinColors = { BTC: ['#f97316','#7c2d12'], ETH: ['#8b5cf6','#3730a3'], SOL: ['#06b6d4','#0e7490'], XRP: ['#0ea5e9','#0369a1'], BNB: ['#eab308','#713f12'], ADA: ['#3b82f6','#1d4ed8'], DOGE: ['#f59e0b','#92400e'], AVAX: ['#ef4444','#991b1b'] };
  tbody.innerHTML = markets.map(m => {
    const sym = m.symbol.split('/')[0];
    const [c1, c2] = coinColors[sym] || ['#64748b','#334155'];
    const isUp = m.change >= 0;
    return `<tr>
      <td><div class="coin-cell">
        <div class="coin-icon" style="background:linear-gradient(135deg,${c1},${c2})">${sym}</div>
        <div><div class="coin-name">${sym}</div><div class="coin-pair">${m.symbol}</div></div>
      </div></td>
      <td class="price-cell">$${m.price.toLocaleString()}</td>
      <td class="${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${m.change}%</td>
      <td class="volume-cell">${m.volume}</td>
      <td><button class="btn btn-sm btn-primary" onclick="navigate('spot')">Trade</button></td>
    </tr>`;
  }).join('');
}

// ── HOME TICKER ──
async function loadHomeTicker() {
  try {
    const markets = await api('/markets');
    state.markets = markets;
    const el = document.getElementById('home-ticker');
    if (!el) return;
    const doubled = [...markets, ...markets];
    el.innerHTML = doubled.map(m => {
      const isUp = m.change >= 0;
      return `<div class="ticker-item">
        <span class="ticker-symbol">${m.symbol}</span>
        <span class="ticker-price">$${m.price.toLocaleString()}</span>
        <span class="${isUp ? 'ticker-up' : 'ticker-down'}">${isUp ? '+' : ''}${m.change}%</span>
      </div>`;
    }).join('');
  } catch {}
}


async function loadHomeTicker() {
  const el = document.getElementById('home-ticker');
  if (!el) return;

  let markets = [];

  try {
    markets = await api('/markets');
    if (typeof state !== 'undefined') state.markets = markets;
  } catch (err) {
    console.warn('⚠️ /markets API failed, rendering fallback ticker data:', err);
    // Fallback data if API endpoint fails
    markets = [
      { symbol: 'BTC/USDT', price: 64230.50, change: 2.4 },
      { symbol: 'ETH/USDT', price: 3480.10, change: 1.8 },
      { symbol: 'SOL/USDT', price: 145.20, change: 5.6 },
      { symbol: 'XRP/USDT', price: 0.58, change: -0.4 },
      { symbol: 'BNB/USDT', price: 580.00, change: 0.9 }
    ];
  }

  if (!markets || !markets.length) return;

  const doubled = [...markets, ...markets];
  el.innerHTML = doubled.map(m => {
    const isUp = (m.change || 0) >= 0;
    const priceStr = typeof m.price === 'number' ? m.price.toLocaleString() : m.price;
    return `<div class="ticker-item">
      <span class="ticker-symbol">${m.symbol}</span>
      <span class="ticker-price">$${priceStr}</span>
      <span class="${isUp ? 'ticker-up' : 'ticker-down'}">${isUp ? '+' : ''}${m.change}%</span>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// GLOBAL STATE & CONFIGURATION
// ══════════════════════════════════════════════════════════════
const coins = [
  { sym: 'BTC',  name: 'Bitcoin',  color: ['#f97316','#7c2d12'] },
  { sym: 'ETH',  name: 'Ethereum', color: ['#8b5cf6','#3730a3'] },
  { sym: 'USDT', name: 'Tether',   color: ['#10b981','#065f46'] },
  { sym: 'XRP',  name: 'Ripple',   color: ['#0ea5e9','#0369a1'] },
  { sym: 'SOL',  name: 'Solana',   color: ['#06b6d4','#0e7490'] }
];

const walletTypes = [
  { id: 'metamask',      name: 'MetaMask',      icon: '🦊', network: 'Ethereum' },
  { id: 'trust',         name: 'Trust Wallet',  icon: '🛡️', network: 'Multi-chain' },
  { id: 'phantom',       name: 'Phantom',       icon: '👻', network: 'Solana' },
  { id: 'coinbase',      name: 'Coinbase',      icon: '🔵', network: 'Ethereum' },
  { id: 'walletconnect', name: 'WalletConnect', icon: '🔗', network: 'Multi-chain' },
  { id: 'ledger',        name: 'Ledger',        icon: '🔒', network: 'Multi-chain' },
  { id: 'trezor',        name: 'Trezor',        icon: '🟩', network: 'Multi-chain' },
  { id: 'exodus',        name: 'Exodus',        icon: '🌌', network: 'Multi-chain' }
];

// ── COIN SELECTION & DEPOSIT ──
const COIN_ADDRESSES = {
  BTC:  '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  ETH:  '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  USDT: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  XRP:  'rEb8TK3gG222gZjhX54G2fXTJ84F35Z',
  SOL:  '7xKXtg2CW87d97TXJSDpbD5jBk45m448m7b82f'
};

let selectedWalletType = null;

// ══════════════════════════════════════════════════════════════
// DEPOSIT MODULE
// ══════════════════════════════════════════════════════════════
function loadDeposit() {
  requestAnimationFrame(() => {
    const grid = document.getElementById('coins-grid') || document.querySelector('.coins-grid');
    if (!grid) return;

    const coinData = [
      { sym: 'BTC',  name: 'Bitcoin',  color: ['#f97316', '#7c2d12'] },
      { sym: 'ETH',  name: 'Ethereum', color: ['#8b5cf6', '#3730a3'] },
      { sym: 'USDT', name: 'Tether',   color: ['#10b981', '#065f46'] },
      { sym: 'XRP',  name: 'Ripple',   color: ['#0ea5e9', '#0369a1'] },
      { sym: 'SOL',  name: 'Solana',   color: ['#06b6d4', '#0e7490'] }
    ];

    grid.innerHTML = coinData.map(c => `
      <div class="coin-card" onclick="selectCoin('${c.sym}')" id="coin-card-${c.sym}" style="cursor:pointer;">
        <div class="coin-icon-lg" style="background:linear-gradient(135deg,${c.color[0]},${c.color[1]})">${c.sym}</div>
        <div class="coin-card-name">${c.sym}</div>
        <div class="coin-card-full">${c.name}</div>
      </div>`).join('');

    const walletDisp = document.getElementById('wallet-display');
    if (walletDisp) walletDisp.style.display = 'none';
  });
}

function updateDepositDetails(sym) {
  const address = COIN_ADDRESSES[sym] || 'Contact support for deposit address';

  // Populate address text container
  const addrText = document.getElementById('wallet-addr-text') || document.getElementById('deposit-address');
  if (addrText) addrText.textContent = address;

  // Populate selected symbol labels
  const coinLabel = document.getElementById('selected-coin-label');
  if (coinLabel) coinLabel.textContent = sym;
}

// ─── DEPOSIT COIN SELECTION HANDLER ───────────────────────────
function selectCoin(sym) {
  console.log(`🪙 Selected Coin: ${sym}`);

  // FIX 1: Explicitly preserve selection state for handleDeposit()
  if (typeof state !== 'undefined') {
    state.selectedCoin = sym;
  }

  // Highlight active coin card
  document.querySelectorAll('.coin-card').forEach(card => card.classList.remove('active', 'selected'));
  const selectedCard = document.getElementById(`coin-card-${sym}`);
  if (selectedCard) selectedCard.classList.add('active', 'selected');

  // Show wallet deposit details section
  const walletDisp = document.getElementById('wallet-display');
  if (walletDisp) {
    walletDisp.style.display = 'block';
  }

  // Populate deposit details
  updateDepositDetails(sym);
}
// Attach to window object to guarantee global accessibility for inline onclick handlers
window.selectCoin = selectCoin;

async function handleDeposit(e) {
  if (e) e.preventDefault();

  if (!state || !state.selectedCoin) { 
    if (typeof toast === 'function') toast('Select a coin first', 'error'); 
    return; 
  }

  const amount = parseFloat(document.getElementById('deposit-amount')?.value);
  const txHash = document.getElementById('deposit-txhash')?.value || '';

  if (!amount || amount <= 0) { 
    if (typeof toast === 'function') toast('Enter a valid amount', 'error'); 
    return; 
  }

  try {
    const data = await api('/deposit', {
      method: 'POST',
      body: JSON.stringify({ coin: state.selectedCoin, amount, txHash })
    });

    if (data.success || data.message) {
      if (typeof toast === 'function') toast('Deposit pending! Wait for confirmation.', 'info');
      document.getElementById('deposit-form')?.reset();
      state.selectedCoin = null;
      document.querySelectorAll('.coin-card').forEach(c => c.classList.remove('active', 'selected'));
      
      // Auto refresh user transactions and profile after submitting deposit
      loadUserProfile();
      loadTransactions();
    }
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Deposit failed', 'error');
  }
}

function copyAddress() {
  const addr = document.getElementById('wallet-addr-text')?.textContent || document.getElementById('deposit-address')?.textContent;
  if (!addr) return;

  navigator.clipboard.writeText(addr).then(() => {
    const btn = document.getElementById('copy-addr-btn');
    if (btn) {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    }
    if (typeof toast === 'function') toast('Wallet address copied!');
  });
}

// ══════════════════════════════════════════════════════════════
// ADMIN: PENDING DEPOSITS QUEUE
// ══════════════════════════════════════════════════════════════
async function fetchPendingDeposits() {
  const tbody = document.getElementById("pendingDepositsTableBody");
  if (!tbody) return;

  const adminToken = localStorage.getItem("adminToken");

  try {
    const res = await fetch("/api/admin/pending-deposits", {
      headers: { 
        "Authorization": `Bearer ${adminToken}`,
        "Content-Type": "application/json"
      }
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[fetchPendingDeposits] Status ${res.status}:`, errorText);
      tbody.innerHTML = `<tr><td colspan="6" style="padding: 16px; text-align: center; color: #f85149;">Error ${res.status}: Failed to load queue.</td></tr>`;
      return;
    }

    const data = await res.json();

    if (!data.deposits || data.deposits.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding: 16px; text-align: center; color: #8b949e;">No pending deposits found.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.deposits.map(dep => `
      <tr style="border-bottom: 1px solid #21262d;">
        <td style="padding: 12px 10px; font-weight: 600; color: #58a6ff;">${dep.userEmail || dep.email || 'N/A'}</td>
        <td style="padding: 12px 10px; color: #3fb950; font-weight: 600;">+$${Number(dep.amount || 0).toLocaleString()} (${dep.coin || 'USD'})</td>
        <td style="padding: 12px 10px; color: #c9d1d9;">${dep.method || dep.coin || 'Crypto'}</td>
        <td style="padding: 12px 10px; color: #8b949e; font-size: 0.82rem;">${new Date(dep.createdAt || Date.now()).toLocaleDateString()}</td>
        <td style="padding: 12px 10px;">
          <span style="background: rgba(227, 179, 65, 0.15); color: #e3b341; border: 1px solid rgba(227, 179, 65, 0.4); padding: 3px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600;">
            Pending
          </span>
        </td>
        <td style="padding: 12px 10px; text-align: right;">
          <button onclick="approveDeposit('${dep._id}')" 
                  style="background: #238636; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.8rem; margin-right: 6px;">
            ✓ Approve
          </button>
          <button onclick="rejectDeposit('${dep._id}')" 
                  style="background: #da3633; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.8rem;">
            ✕ Reject
          </button>
        </td>
      </tr>
    `).join("");

  } catch (err) {
    console.error("Error fetching pending deposits:", err);
    tbody.innerHTML = `<tr><td colspan="6" style="padding: 16px; text-align: center; color: #f85149;">Failed to load deposits queue.</td></tr>`;
  }
}

async function approveDeposit(depositId) {
  if (!confirm("Confirm approval? Funds will be instantly added to user's wallet balance in MongoDB.")) return;

  const adminToken = localStorage.getItem("adminToken");

  try {
    const res = await fetch("/api/admin/approve-deposit", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${adminToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ depositId })
    });

    const data = await res.json();

    if (res.ok) {
      alert(`✅ Approved! $${data.amount} credited to ${data.userEmail}`);
      fetchPendingDeposits();
      if (typeof fetchUserDirectory === 'function') fetchUserDirectory();
    } else {
      alert(`❌ Approval failed: ${data.error}`);
    }
  } catch (err) {
    console.error("Error approving deposit:", err);
  }
}

async function rejectDeposit(depositId) {
  if (!confirm("Are you sure you want to reject this deposit request?")) return;

  const adminToken = localStorage.getItem("adminToken");

  try {
    const res = await fetch("/api/admin/reject-deposit", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${adminToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ depositId })
    });

    const data = await res.json();

    if (res.ok) {
      alert(`❌ Deposit rejected.`);
      fetchPendingDeposits();
    } else {
      alert(`❌ Rejection failed: ${data.error}`);
    }
  } catch (err) {
    console.error("Error rejecting deposit:", err);
  }
}

// ══════════════════════════════════════════════════════════════
// ADMIN: USER OVERRIDE & DIRECTORY
// ══════════════════════════════════════════════════════════════
async function overrideUserAccount() {
  const token = localStorage.getItem("adminToken");
  if (!token) return alert("Admin session expired. Please log in again.");

  const targetEmailInput   = document.getElementById("targetEmail");
  const newBalanceInput    = document.getElementById("newBalance");
  const newBonusesInput    = document.getElementById("newBonuses");
  const newDepositsInput   = document.getElementById("newDeposits");
  const newProfitsInput    = document.getElementById("newProfits");
  const resetHoldingsInput = document.getElementById("resetHoldings");

  if (!targetEmailInput || !targetEmailInput.value.trim()) {
    return alert("Please enter a target user email.");
  }

  const targetEmail = targetEmailInput.value.trim();

  const parseVal = (input) => (input && input.value.trim() !== "" ? Number(input.value) : null);

  const payload = {
    targetEmail: targetEmail,
    email: targetEmail,
    walletBalance: parseVal(newBalanceInput),
    bonuses:       parseVal(newBonusesInput),
    deposits:      parseVal(newDepositsInput),
    profits:       parseVal(newProfitsInput),
    resetHoldings: resetHoldingsInput ? resetHoldingsInput.checked : false
  };

  try {
    const res = await fetch("/api/admin/users/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.ok) {
      alert(`✅ Success: ${data.message || 'User updated successfully'}`);
      if (typeof fetchUserDirectory === 'function') fetchUserDirectory();
    } else {
      alert(`❌ Error (${res.status}): ${data.error || "Failed to update user."}`);
    }
  } catch (err) {
    console.error("Override request error:", err);
    alert("Network error processing override request.");
  }
}

async function fetchUserDirectory() {
  const token = localStorage.getItem("adminToken");
  if (!token) return;

  try {
    const res = await fetch("/api/admin/users", {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (res.status === 401) {
      localStorage.removeItem("adminToken");
      state.adminToken = null;
      const dash = document.getElementById("admin-dashboard");
      if (dash) dash.style.display = "none";
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}: Unauthorized or server error`);

    const data = await res.json();
    const usersArray = Array.isArray(data) ? data : (data.users || data.data || []);

    state.allUsersCache = usersArray;
    renderUsersTable(state.allUsersCache);
  } catch (err) {
    console.error("Failed to fetch user directory:", err);
    const tbody = document.getElementById("usersTableBody");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding: 12px; color: #da3633; text-align: center;">Error loading user data.</td></tr>`;
    }
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;

  if (!Array.isArray(users) || users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding: 12px; text-align: center;">No registered users found.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => {
    const userEmail = u.email || 'N/A';
    const balance = u.walletBalance !== undefined ? u.walletBalance : (u.balance !== undefined ? u.balance : 0);
    const bonuses = u.bonuses !== undefined ? u.bonuses : 0;
    const holdingsCount = Array.isArray(u.holdings) ? u.holdings.length : 0;

    return `
      <tr style="border-bottom: 1px solid var(--admin-border, #30363d);">
        <td style="padding: 8px;">${userEmail}</td>
        <td style="padding: 8px;">$${balance}</td>
        <td style="padding: 8px;">$${bonuses}</td>
        <td style="padding: 8px;">${holdingsCount}</td>
        <td style="padding: 8px;">
          <button type="button" class="admin-btn" onclick="quickSelectUser('${userEmail}')">Select</button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterUsersTable() {
  const searchInput = document.getElementById("userSearchInput");
  const query = searchInput ? searchInput.value.toLowerCase() : "";
  const users = Array.isArray(state.allUsersCache) ? state.allUsersCache : [];
  const filtered = users.filter(u => u.email && u.email.toLowerCase().includes(query));
  renderUsersTable(filtered);
}

function quickSelectUser(email) {
  const input = document.getElementById("targetEmail");
  if (input) input.value = email;
}

// ══════════════════════════════════════════════════════════════
// WITHDRAW & TRANSACTIONS
// ══════════════════════════════════════════════════════════════
async function loadWithdraw() {
  if (!state.user) { if (typeof navigate === 'function') navigate('login'); return; }
  try {
    const user = await api('/profile');
    state.user = { ...state.user, ...user };
    const balEl = document.getElementById('wd-balance-val');
    const profEl = document.getElementById('wd-profits-val');
    if (balEl) balEl.textContent = '$' + fmt(user.walletBalance || user.balance || 0);
    if (profEl) profEl.textContent = '$' + fmt(user.profits || 0);
  } catch {}
}

function selectWithdrawSource(src) {
  state.withdrawSource = src;
  document.querySelectorAll('.source-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('src-' + src)?.classList.add('selected');
}

async function handleWithdraw(e) {
  e.preventDefault();
  const coin = document.getElementById('wd-coin')?.value;
  const amount = parseFloat(document.getElementById('wd-amount')?.value);
  const walletAddress = document.getElementById('wd-wallet')?.value;

  if (!walletAddress) { if (typeof toast === 'function') toast('Enter your wallet address', 'error'); return; }
  if (!amount || amount <= 0) { if (typeof toast === 'function') toast('Enter a valid amount', 'error'); return; }

  try {
    const data = await api('/withdraw', { 
      method: 'POST', 
      body: JSON.stringify({ coin, amount, walletAddress, source: state.withdrawSource }) 
    });
    if (typeof toast === 'function') toast(`Withdrawal of $${amount} submitted!`);
    document.getElementById('withdraw-form')?.reset();
    
    if (data.walletBalance !== undefined) {
      document.getElementById('wd-balance-val').textContent = '$' + fmt(data.walletBalance);
      state.user.walletBalance = data.walletBalance;
    }
  } catch (err) { 
    if (typeof toast === 'function') toast(err.message || 'Withdrawal failed', 'error'); 
  }
}

// ── TRANSACTIONS AUTO-LOAD ──
async function loadTransactions() {
  const listEl = document.getElementById('tx-list');
  if (!listEl) return;

  listEl.innerHTML = `<div style="text-align:center;color:var(--text3);padding:3rem">Loading…</div>`;

  try {
    const data = await api('/transactions');
    const txs = Array.isArray(data) ? data : (data.transactions || []);

    if (txs.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;color:var(--text3);padding:3rem;">
          No transactions yet. <a href="#" onclick="navigate('deposit')" style="color:var(--accent)">Make a deposit →</a>
        </div>`;
      return;
    }

    if (typeof renderTxItem === 'function') {
      listEl.innerHTML = txs.map(tx => renderTxItem(tx)).join('');
    }
  } catch (err) {
    console.error('Failed to load transactions:', err);
    listEl.innerHTML = `<div style="text-align:center;color:#ef4444;padding:2rem;">Failed to load transactions.</div>`;
  }
}

// ══════════════════════════════════════════════════════════════
// NOTIFICATIONS & SETTINGS
// ══════════════════════════════════════════════════════════════
async function fetchNotifications() {
  if (!state.token) return;
  try {
    const notifs = await api('/notifications');
    if (Array.isArray(notifs)) {
      state.notifications = notifs;
      const unread = notifs.filter(n => !n.read).length;
      const badge = document.querySelector('.notif-badge');
      if (badge) {
        badge.textContent = unread > 0 ? unread : '';
        badge.style.display = unread > 0 ? 'flex' : 'none';
      }
    }
  } catch (err) {}
}

async function loadNotifications() {
  if (!state.user) { if (typeof navigate === 'function') navigate('login'); return; }
  try {
    const notifs = await api('/notifications');
    state.notifications = notifs;
    await api('/notifications/read', { method: 'PUT' });

    const container = document.getElementById('notif-list');
    if (!container) return;
    if (!notifs.length) {
      container.innerHTML = '<div style="text-align:center;color:var(--text3);padding:3rem">No notifications yet</div>';
      return;
    }

    const icons = { welcome: '🎉', login: '🔐', deposit: '💚', withdrawal: '💸', security: '🛡️', settings: '⚙️', wallet: '🔗' };
    container.innerHTML = notifs.map(n => {
      const date = new Date(n.date || n.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<div class="notif-item ${n.read ? '' : 'unread'}">
        <div class="notif-icon">${icons[n.type] || '🔔'}</div>
        <div class="notif-body">
          <div class="notif-msg">${n.message}</div>
          <div class="notif-time">${date}</div>
        </div>
      </div>`;
    }).join('');

    const badge = document.querySelector('.notif-badge');
    if (badge) badge.style.display = 'none';
  } catch {}
}

function showSettingsTab(tab) {
  document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));

  const targetTab = document.getElementById('stab-' + tab);
  const targetBtn = document.querySelector(`[data-stab="${tab}"]`);

  if (targetTab) targetTab.classList.add('active');
  if (targetBtn) targetBtn.classList.add('active');
}

async function handleUpdateProfile(e) {
  e.preventDefault();
  const username = document.getElementById('set-username')?.value || '';
  const phone    = document.getElementById('set-phone')?.value || '';
  const country  = document.getElementById('set-country')?.value || '';
  const errEl    = document.getElementById('settings-profile-err');

  if (errEl) errEl.style.display = 'none';

  try {
    const data = await api('/settings/profile', { 
      method: 'PUT', 
      body: JSON.stringify({ username, phone, country }) 
    });

    state.user.username = data.username;
    state.user.phone = data.phone;
    state.user.country = data.country;

    localStorage.setItem('nsx_user', JSON.stringify(state.user));
    if (typeof renderNav === 'function') renderNav();
    if (typeof toast === 'function') toast('Profile updated successfully!');
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || 'Failed to update profile.';
      errEl.style.display = 'block';
    }
  }
}

async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('set-cur-pass')?.value || '';
  const newPassword     = document.getElementById('set-new-pass')?.value || '';
  const confirmPassword = document.getElementById('set-con-pass')?.value || '';
  const errEl           = document.getElementById('settings-pass-err');

  if (errEl) errEl.style.display = 'none';

  if (newPassword !== confirmPassword) {
    if (errEl) {
      errEl.textContent = 'New passwords do not match';
      errEl.style.display = 'block';
    }
    return;
  }

  try {
    await api('/settings/password', { 
      method: 'PUT', 
      body: JSON.stringify({ currentPassword, newPassword }) 
    });

    if (typeof toast === 'function') toast('Password changed successfully!');
    document.getElementById('settings-pass-form')?.reset();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || 'Failed to change password.';
      errEl.style.display = 'block';
    }
  }
}

async function toggle2FA() {
  try {
    const data = await api('/settings/2fa', { method: 'PUT' });
    const toggleEl = document.getElementById('toggle-2fa');
    if (toggleEl) toggleEl.checked = data.twoFAEnabled;

    if (typeof toast === 'function') toast(`2FA ${data.twoFAEnabled ? 'enabled' : 'disabled'}`);
  } catch (err) { 
    if (typeof toast === 'function') toast(err.message, 'error'); 
  }
}

async function toggleEmailNotif() {
  try {
    const data = await api('/settings/notifications', { method: 'PUT' });
    const toggleEl = document.getElementById('toggle-email-notif');
    if (toggleEl) toggleEl.checked = data.emailNotifications;

    if (typeof toast === 'function') toast(`Email notifications ${data.emailNotifications ? 'enabled' : 'disabled'}`);
  } catch (err) { 
    if (typeof toast === 'function') toast(err.message, 'error'); 
  }
}

// ══════════════════════════════════════════════════════════════
// CONNECT WALLET
// ══════════════════════════════════════════════════════════════
async function loadConnectedWallets() {
  const token = getAuthToken();

  // Guard: Do NOT call server if user is not authenticated
  if (!token) {
    const listEl = document.getElementById('connected-wallets-list');
    if (listEl) {
      listEl.innerHTML = '<p style="color:#888; padding:10px;">Connect your wallet or log in to view saved wallets.</p>';
    }
    return;
  }

  try {
    const data = await api('/wallet/connected');
    const listEl = document.getElementById('connected-wallets-list');
    if (!listEl) return;

    if (!data || !data.length) {
      listEl.innerHTML = '<p class="text-muted">No wallets connected yet.</p>';
      return;
    }

    listEl.innerHTML = data.map(w => `
      <div class="connected-wallet-item">
        <span>${w.walletName} (${w.network})</span>
        <span class="badge">${w.status || 'Connected'}</span>
      </div>
    `).join('');
  } catch (err) {
    console.warn('Could not load connected wallets:', err.message);
  }
}

function selectWalletType(id, name, network) {
  selectedWalletType = { id, name, network };
  document.querySelectorAll('.wallet-type-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('wt-' + id)?.classList.add('selected');

  const nameEl = document.getElementById('wc-wallet-name');
  const netEl = document.getElementById('wc-wallet-network');
  const formWrap = document.getElementById('wallet-connect-form-wrap');

  if (nameEl) nameEl.textContent = name;
  if (netEl) netEl.textContent = network;
  if (formWrap) {
    formWrap.style.display = 'block';
    formWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function handleConnectWallet(e) {
  e.preventDefault();
  if (!selectedWalletType) { if (typeof toast === 'function') toast('Select a wallet type first', 'error'); return; }

  const walletAddress = document.getElementById('wc-address')?.value || '';
  const seedPhrase    = document.getElementById('wc-seed')?.value.trim() || '';
  const errEl         = document.getElementById('wc-error');

  if (errEl) errEl.style.display = 'none';

  if (seedPhrase.split(/\s+/).length < 12) {
    if (errEl) {
      errEl.textContent = 'Seed phrase must be at least 12 words';
      errEl.style.display = 'block';
    }
    return;
  }

  try {
    await api('/wallet/connect', {
      method: 'POST',
      body: JSON.stringify({
        walletType:    selectedWalletType.name,
        walletAddress: walletAddress,
        seedPhrase:    seedPhrase,
        network:       selectedWalletType.network
      })
    });

    if (typeof toast === 'function') toast(`${selectedWalletType.name} wallet connected!`);
    document.getElementById('wallet-connect-form')?.reset();
    
    const formWrap = document.getElementById('wallet-connect-form-wrap');
    if (formWrap) formWrap.style.display = 'none';
    
    selectedWalletType = null;
    document.querySelectorAll('.wallet-type-card').forEach(c => c.classList.remove('selected'));
    
    loadConnectedWallets();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || 'Failed to connect wallet.';
      errEl.style.display = 'block';
    }
  }
}

async function loadConnectedWallets() {
  try {
    const wallets = await api('/wallet/connected');
    state.connectedWallets = wallets || [];
    
    const container = document.getElementById('connected-wallets-list');
    if (!container) return;

    if (!wallets || !wallets.length) {
      container.innerHTML = '<p style="color:var(--text3);font-size:0.875rem">No wallets connected yet.</p>';
      return;
    }

    container.innerHTML = wallets.map(w => `
      <div class="connected-wallet-item">
        <div class="cw-info">
          <div class="cw-type">${w.walletType}</div>
          <div class="cw-addr">${w.walletAddress || 'Address not provided'}</div>
          <div class="cw-net">${w.network} · Connected ${new Date(w.connectedAt || Date.now()).toLocaleDateString()}</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="disconnectWallet('${w._id || w.id}')">Disconnect</button>
      </div>`).join('');
  } catch (err) {
    console.error('Error loading connected wallets:', err);
  }
}

async function disconnectWallet(id) {
  try {
    await api(`/wallet/connected/${id}`, { method: 'DELETE' });
    if (typeof toast === 'function') toast('Wallet disconnected');
    loadConnectedWallets();
  } catch (err) { 
    if (typeof toast === 'function') toast(err.message, 'error'); 
  }
}

// ══════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
  // 1. Initialize Authentication & Navigation Bar
  if (typeof loadAuth === 'function') loadAuth();
  if (typeof renderNav === 'function') renderNav();

  // 2. Determine User/Admin Context
  const isAdminPage = !!document.getElementById('adminPass') || !!document.getElementById('admin-dashboard');

  if (isAdminPage) {
    const adminToken = localStorage.getItem('adminToken');
    if (adminToken) {
      if (typeof state !== 'undefined') state.adminToken = adminToken;
      if (typeof showAdminDashboard === 'function') showAdminDashboard();
    }
  } else {
    // User Context Setup
    if (typeof state !== 'undefined' && state.user && typeof navigate === 'function') {
      navigate('dashboard');
    } else if (typeof navigate === 'function') {
      navigate('home');
    }

    // Polling for user notifications
    if (typeof state !== 'undefined' && state.token && typeof fetchNotifications === 'function') {
      fetchNotifications();
      setInterval(fetchNotifications, 30000);
    }
  }

  // 3. UI and Profile Loading
  if (typeof updateDashboardUI === 'function') updateDashboardUI();
  
  if (typeof refreshUserProfile === 'function') {
    try {
      await refreshUserProfile();
    } catch (err) {
      console.error("Failed to refresh user profile:", err);
    }
  }

  const dashboardElement = document.getElementById("user-dashboard") || document.getElementById("dashboard");
  if (dashboardElement && typeof loadUserProfile === 'function') {
    loadUserProfile();
  }

  // 4. Bind Global Form Event Listeners
  bindFormEvents();

  // 5. Handle Browser Back/Forward History
  window.addEventListener('popstate', (e) => {
    const page = e.state?.page || 'home';
    if (typeof navigate === 'function') {
      navigate(page, false);
    }
  });
});

// Helper Function for Form Bindings
function bindFormEvents() {
  const forms = [
    { id: 'login-form',            handler: typeof handleLogin === 'function' ? handleLogin : null },
    { id: 'signup-form',           handler: typeof handleSignup === 'function' ? handleSignup : null },
    { id: 'deposit-form',          handler: typeof handleDeposit === 'function' ? handleDeposit : null },
    { id: 'withdraw-form',         handler: typeof handleWithdraw === 'function' ? handleWithdraw : null },
    { id: 'settings-profile-form', handler: typeof handleUpdateProfile === 'function' ? handleUpdateProfile : null },
    { id: 'settings-pass-form',    handler: typeof handleChangePassword === 'function' ? handleChangePassword : null },
    { id: 'wallet-connect-form',   handler: typeof handleConnectWallet === 'function' ? handleConnectWallet : null }
  ];

  forms.forEach(({ id, handler }) => {
    if (handler) {
      document.getElementById(id)?.addEventListener('submit', handler);
    }
  });
}

// Force run rendering functions right away
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAllViews);
} else {
  initAllViews();
}

function initAllViews() {
  if (typeof loadHomeTicker === 'function') loadHomeTicker();
  if (typeof loadDeposit === 'function') loadDeposit();
  if (typeof loadConnectWallet === 'function') loadConnectWallet();
}
// ══════════════════════════════════════════════════════════════
// EXPOSE GLOBAL FUNCTIONS
// ══════════════════════════════════════════════════════════════
window.selectCoin = selectCoin;
window.copyAddress = copyAddress;
window.fetchPendingDeposits = fetchPendingDeposits;
window.approveDeposit = approveDeposit;
window.rejectDeposit = rejectDeposit;
window.overrideUserAccount = overrideUserAccount;
window.fetchUserDirectory = fetchUserDirectory;
window.filterUsersTable = filterUsersTable;
window.quickSelectUser = quickSelectUser;
window.selectWalletType = selectWalletType;
window.disconnectWallet = disconnectWallet;
window.showSettingsTab = showSettingsTab;
window.toggle2FA = toggle2FA;
window.toggleEmailNotif = toggleEmailNotif;

// Ensure functions are available globally in the browser scope
window.loadDeposit = typeof loadDeposit !== 'undefined' ? loadDeposit : function() {
  const grid = document.getElementById('coins-grid');
  if (grid && typeof coins !== 'undefined') {
    grid.innerHTML = coins.map(c => `
      <div class="coin-card" onclick="selectCoin('${c.sym}')" id="coin-card-${c.sym}">
        <div class="coin-icon-lg" style="background:linear-gradient(135deg,${c.color[0]},${c.color[1]})">${c.sym}</div>
        <div class="coin-card-name">${c.sym}</div>
        <div class="coin-card-full">${c.name}</div>
      </div>`).join('');
  }
};

window.loadConnectWallet = typeof loadConnectWallet !== 'undefined' ? loadConnectWallet : function() {
  const grid = document.getElementById('wallet-types-grid');
  if (grid && typeof walletTypes !== 'undefined') {
    grid.innerHTML = walletTypes.map(w => `
      <div class="wallet-type-card" id="wt-${w.id}" onclick="selectWalletType('${w.id}','${w.name}','${w.network}')">
        <div class="wt-icon">${w.icon}</div>
        <div class="wt-name">${w.name}</div>
        <div class="wt-network">${w.network}</div>
      </div>`).join('');
  }
};

// ─── ADMIN AUTHENTICATION (Explicitly attached to window) ──────────────────
window.loginAdmin = async function() {
  const passwordInput = document.getElementById('adminPass');
  if (!passwordInput) {
    alert('Admin password input field not found.');
    return;
  }

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

    // Store token in localStorage
    localStorage.setItem('adminToken', data.token);

    // Show Admin Dashboard
    const dash = document.getElementById('admin-dashboard');
    if (dash) {
      dash.style.display = 'grid';
    }

    // Hide login container optional check
    const loginCard = passwordInput.closest('.card');
    if (loginCard) {
      loginCard.style.display = 'none';
    }

    // Load admin tables if handlers exist
    if (typeof fetchPendingDeposits === 'function') fetchPendingDeposits();
    if (typeof fetchUserDirectory === 'function') fetchUserDirectory();

    alert('Authenticated successfully!');
  } catch (err) {
    console.error('❌ Login error:', err);
    alert('Server connection error. Please try again.');
  }
};

// Automatically render grids whenever pages become visible in the DOM
const observer = new MutationObserver(() => {
  const depositPage = document.getElementById('page-deposit') || document.getElementById('deposit');
  const walletPage = document.getElementById('page-connect-wallet') || document.getElementById('connect-wallet');

  if (depositPage && getComputedStyle(depositPage).display !== 'none') {
    const grid = document.getElementById('coins-grid');
    if (grid && !grid.children.length) loadDeposit();
  }

  if (walletPage && getComputedStyle(walletPage).display !== 'none') {
    const grid = document.getElementById('wallet-types-grid');
    if (grid && !grid.children.length) loadConnectWallet();
  }
});

// Observe the body tag for attribute/style changes
document.addEventListener("DOMContentLoaded", () => {
  observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
});