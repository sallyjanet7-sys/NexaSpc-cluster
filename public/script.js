// ── NexaSpc App ──
const API = '/api';

let state = {
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
function loadAuth() {
  const savedToken = localStorage.getItem('nsx_token') || localStorage.getItem('token');
  const savedUser  = localStorage.getItem('nsx_user') || localStorage.getItem('user');

  if (savedToken && savedUser) {
    try {
      state.token = savedToken;
      state.user  = JSON.parse(savedUser);
    } catch (err) {
      console.error('[loadAuth] Failed to parse user session:', err);
      state.token = null;
      state.user  = null;
    }
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

  if (balElem) balElem.innerText = `$${Number(state.user.walletBalance || 0).toLocaleString()}`;
  if (bonusElem) bonusElem.innerText = `$${Number(state.user.bonuses || 0).toLocaleString()}`;
  if (profitElem) profitElem.innerText = `$${Number(state.user.profits || 0).toLocaleString()}`;
}

// ══════════════════════════════════════════════════════════════
// 4. ON PAGE LOAD INITIATOR
// ══════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
  loadAuth();             // 1. Load cached session instantly (prevents blank screen)
  updateDashboardUI();    // 2. Render cached balance immediately
  await refreshUserProfile(); // 3. Fetch latest live balance from MongoDB & update DOM
});

function adminLogout() {
  localStorage.removeItem('adminToken');
  const dash = document.getElementById("admin-dashboard");
  if (dash) dash.style.display = "none";
}

function logout() {
  localStorage.removeItem('nsx_token');
  localStorage.removeItem('nsx_user');
  localStorage.removeItem('adminToken'); // Clean up admin token as well
  state.token = null;
  state.user = null;
  state.notifications = [];
  
  renderNav();
  if (typeof toast === 'function') toast('Logged out successfully.');
  if (typeof navigate === 'function') navigate('login');
}

// ══════════════════════════════════════════════════════════════
// 1. STANDARD USER DASHBOARD LOAD FUNCTION
// ══════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  // Check if we are on the user dashboard page
  const dashboardElement = document.getElementById("user-dashboard") || document.getElementById("dashboard");
  if (dashboardElement) {
    loadUserProfile();
  }
});

async function loadUserProfile() {
  // Grab standard user token (or adminToken as a fallback during local testing)
  const token = localStorage.getItem("token") || 
                localStorage.getItem("userToken") || 
                localStorage.getItem("adminToken");

  if (!token) {
    console.warn("No authentication token found. Redirecting to login...");
    window.location.href = "/login.html";
    return;
  }

  try {
    const res = await fetch('/api/profile', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await res.json();

    if (res.ok) {
      console.log("✅ LIVE MONGO USER PROFILE:", data);

      // Render walletBalance directly to the DOM
      const balanceElem = document.getElementById("walletBalance") || document.getElementById("userBalance");
      const bonusesElem = document.getElementById("userBonuses");
      const profitsElem = document.getElementById("userProfits");

      if (balanceElem) balanceElem.innerText = `$${Number(data.walletBalance || 0).toLocaleString()}`;
      if (bonusesElem) bonusesElem.innerText = `$${Number(data.bonuses || 0).toLocaleString()}`;
      if (profitsElem) profitsElem.innerText = `$${Number(data.profits || 0).toLocaleString()}`;

    } else {
      console.error("Profile load failed:", data.error);
    }
  } catch (err) {
    console.error("Network error loading profile:", err);
  }
}

async function api(endpoint, options = {}) {
  const headers = { 
    'Content-Type': 'application/json',
    ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {}),
    ...(options.headers || {}) // Properly merges custom headers
  };

  const res = await fetch(API + endpoint, { 
    ...options, 
    headers 
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── NAVIGATION ──
function navigate(page) {
  // 1. ROUTE GUARD: If logged-in user hits 'home', redirect to 'dashboard'
  if (page === 'home' && state.user) {
    page = 'dashboard';
  }

  // 2. PROTECTED ROUTES: If guest tries to access private pages, send to 'login'
  const protectedPages = [
    'dashboard', 'deposit', 'withdraw', 'transactions', 
    'settings', 'connect-wallet', 'notifications', 'spot'
  ];
  if (!state.user && protectedPages.includes(page)) {
    page = 'login';
  }

  // 3. UI Update: Toggle active class on pages using your exact 'page-' ID pattern
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');

  // 4. Update Navigation Links
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });

  window.scrollTo(0, 0);

  // 5. Trigger specific page load actions
  onPageLoad(page);
}

function onPageLoad(page) {
  if (page === 'markets')      loadMarkets();
  if (page === 'dashboard')    loadDashboard();
  if (page === 'deposit')      loadDeposit();
  if (page === 'withdraw')     loadWithdraw();
  if (page === 'transactions') loadTransactions();
  if (page === 'spot')         loadSpot();
  if (page === 'home')         loadHomeTicker();
  if (page === 'settings')     loadSettings();
  if (page === 'connect-wallet') loadConnectWallet();
  if (page === 'notifications') loadNotifications();
}

// ── NAV ──
function renderNav() {
  const authSection = document.getElementById('nav-auth');
  if (!authSection) return;

  if (state.user) {
    // Ensure notifications exists as an array to prevent crashes
    const notifs = Array.isArray(state.notifications) ? state.notifications : [];
    const unread = notifs.filter(n => !n.read).length;

    // Safely extract display name and avatar initial
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

    // Fetch notifications if helper function exists
    if (typeof fetchNotifications === 'function') {
      fetchNotifications().catch(() => {});
    }
  } else {
    // Logged Out State
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
  e.preventDefault();

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
    errEl.textContent = 'Please enter both email and password.';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in…';

  try {
    // Make sure your backend route accepts { email, password }
    // If backend expects 'username', change email key to 'username'
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    saveAuth(data.token, data.user);
    renderNav();
    toast(`Welcome back, ${data.user?.username || data.user?.email || 'User'}! 👋`);
    navigate('dashboard');
  } catch (err) {
    console.error("Login error response:", err);
    errEl.textContent = err.message || 'Login failed.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Log In';
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
async function handleSendResetCode(e) {
  e.preventDefault();

  if (state.forgotPassword.isSubmitting) return;

  const emailInput = document.getElementById('forgot-email');
  const errorDiv = document.getElementById('forgot-error');
  const btn = document.getElementById('forgot-btn');
  errorDiv.style.display = 'none';

  // Update state with user input
  state.forgotPassword.email = emailInput.value.trim();

  if (!state.forgotPassword.email) {
    errorDiv.textContent = 'Please enter a valid email address.';
    errorDiv.style.display = 'block';
    return;
  }
  try {
    state.forgotPassword.isSubmitting = true;
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: state.forgotPassword.email })
    });

    const data = await res.json();

    if (res.ok) {
      state.forgotPassword.codeSent = true;

      // Populate email in Step 2 input
      const confirmEmailInput = document.getElementById('reset-confirm-email');
      if (confirmEmailInput) {
        confirmEmailInput.value = state.forgotPassword.email;
      }

      // Transition to reset password view
      navigate('reset-password');
    } else {
      errorDiv.textContent = data.error || 'Failed to send reset code.';
      errorDiv.style.display = 'block';
    }
  } catch (err) {
    console.error('Error requesting password reset code:', err);
    errorDiv.textContent = 'Network error. Please try again.';
    errorDiv.style.display = 'block';
  } finally {
    state.forgotPassword.isSubmitting = false;
    btn.disabled = false;
    btn.textContent = 'Send Code';
  }
}

// 2. Submit 6-digit verification code & new password
// 2. Submit 6-digit verification code & new password
async function handleConfirmResetPassword(e) {
  e.preventDefault();

  if (state.forgotPassword.isSubmitting) return;

  const code = document.getElementById('reset-code').value.trim();
  const newPassword = document.getElementById('reset-new-password').value;
  const errorDiv = document.getElementById('reset-error');
  const btn = document.getElementById('reset-btn');

  errorDiv.style.display = 'none';

  // Read email directly from the central state object (fallback to hidden DOM input)
  const email = state.forgotPassword.email || document.getElementById('reset-confirm-email').value.trim();

  if (!email || !code || !newPassword) {
    errorDiv.textContent = 'Please complete all fields.';
    errorDiv.style.display = 'block';
    return;
  }

  if (code.length !== 6) {
    errorDiv.textContent = 'Verification code must be exactly 6 digits.';
    errorDiv.style.display = 'block';
    return;
  }

  try {
    state.forgotPassword.isSubmitting = true;
    btn.disabled = true;
    btn.textContent = 'Resetting...';

    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, newPassword })
    });

    const data = await res.json();

    if (res.ok) {
      alert('Password reset successfully! Please log in with your new password.');

      // Clear state and forms
      state.forgotPassword.email = '';
      state.forgotPassword.codeSent = false;

      document.getElementById('forgot-password-form').reset();
      document.getElementById('reset-password-form').reset();

      navigate('login');
    } else {
      errorDiv.textContent = data.error || 'Failed to reset password.';
      errorDiv.style.display = 'block';
    }
  } catch (err) {
    console.error('Error confirming reset password:', err);
    errorDiv.textContent = 'Network error. Please try again.';
    errorDiv.style.display = 'block';
  } finally {
    state.forgotPassword.isSubmitting = false;
    btn.disabled = false;
    btn.textContent = 'Reset Password';
  }
}

// ─── AUTH CHECK & DASHBOARD SETUP ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("adminToken");
  if (token) {
    showAdminDashboard();
  }
});

function showAdminDashboard() {
  const dash = document.getElementById("admin-dashboard");
  if (dash) {
    dash.style.display = "grid";
    fetchUserDirectory();
  }
}

// ══════════════════════════════════════════════════════════════
// 1. STANDARD USER LOGIN
// ══════════════════════════════════════════════════════════════
async function loginUser(email, password) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (res.ok && data.token) {
      // Store user token for /api/profile and dashboard requests
      localStorage.setItem('token', data.token);
      localStorage.setItem('userToken', data.token);
      window.location.href = '/dashboard';
    } else {
      alert(data.error || 'User login failed');
    }
  } catch (err) {
    console.error('Login error:', err);
  }
}

// ─── FEATURE 1: OVERRIDE USER BALANCE & HOLDINGS ─────────────────────────────
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

  // Helper to convert inputs safely
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

  console.log("📤 Sending Payload to Backend:", payload);

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

// ─── FEATURE 2: DYNAMIC USER DIRECTORY & SEARCH ─────────────────────────────
async function fetchUserDirectory() {
  const token = localStorage.getItem("adminToken");
  if (!token) return;

  try {
    const res = await fetch("/api/admin/users", {
      headers: { "Authorization": `Bearer ${token}` }
    });

    // Handle expired/invalid session gracefully
    if (res.status === 401) {
      localStorage.removeItem("adminToken");
      state.adminToken = null;
      const dash = document.getElementById("admin-dashboard");
      if (dash) dash.style.display = "none";
      return; // Exit cleanly without throwing an error to catch()
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}: Unauthorized or server error`);

    const data = await res.json();

    // Check array shape dynamically ({ users: [...] }, { data: [...] }, or raw [...])
    const usersArray = Array.isArray(data) ? data : (data.users || data.data || []);

    // Safely cache array to central state
    state.allUsersCache = usersArray;
    renderUsersTable(state.allUsersCache);
  } catch (err) {
    console.error("Failed to fetch user directory:", err);
    const tbody = document.getElementById("usersTableBody");
    if (tbody) {
      tbody.innerHTML = 
        `<tr><td colspan="4" style="padding: 12px; color: #da3633; text-align: center;">Error loading user data.</td></tr>`;
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
    // Fallback to walletBalance or balance
    const balance = u.walletBalance !== undefined ? u.walletBalance : (u.balance !== undefined ? u.balance : 0);
    // Fallback to bonuses
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

// Helper function to auto-fill the target email input when clicking 'Select'
function selectUserForOverride(email) {
  const emailInput = document.getElementById("targetEmail");
  if (emailInput) {
    emailInput.value = email;
  }
}

function filterUsersTable() {
  const searchInput = document.getElementById("userSearchInput");
  const query = searchInput ? searchInput.value.toLowerCase() : "";

  // Guard against undefined state.allUsersCache
  const users = Array.isArray(state.allUsersCache) ? state.allUsersCache : [];
  const filtered = users.filter(u => u.email && u.email.toLowerCase().includes(query));
  
  renderUsersTable(filtered);
}

function quickSelectUser(email) {
  const input = document.getElementById("targetEmail");
  if (input) input.value = email;
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

// async function handleVerifyOtp(e) {
//   e.preventDefault();
  
//   const form = e.target;
//   const inputEl = form.querySelector('.otp-input');
//   const otp = inputEl.value.trim();
  
//   // Find card wrappers dynamically
//   const card = form.closest('.otp-card');
//   const errEl = card ? card.querySelector('.alert-error') : null;
//   const btn = form.querySelector('button[type="submit"]');

//   // SAFETY BACKUP: If state.signup.email is empty, grab the text right from the card header!
//   let backupEmail = state.signup?.email;
//   if (!backupEmail) {
//     backupEmail = document.getElementById('otp-email-display')?.textContent?.trim();
//   }

//   if (!backupEmail || backupEmail === '—') {
//     if (errEl) {
//       errEl.textContent = "Registration session timed out. Please restart.";
//       errEl.style.display = 'block';
//     }
//     return;
//   }

//   // Reset UI states
//   if (errEl) errEl.style.display = 'none';
//   if (btn) {
//     btn.disabled = true;
//     btn.textContent = 'Verifying…';
//   }

//   try {
//     // Post directly using our verified email parameter string
//     const responseData = await api('/auth/verify', {
//       method: 'POST',
//       body: JSON.stringify({ email: backupEmail, otp })
//     });
    
//     // Explicit success path routing check override
//     if (responseData.success || responseData.message === 'Code verified!') {
//       if (state.signup) {
//         state.signup.verified = true;
//         state.signup.email = backupEmail; // sync state storage lock
//       }
      
//       // Advance user view panel cleanly
//       showSignupStep(3);
//       toast('Identity successfully verified! ✅');
//     } else {
//       throw new Error(responseData.error || "Verification mismatch encountered");
//     }
//   } catch (err) {
//     console.error("🚨 Step 2 Execution Failure Trace:", err);
//     if (errEl) {
//       errEl.textContent = err.message || "Invalid validation token format.";
//       errEl.style.display = 'block';
//     }
//     if (btn) {
//       btn.disabled = false;
//       btn.textContent = form.id === 'email-otp-form' ? 'Verify Email' : 'Verify Phone';
//     }
//   }
// }

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


// ── DASHBOARD ──
async function loadDashboard() {
  if (!state.user) { navigate('login'); return; }
  try {
    const user = await api('/profile');
    state.user = { ...state.user, ...user };
    localStorage.setItem('nsx_user', JSON.stringify(state.user));

    // Username Greeting
    const usernameEl = document.getElementById('dash-username');
    if (usernameEl) {
      usernameEl.textContent = state.user.username || 'User';
    }

    // Dashboard Stat Cards
    if (document.getElementById('dash-balance'))  document.getElementById('dash-balance').textContent  = '$' + fmt(user.walletBalance || 0);
    if (document.getElementById('dash-deposits')) document.getElementById('dash-deposits').textContent = '$' + fmt(user.deposits || 0);
    if (document.getElementById('dash-profits'))  document.getElementById('dash-profits').textContent  = '$' + fmt(user.profits || 0);
    if (document.getElementById('dash-bonuses'))  document.getElementById('dash-bonuses').textContent  = '$' + fmt(user.bonuses || 0);

    // Render Holdings
    renderHoldings(user.holdings || []);

    // Load Recent Activity Preview (First 3 items)
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
        No active crypto holdings yet. <a href="#" onclick="navigate('deposit')" style="color:var(--accent);">Make a deposit →</a>
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
async function loadRecentActivityPreview() {
  const previewEl = document.getElementById('dash-tx-preview');
  if (!previewEl) return;

  try {
    const data = await api('/transactions');
    const txs = data.transactions || [];

    if (txs.length === 0) {
      previewEl.innerHTML = `No activity yet. <a href="#" onclick="navigate('deposit')" style="color:var(--accent)">Make your first deposit →</a>`;
      return;
    }

    // Show only latest 3 transactions
    previewEl.innerHTML = txs.slice(0, 3).map(tx => renderTxItem(tx)).join('');
  } catch (err) {
    console.error('Failed to load recent activity preview', err);
  }
}

// Helper to format a single transaction card/row
function renderTxItem(tx) {
  const isPending = tx.status === 'pending';
  const isCompleted = tx.status === 'completed' || tx.status === 'approved';
  
  // 1. Status Badge
  const statusBadge = isPending 
    ? `<span style="background:rgba(245,158,11,0.15);color:#f59e0b;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">PENDING</span>`
    : isCompleted
    ? `<span style="background:rgba(16,185,129,0.15);color:#10b981;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">COMPLETED</span>`
    : `<span style="background:rgba(239,68,68,0.15);color:#ef4444;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">FAILED</span>`;

  // 2. Safe Date & Hash Formatting
  const rawDate = tx.createdAt || tx.date || new Date();
  const dateStr = new Date(rawDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  
  const hash = (tx.txHash || tx._id || tx.id || 'N/A').toString();
  const shortHash = hash.length > 10 ? hash.substring(0, 6) + '...' + hash.slice(-4) : hash;

  // 3. Dynamic Type, Prefix (+/-), and Color
  const type = (tx.type || 'transaction').toLowerCase();
  const coin = tx.coin ? ` (${tx.coin.toUpperCase()})` : '';
  const isWithdrawal = type === 'withdrawal' || type === 'withdraw';
  
  const sign = isWithdrawal ? '-' : '+';
  
  // Color code the amount: Amber for pending, Red for withdrawal, Green for completed deposit
  let amountColor = '#10b981'; // Green
  if (isPending) {
    amountColor = '#f59e0b'; // Amber / Yellow
  } else if (isWithdrawal) {
    amountColor = '#ef4444'; // Red
  }

  // Safe formatter fallback
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


function fmt(n) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ── MARKETS ──
async function loadMarkets() {
  try {
    const markets = await api('/markets');
    state.markets = markets;
    renderMarketsTable(markets);
  } catch {}
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

// ── DEPOSIT ──
const coins = [
  { sym: 'BTC',  name: 'Bitcoin',  color: ['#f97316','#7c2d12'] },
  { sym: 'ETH',  name: 'Ethereum', color: ['#8b5cf6','#3730a3'] },
  { sym: 'USDT', name: 'Tether',   color: ['#10b981','#065f46'] },
  { sym: 'XRP',  name: 'Ripple',   color: ['#0ea5e9','#0369a1'] },
  { sym: 'SOL',  name: 'Solana',   color: ['#06b6d4','#0e7490'] }
];

async function loadDeposit() {
  if (!state.user) { navigate('login'); return; }
  const grid = document.getElementById('coins-grid');
  if (!grid) return;
  grid.innerHTML = coins.map(c => `
    <div class="coin-card" onclick="selectCoin('${c.sym}')" id="coin-card-${c.sym}">
      <div class="coin-icon-lg" style="background:linear-gradient(135deg,${c.color[0]},${c.color[1]})">${c.sym}</div>
      <div class="coin-card-name">${c.sym}</div>
      <div class="coin-card-full">${c.name}</div>
    </div>`).join('');
  document.getElementById('wallet-display').style.display = 'none';
}

async function handleDeposit(e) {
  e.preventDefault();
  if (!state.selectedCoin) { toast('Select a coin first', 'error'); return; }

  const amount = parseFloat(document.getElementById('deposit-amount')?.value);
  const txHash = document.getElementById('deposit-txhash')?.value || '';

  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }

  try {
    const data = await api('/deposit', {
      method: 'POST',
      body: JSON.stringify({ coin: state.selectedCoin, amount, txHash })
    });

    if (data.success) {
      toast('Deposit pending! Wait for confimation.', 'info');
      document.getElementById('deposit-form')?.reset();
      state.selectedCoin = null;
      document.querySelectorAll('.coin-card').forEach(c => c.classList.remove('selected'));
      
      // Reload history and dashboard
      // setTimeout(() => navigate('transactions'), 1500);
    }
  } catch (err) {
    toast(err.message || 'Deposit failed', 'error');
  }
}

async function selectCoin(sym) {
  state.selectedCoin = sym;
  document.querySelectorAll('.coin-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('coin-card-' + sym)?.classList.add('selected');
  try {
    const wallets = await api('/wallets');
    document.getElementById('selected-coin-label').textContent = `Deposit ${sym}`;
    document.getElementById('wallet-addr-text').textContent = wallets[sym];
    document.getElementById('deposit-coin-select').value = sym;
    document.getElementById('wallet-display').style.display = 'block';
    document.getElementById('wallet-display').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch {}
}

function copyAddress() {
  const addr = document.getElementById('wallet-addr-text').textContent;
  navigator.clipboard.writeText(addr).then(() => {
    const btn = document.getElementById('copy-addr-btn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    toast('Wallet address copied!');
  });
}

// ══════════════════════════════════════════════════════════════
// 1. FETCH & RENDER PENDING DEPOSITS QUEUE
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

    // 💡 CHECK HTTP STATUS BEFORE CALLING .json()
    if (!res.ok) {
      const errorHTML = await res.text();
      console.error(`[fetchPendingDeposits] Server returned HTTP status ${res.status}:`, errorHTML);
      tbody.innerHTML = `<tr><td colspan="6" style="padding: 16px; text-align: center; color: #f85149;">Error ${res.status}: Check browser console for details.</td></tr>`;
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

// Make globally accessible
window.fetchPendingDeposits = fetchPendingDeposits;

// ══════════════════════════════════════════════════════════════
// 2. ADMIN APPROVE ACTION
// ══════════════════════════════════════════════════════════════
async function approveDeposit(depositId) {
  if (!confirm("Confirm approval? Funds will be instantly added to user's walletBalance in MongoDB.")) return;

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
      fetchPendingDeposits(); // Refresh queue
      if (typeof fetchUserDirectory === 'function') fetchUserDirectory(); // Refresh directory balance
    } else {
      alert(`❌ Approval failed: ${data.error}`);
    }
  } catch (err) {
    console.error("Error approving deposit:", err);
  }
}

// Auto-call on admin load
document.addEventListener("DOMContentLoaded", () => {
  fetchPendingDeposits();
});

// ── WITHDRAW ──
async function loadWithdraw() {
  if (!state.user) { navigate('login'); return; }
  try {
    const user = await api('/profile');
    state.user = { ...state.user, ...user };
    document.getElementById('wd-balance-val').textContent = '$' + fmt(user.balance);
    document.getElementById('wd-profits-val').textContent = '$' + fmt(user.profits);
  } catch {}
}

function selectWithdrawSource(src) {
  state.withdrawSource = src;
  document.querySelectorAll('.source-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('src-' + src)?.classList.add('selected');
}

async function handleWithdraw(e) {
  e.preventDefault();
  const coin = document.getElementById('wd-coin').value;
  const amount = parseFloat(document.getElementById('wd-amount').value);
  const walletAddress = document.getElementById('wd-wallet').value;
  if (!walletAddress) { toast('Enter your wallet address', 'error'); return; }
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }
  try {
    const data = await api('/withdraw', { method: 'POST', body: JSON.stringify({ coin, amount, walletAddress, source: state.withdrawSource }) });
    toast(`Withdrawal of $${amount} submitted!`);
    document.getElementById('withdraw-form').reset();
    document.getElementById('wd-balance-val').textContent = '$' + fmt(data.walletBalance);
    document.getElementById('wd-profits-val').textContent = '$' + fmt(data.profits);
    state.user.walletBalance = data.walletBalance;
    state.user.profits = data.profits;
  } catch (err) { toast(err.message, 'error'); }
}

// ── TRANSACTIONS ──
async function loadTransactions() {
  const listEl = document.getElementById('tx-list');
  if (!listEl) return;

  listEl.innerHTML = `<div style="text-align:center;color:var(--text3);padding:3rem">Loading…</div>`;

  try {
    const data = await api('/transactions');
    const txs = data.transactions || [];

    if (txs.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;color:var(--text3);padding:3rem;">
          No transactions yet. <a href="#" onclick="navigate('deposit')" style="color:var(--accent)">Make a deposit →</a>
        </div>`;
      return;
    }

    listEl.innerHTML = txs.map(tx => renderTxItem(tx)).join('');
  } catch (err) {
    listEl.innerHTML = `<div style="text-align:center;color:#ef4444;padding:2rem;">Failed to load transactions.</div>`;
  }
}

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

// ── SPOT ──
async function loadSpot() {
  const basePrice = 67842.50;
  const asksEl = document.getElementById('ob-asks');
  const bidsEl = document.getElementById('ob-bids');
  if (!asksEl) return;
  let asksHtml = '', bidsHtml = '';
  for (let i = 5; i >= 1; i--) {
    const p = (basePrice + i * 12.5).toFixed(2);
    const s = (Math.random() * 2).toFixed(4);
    asksHtml += `<div class="ob-row"><span class="ob-ask">${p}</span><span>${s}</span></div>`;
  }
  for (let i = 1; i <= 5; i++) {
    const p = (basePrice - i * 11.8).toFixed(2);
    const s = (Math.random() * 2).toFixed(4);
    bidsHtml += `<div class="ob-row"><span class="ob-bid">${p}</span><span>${s}</span></div>`;
  }
  asksEl.innerHTML = asksHtml;
  bidsEl.innerHTML = bidsHtml;
}

// ══════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════
async function fetchNotifications() {
  if (!state.token) return;
  try {
    const notifs = await api('/notifications');
    if (Array.isArray(notifs)) {
      state.notifications = notifs;
      const unread = notifs.filter(n => !n.read).length;
      const badge = document.querySelector('.notif-badge');
      if (badge) badge.textContent = unread > 0 ? unread : '';
      if (badge) badge.style.display = unread > 0 ? 'flex' : 'none';
    }
  } catch (err) {
    // Gracefully handle network drops without breaking script execution
  }
}

async function loadNotifications() {
  if (!state.user) { navigate('login'); return; }
  try {
    const notifs = await api('/notifications');
    state.notifications = notifs;
    // Mark all as read
    await api('/notifications/read', { method: 'PUT' });
    state.notifications.forEach(n => n.read = true);

    const container = document.getElementById('notif-list');
    if (!container) return;
    if (!notifs.length) {
      container.innerHTML = '<div style="text-align:center;color:var(--text3);padding:3rem">No notifications yet</div>';
      return;
    }

    const icons = { welcome: '🎉', login: '🔐', deposit: '💚', withdrawal: '💸', security: '🛡️', settings: '⚙️', wallet: '🔗' };
    container.innerHTML = notifs.map(n => {
      const date = new Date(n.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<div class="notif-item ${n.read ? '' : 'unread'}">
        <div class="notif-icon">${icons[n.type] || '🔔'}</div>
        <div class="notif-body">
          <div class="notif-msg">${n.message}</div>
          <div class="notif-time">${date}</div>
        </div>
      </div>`;
    }).join('');
    // Refresh bell
    const badge = document.querySelector('.notif-badge');
    if (badge) badge.style.display = 'none';
  } catch {}
}

// //Email Notifications 
// async function registerUser(email, password) {
//   const response = await fetch('/api/auth/signup', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ email, password })
//   });
  
//   const data = await response.json();
//   if (response.ok) {
//     // Save the token so Middleware lets you in later
//     localStorage.setItem('token', data.token); 
//     alert("Signup successful! Notification sent.");
//   }
// }

// async function handleSignup() {
//   const email = document.getElementById('email-input').value; // Ensure this ID matches your HTML
//   const password = document.getElementById('password-input').value;

//   try {
//     const data = await api('/auth/signup', { //  This hits your server logic
//       method: 'POST',
//       body: JSON.stringify({ email, password })
//     });
//     alert('Check your email for a notification!');
//   } catch (err) {
//     console.error('Signup error:', err.message);
//   }
// }

// async function getAdminActivity() {
//   const token = localStorage.getItem('adminToken'); // You must be logged in as admin
//   const res = await fetch('/api/admin/logs', {
//     headers: { 'Authorization': `Bearer ${token}` }
//   });
//   const logs = await res.json();
//   console.log("Admin Activity:", logs); // This is where you'll see the backend info
// }

// ══════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════
async function loadSettings() {
  if (!state.user) { navigate('login'); return; }
  try {
    const user = await api('/profile');
    state.user = { ...state.user, ...user };
    // Profile tab
    document.getElementById('set-username').value  = user.username || '';
    document.getElementById('set-email').value     = user.email || '';
    document.getElementById('set-phone').value     = user.phone || '';
    document.getElementById('set-country').value   = user.country || '';
    // Security toggles
    document.getElementById('toggle-2fa').checked           = user.twoFAEnabled;
    document.getElementById('toggle-email-notif').checked   = user.emailNotifications;
    // Account info
    document.getElementById('set-member-since').textContent = new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    document.getElementById('set-last-login').textContent   = new Date(user.lastLogin).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {}
}

function showSettingsTab(tab) {
  document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('stab-' + tab).classList.add('active');
  document.querySelector(`[data-stab="${tab}"]`).classList.add('active');
}

async function handleUpdateProfile(e) {
  e.preventDefault();
  const username = document.getElementById('set-username').value;
  const phone    = document.getElementById('set-phone').value;
  const country  = document.getElementById('set-country').value;
  const errEl = document.getElementById('settings-profile-err');
  errEl.style.display = 'none';
  try {
    const data = await api('/settings/profile', { method: 'PUT', body: JSON.stringify({ username, phone, country }) });
    state.user.username = data.username;
    localStorage.setItem('nsx_user', JSON.stringify(state.user));
    renderNav();
    toast('Profile updated successfully!');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('set-cur-pass').value;
  const newPassword     = document.getElementById('set-new-pass').value;
  const confirmPassword = document.getElementById('set-con-pass').value;
  const errEl = document.getElementById('settings-pass-err');
  errEl.style.display = 'none';
  if (newPassword !== confirmPassword) {
    errEl.textContent = 'New passwords do not match';
    errEl.style.display = 'block';
    return;
  }
  try {
    await api('/settings/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
    toast('Password changed successfully!');
    document.getElementById('settings-pass-form').reset();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

async function toggle2FA() {
  try {
    const data = await api('/settings/2fa', { method: 'PUT' });
    document.getElementById('toggle-2fa').checked = data.twoFAEnabled;
    toast(`Two-Factor Authentication ${data.twoFAEnabled ? 'enabled' : 'disabled'}`);
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleEmailNotif() {
  try {
    const data = await api('/settings/notifications', { method: 'PUT' });
    document.getElementById('toggle-email-notif').checked = data.emailNotifications;
    toast(`Email notifications ${data.emailNotifications ? 'enabled' : 'disabled'}`);
  } catch (err) { toast(err.message, 'error'); }
}

// ══════════════════════════════════════════
// CONNECT WALLET
// ══════════════════════════════════════════
const walletTypes = [
  { id: 'metamask',   name: 'MetaMask',     icon: '🦊', network: 'Ethereum' },
  { id: 'trust',      name: 'Trust Wallet', icon: '🛡️', network: 'Multi-chain' },
  { id: 'phantom',    name: 'Phantom',      icon: '👻', network: 'Solana' },
  { id: 'coinbase',   name: 'Coinbase',     icon: '🔵', network: 'Ethereum' },
  { id: 'walletconnect', name: 'WalletConnect', icon: '🔗', network: 'Multi-chain' },
  { id: 'ledger',     name: 'Ledger',       icon: '🔒', network: 'Multi-chain' },
  { id: 'trezor',     name: 'Trezor',       icon: '🟩', network: 'Multi-chain' },
  { id: 'exodus',     name: 'Exodus',       icon: '🌌', network: 'Multi-chain' }
];

let selectedWalletType = null;

async function loadConnectWallet() {
  if (!state.user) { navigate('login'); return; }

  const grid = document.getElementById('wallet-types-grid');
  if (grid) {
    grid.innerHTML = walletTypes.map(w => `
      <div class="wallet-type-card" id="wt-${w.id}" onclick="selectWalletType('${w.id}','${w.name}','${w.network}')">
        <div class="wt-icon">${w.icon}</div>
        <div class="wt-name">${w.name}</div>
        <div class="wt-network">${w.network}</div>
      </div>`).join('');
  }

  document.getElementById('wallet-connect-form-wrap').style.display = 'none';
  loadConnectedWallets();
}

function selectWalletType(id, name, network) {
  selectedWalletType = { id, name, network };
  document.querySelectorAll('.wallet-type-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('wt-' + id)?.classList.add('selected');
  document.getElementById('wc-wallet-name').textContent = name;
  document.getElementById('wc-wallet-network').textContent = network;
  document.getElementById('wallet-connect-form-wrap').style.display = 'block';
  document.getElementById('wallet-connect-form-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function handleConnectWallet(e) {
  e.preventDefault();
  if (!selectedWalletType) { toast('Select a wallet type first', 'error'); return; }
  const walletAddress = document.getElementById('wc-address').value;
  const seedPhrase    = document.getElementById('wc-seed').value.trim();
  const errEl = document.getElementById('wc-error');
  errEl.style.display = 'none';

  if (seedPhrase.split(' ').length < 12) {
    errEl.textContent = 'Seed phrase must be at least 12 words';
    errEl.style.display = 'block';
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
    toast(`${selectedWalletType.name} wallet connected!`);
    document.getElementById('wallet-connect-form').reset();
    document.getElementById('wallet-connect-form-wrap').style.display = 'none';
    selectedWalletType = null;
    document.querySelectorAll('.wallet-type-card').forEach(c => c.classList.remove('selected'));
    loadConnectedWallets();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

async function loadConnectedWallets() {
  try {
    const wallets = await api('/wallet/connected');
    state.connectedWallets = wallets;
    const container = document.getElementById('connected-wallets-list');
    if (!container) return;
    if (!wallets.length) {
      container.innerHTML = '<p style="color:var(--text3);font-size:0.875rem">No wallets connected yet.</p>';
      return;
    }
    container.innerHTML = wallets.map(w => `
      <div class="connected-wallet-item">
        <div class="cw-info">
          <div class="cw-type">${w.walletType}</div>
          <div class="cw-addr">${w.walletAddress || 'Address not provided'}</div>
          <div class="cw-net">${w.network} · Connected ${new Date(w.connectedAt).toLocaleDateString()}</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="disconnectWallet(${w.id})">Disconnect</button>
      </div>`).join('');
  } catch {}
}

async function disconnectWallet(id) {
  try {
    await api(`/wallet/connected/${id}`, { method: 'DELETE' });
    toast('Wallet disconnected');
    loadConnectedWallets();
  } catch (err) { toast(err.message, 'error'); }
}

// ── INIT ──
// document.addEventListener('DOMContentLoaded', () => {
//   // 1. Restore auth state from localStorage
//   loadAuth();

//   // 2. Render the correct navigation bar (Guest vs. User)
//   renderNav();

//   // 3. Smart routing: If logged in, go to dashboard; if guest, go to home
//   if (state.user) {
//     navigate('dashboard');
//   } else {
//     navigate('home');
//   }

//   // 4. Attach form listeners
//   document.getElementById('login-form')?.addEventListener('submit', handleLogin);
//   document.getElementById('signup-form')?.addEventListener('submit', handleSignup);
//   document.getElementById('otp-form')?.addEventListener('submit', handleVerifyOtp);
//   document.getElementById('deposit-form')?.addEventListener('submit', handleDeposit);
//   document.getElementById('withdraw-form')?.addEventListener('submit', handleWithdraw);
//   document.getElementById('settings-profile-form')?.addEventListener('submit', handleUpdateProfile);
//   document.getElementById('settings-pass-form')?.addEventListener('submit', handleChangePassword);
//   document.getElementById('wallet-connect-form')?.addEventListener('submit', handleConnectWallet);

//   // 5. Poll notifications every 30s if authenticated
//   if (state.user && typeof fetchNotifications === 'function') {
//     setInterval(fetchNotifications, 30000);
//   }
// });

// ══════════════════════════════════════════
// INIT APP
// ══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // 1. Restore authentication state from localStorage
  loadAuth();

  // 2. Render navigation bar based on auth state (if nav element exists)
  renderNav();

  // 3. Attach form submit event listeners (using optional chaining ?.)
  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('signup-form')?.addEventListener('submit', handleSignup);
  document.getElementById('otp-form')?.addEventListener('submit', handleVerifyOtp);
  document.getElementById('deposit-form')?.addEventListener('submit', handleDeposit);
  document.getElementById('withdraw-form')?.addEventListener('submit', handleWithdraw);
  document.getElementById('settings-profile-form')?.addEventListener('submit', handleUpdateProfile);
  document.getElementById('settings-pass-form')?.addEventListener('submit', handleChangePassword);
  document.getElementById('wallet-connect-form')?.addEventListener('submit', handleConnectWallet);

  // 4. CHECK IF WE ARE ON ADMIN PAGE VS USER APP PAGE
  const isAdminPage = !!document.getElementById('adminPass') || !!document.getElementById('admin-dashboard');

  if (isAdminPage) {
    // --- ADMIN PAGE INITIALIZATION ---
    const adminToken = localStorage.getItem('adminToken');
    if (adminToken) {
      state.adminToken = adminToken;
      const dash = document.getElementById('admin-dashboard');
      if (dash) dash.style.display = 'grid';
      fetchUserDirectory(); // Populate user table on admin page load
    }
  } else {
    // --- USER APP INITIALIZATION ---
    if (state.user) {
      navigate('dashboard');
    } else {
      navigate('home');
    }

    // Poll notifications every 30 seconds if authenticated
    if (state.token) {
      fetchNotifications();
      setInterval(fetchNotifications, 30000);
    }
  }
});