const API = '/api';

function getToken() { return sessionStorage.getItem('token'); }
function getUser() { return JSON.parse(sessionStorage.getItem('user') || 'null'); }
function setSession(token, user) {
  sessionStorage.setItem('token', token);
  sessionStorage.setItem('user', JSON.stringify(user));
}
function clearSession() { sessionStorage.removeItem('token'); sessionStorage.removeItem('user'); }

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (getToken()) headers['Authorization'] = `Bearer ${getToken()}`;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { clearSession(); showLogin(); throw new Error('Session expired'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? JSON.stringify(data.error) : 'Request failed');
  return data;
}

function showLogin() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('app-view').classList.add('hidden');
}

function showApp() {
  const user = getUser();
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  document.getElementById('who-name').textContent = user.name;
  document.getElementById('who-role').textContent = user.role.replace('_', ' ');

  ['admin-view', 'oc-view', 'dc-view'].forEach(id => document.getElementById(id).classList.add('hidden'));
  if (user.role === 'admin') { document.getElementById('admin-view').classList.remove('hidden'); loadAdmin(); }
  if (user.role === 'event_oc') { document.getElementById('oc-view').classList.remove('hidden'); loadOc(); }
  if (user.role === 'disciplinary') { document.getElementById('dc-view').classList.remove('hidden'); loadDc(); }
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    setSession(data.token, data.user);
    showApp();
  } catch (err) {
    errEl.textContent = 'Login failed. Check your credentials.';
  }
});

document.getElementById('logout-btn').addEventListener('click', () => { clearSession(); showLogin(); });

// ---------------- FORGOT PASSWORD ----------------
document.getElementById('forgot-link').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('forgot-view').classList.remove('hidden');
});
document.getElementById('back-to-login').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('forgot-view').classList.add('hidden');
  showLogin();
});
document.getElementById('forgot-submit-btn').addEventListener('click', async () => {
  const email = document.getElementById('forgot-email').value.trim();
  const msg = document.getElementById('forgot-msg');
  msg.style.color = 'var(--text-dim)';
  msg.textContent = 'Sending...';
  try {
    const data = await api('/auth/forgot-password', { method: 'POST', body: { email } });
    msg.textContent = data.message;
  } catch (err) {
    msg.textContent = 'Something went wrong. Try again.';
  }
});

// ---------------- ADMIN ----------------
async function loadAdmin() {
  const dash = await api('/admin/dashboard');
  document.getElementById('admin-stats').innerHTML = `
    <div><div class="stat">${dash.totalParticipants}</div><div class="stat-label">Total participants</div></div>
    <div><div class="stat">${dash.mainGateCheckins}</div><div class="stat-label">Main gate check-ins</div></div>
    <div><div class="stat">${dash.events.length}</div><div class="stat-label">Events</div></div>
  `;
  const tbody = document.getElementById('admin-events-table');
  tbody.innerHTML = dash.events.map(e => `
    <tr><td>${e.name}</td><td>${e.registered}</td><td>${e.checked_in}</td><td>${e.capacity ?? '-'}</td></tr>
  `).join('');

  const events = await api('/admin/events');
  document.getElementById('acc-event').innerHTML = events.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
}

document.getElementById('ev-create-btn').addEventListener('click', async () => {
  const name = document.getElementById('ev-name').value.trim();
  const venue = document.getElementById('ev-venue').value.trim();
  const capacity = Number(document.getElementById('ev-capacity').value) || undefined;
  const msg = document.getElementById('ev-msg');
  try {
    await api('/admin/events', { method: 'POST', body: { name, venue, capacity } });
    msg.textContent = 'Event created.'; msg.style.color = 'var(--green)';
    loadAdmin();
  } catch (err) { msg.textContent = 'Error: ' + err.message; msg.style.color = 'var(--red)'; }
});

document.getElementById('acc-role').addEventListener('change', (e) => {
  document.getElementById('acc-event-wrap').classList.toggle('hidden', e.target.value !== 'event_oc');
});

document.getElementById('acc-create-btn').addEventListener('click', async () => {
  const name = document.getElementById('acc-name').value.trim();
  const email = document.getElementById('acc-email').value.trim();
  const password = document.getElementById('acc-password').value;
  const role = document.getElementById('acc-role').value;
  const event_id = Number(document.getElementById('acc-event').value) || undefined;
  const msg = document.getElementById('acc-msg');
  try {
    await api('/admin/accounts', { method: 'POST', body: { name, email, password, role, event_id } });
    msg.textContent = 'Account created.'; msg.style.color = 'var(--green)';
  } catch (err) { msg.textContent = 'Error: ' + err.message; msg.style.color = 'var(--red)'; }
});

document.getElementById('csv-upload-btn').addEventListener('click', async () => {
  const file = document.getElementById('csv-file').files[0];
  const msg = document.getElementById('csv-msg');
  if (!file) { msg.textContent = 'Choose a CSV file first.'; return; }
  const fd = new FormData(); fd.append('file', file);
  try {
    const result = await api('/admin/participants/bulk-upload', { method: 'POST', body: fd });
    msg.textContent = `Created: ${result.created}, skipped (existing): ${result.skipped}, errors: ${result.errors.length}`;
    loadAdmin();
  } catch (err) { msg.textContent = 'Error: ' + err.message; msg.style.color = 'var(--red)'; }
});

document.getElementById('mail-all-btn').addEventListener('click', async () => {
  const msg = document.getElementById('csv-msg');
  msg.textContent = 'Sending...';
  try {
    const result = await api('/admin/participants/send-all-pending', { method: 'POST' });
    msg.textContent = `Sent: ${result.sent}, failed: ${result.failed}`;
  } catch (err) { msg.textContent = 'Error: ' + err.message; }
});

// ---------------- EVENT OC ----------------
async function loadOc() {
  const data = await api('/events/my-event/dashboard');
  document.getElementById('oc-event-name').textContent = data.event.name;
  document.getElementById('oc-registered').textContent = data.registered;
  document.getElementById('oc-checkedin').textContent = data.checkedIn;
  document.getElementById('oc-capacity').textContent = data.event.capacity ?? '—';
  document.getElementById('oc-checkin-table').innerHTML = data.checkinList.map(p => `
    <tr><td>${p.name}</td><td>${p.email}</td><td>${new Date(p.checked_in_at).toLocaleTimeString()}</td></tr>
  `).join('');
}

// ---------------- DISCIPLINARY ----------------
async function loadDc() {
  const data = await api('/disciplinary/overview');
  document.getElementById('dc-events-table').innerHTML = data.events.map(e => `
    <tr><td>${e.name}</td><td>${e.checked_in}</td><td>${e.capacity ?? '-'}</td></tr>
  `).join('');
  document.getElementById('dc-denials-table').innerHTML = data.recentDenials.map(d => `
    <tr><td>${d.name}</td><td>${d.event_name ?? 'main gate'}</td>
    <td><span class="badge ${d.status === 'success' ? 'ok' : d.status === 'duplicate' ? 'warn' : 'err'}">${d.status}</span></td>
    <td>${d.reason ?? ''}</td><td>${new Date(d.timestamp).toLocaleTimeString()}</td></tr>
  `).join('');
}

document.getElementById('inc-submit-btn').addEventListener('click', async () => {
  const participant_id = Number(document.getElementById('inc-participant').value) || undefined;
  const event_id = Number(document.getElementById('inc-event').value) || undefined;
  const severity = document.getElementById('inc-severity').value;
  const description = document.getElementById('inc-desc').value.trim();
  const msg = document.getElementById('inc-msg');
  try {
    await api('/disciplinary/incidents', { method: 'POST', body: { participant_id, event_id, severity, description } });
    msg.textContent = 'Incident filed.'; msg.style.color = 'var(--green)';
    document.getElementById('inc-desc').value = '';
  } catch (err) { msg.textContent = 'Error: ' + err.message; msg.style.color = 'var(--red)'; }
});

// ---------------- INIT ----------------
if (getToken() && getUser()) showApp(); else showLogin();
