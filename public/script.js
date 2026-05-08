// ── NexaSpc App ──
const API = '/api';

let state = {
  user: null,
  token: null,
  markets: [],
  transactions: [],
  selectedCoin: null,
  withdrawSource: 'balance'
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

// ── API CALLS ──
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
  if (page === 'markets') loadMarkets();
  if (page === 'dashboard') loadDashboard();
  if (page === 'deposit') loadDeposit();
  if (page === 'withdraw') loadWithdraw();
  if (page === 'transactions') loadTransactions();
  if (page === 'spot') loadSpot();
  if (page === 'home') loadHomeTicker();
}

// ── NAV RENDER ──
function renderNav() {
  const authSection = document.getElementById('nav-auth');
  if (state.user) {
    authSection.innerHTML = `
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
          <div class="dropdown-item" onclick="navigate('transactions')">📋 History</div>
          <div class="dropdown-item danger" onclick="logout()">🚪 Log Out</div>
        </div>
      </div>`;
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
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
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
    const data = await api('/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password })
    });
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
    document.getElementById('dash-balance').textContent = '$' + user.balance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    document.getElementById('dash-deposits').textContent = '$' + user.deposits.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    document.getElementById('dash-profits').textContent = '$' + user.profits.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    document.getElementById('dash-bonuses').textContent = '$' + user.bonuses.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  } catch {}
}

// ── MARKETS ──
async function loadMarkets() {
  try {
    const markets = await api('/markets');
    state.markets = markets;
    renderMarketsTable(markets);
    alert("Market function triggered!");
  } catch {err} {
    console.error("Failed to load markets:", err);
  }
}

function renderMarketsTable(markets) {
  const tbody = document.getElementById('markets-tbody');
  if (!tbody) return;
  const coinColors = {
    'BTC': ['#f97316','#7c2d12'], 'ETH': ['#8b5cf6','#3730a3'],
    'SOL': ['#06b6d4','#0e7490'], 'XRP': ['#0ea5e9','#0369a1'],
    'BNB': ['#eab308','#713f12'], 'ADA': ['#3b82f6','#1d4ed8'],
    'DOGE': ['#f59e0b','#92400e'], 'AVAX': ['#ef4444','#991b1b']
  };
  tbody.innerHTML = markets.map(m => {
    const sym = m.symbol.split('/')[0];
    const [c1, c2] = coinColors[sym] || ['#64748b','#334155'];
    const isUp = m.change >= 0;
    return `
      <tr>
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
    const tickerData = [...markets, ...markets];
    const el = document.getElementById('home-ticker');
    if (!el) return;
    el.innerHTML = tickerData.map(m => {
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
  { sym: 'BTC', name: 'Bitcoin', color: ['#f97316','#7c2d12'] },
  { sym: 'ETH', name: 'Ethereum', color: ['#8b5cf6','#3730a3'] },
  { sym: 'USDT', name: 'Tether', color: ['#10b981','#065f46'] },
  { sym: 'XRP', name: 'Ripple', color: ['#0ea5e9','#0369a1'] },
  { sym: 'SOL', name: 'Solana', color: ['#06b6d4','#0e7490'] }
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
    const addr = wallets[sym];
    document.getElementById('selected-coin-label').textContent = `Deposit ${sym}`;
    document.getElementById('wallet-addr-text').textContent = addr;
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
  if (!state.selectedCoin) { toast('Please select a coin first', 'error'); return; }
  const amount = parseFloat(document.getElementById('deposit-amount').value);
  const txHash = document.getElementById('deposit-txhash').value;
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }
  try {
    const data = await api('/deposit', {
      method: 'POST',
      body: JSON.stringify({ coin: state.selectedCoin, amount, txHash })
    });
    state.user.balance = data.balance;
    state.user.deposits = data.deposits;
    localStorage.setItem('nsx_user', JSON.stringify(state.user));
    toast(`Deposit of $${amount} confirmed! Balance updated.`);
    document.getElementById('deposit-form').reset();
    document.getElementById('wallet-display').style.display = 'none';
    state.selectedCoin = null;
    document.querySelectorAll('.coin-card').forEach(c => c.classList.remove('selected'));
    setTimeout(() => navigate('dashboard'), 1500);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── WITHDRAW ──
async function loadWithdraw() {
  if (!state.user) { navigate('login'); return; }
  try {
    const user = await api('/profile');
    state.user = { ...state.user, ...user };
    document.getElementById('wd-balance-val').textContent = '$' + user.balance.toFixed(2);
    document.getElementById('wd-profits-val').textContent = '$' + user.profits.toFixed(2);
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
  if (!walletAddress) { toast('Please enter your wallet address', 'error'); return; }
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }
  try {
    const data = await api('/withdraw', {
      method: 'POST',
      body: JSON.stringify({ coin, amount, walletAddress, source: state.withdrawSource })
    });
    toast(`Withdrawal of $${amount} submitted! Processing...`);
    document.getElementById('withdraw-form').reset();
    state.user.balance = data.balance;
    state.user.profits = data.profits;
    document.getElementById('wd-balance-val').textContent = '$' + data.balance.toFixed(2);
    document.getElementById('wd-profits-val').textContent = '$' + data.profits.toFixed(2);
  } catch (err) {
    toast(err.message, 'error');
  }
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
          <span class="tx-amount ${isDeposit ? 'up' : 'down'}">${isDeposit ? '+' : '-'}$${tx.amount.toFixed(2)}</span>
        </div>
      </div>`;
    }).join('');
  } catch {}
}

// ── SPOT ──
async function loadSpot() {
  // Generate mock orderbook
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

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  loadAuth();
  renderNav();
  navigate('home');
  loadHomeTicker();

  // Form listeners
  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('signup-form')?.addEventListener('submit', handleSignup);
  document.getElementById('deposit-form')?.addEventListener('submit', handleDeposit);
  document.getElementById('withdraw-form')?.addEventListener('submit', handleWithdraw);
});