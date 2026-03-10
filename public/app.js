const authCard = document.getElementById('auth-card');
const panel = document.getElementById('panel');
const authForm = document.getElementById('auth-form');
const registerBtn = document.getElementById('register-btn');
const authMessage = document.getElementById('auth-message');
const welcome = document.getElementById('welcome');
const logoutBtn = document.getElementById('logout-btn');
const connectBtn = document.getElementById('connect-btn');
const confirmConnectBtn = document.getElementById('confirm-connect-btn');
const waStatus = document.getElementById('wa-status');
const qrCanvas = document.getElementById('qr-canvas');
const openWaLink = document.getElementById('open-wa-link');
const scheduleForm = document.getElementById('schedule-form');
const scheduleMessage = document.getElementById('schedule-message');
const scheduleList = document.getElementById('schedule-list');
const refreshBtn = document.getElementById('refresh-btn');

let qrPolling;

async function api(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro na requisição.');
  return data;
}

function setAuthenticated(user) {
  authCard.classList.add('hidden');
  panel.classList.remove('hidden');
  welcome.textContent = `Olá, ${user.username}`;
  startQrPolling();
  loadSchedules();
}

function setLoggedOut() {
  panel.classList.add('hidden');
  authCard.classList.remove('hidden');
  waStatus.textContent = 'Status: aguardando...';
  const ctx = qrCanvas.getContext('2d');
  ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
  clearInterval(qrPolling);
}

async function checkSession() {
  const session = await api('/api/session');
  if (session.authenticated) setAuthenticated(session.user);
  else setLoggedOut();
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    authMessage.textContent = '';
    setAuthenticated(data.user);
  } catch (err) { authMessage.textContent = err.message; }
});

registerBtn.addEventListener('click', async () => {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  try {
    const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ username, password }) });
    authMessage.textContent = '';
    setAuthenticated(data.user);
  } catch (err) { authMessage.textContent = err.message; }
});

logoutBtn.addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); setLoggedOut(); });
connectBtn.addEventListener('click', async () => { await api('/api/whatsapp/connect', { method: 'POST' }); await updateQrStatus(); });
confirmConnectBtn.addEventListener('click', async () => { await api('/api/whatsapp/confirm', { method: 'POST' }); await updateQrStatus(); loadSchedules(); });

async function updateQrStatus() {
  const status = await api('/api/whatsapp/status');
  openWaLink.href = status.openUrl;
  if (status.connected) {
    waStatus.textContent = 'Status: conectado ✅';
    qrCanvas.getContext('2d').clearRect(0, 0, qrCanvas.width, qrCanvas.height);
    return;
  }
  waStatus.textContent = 'Status: escaneie o QR e clique em "Já escaneei"';
  await QRCode.toCanvas(qrCanvas, status.qrData, { width: 260 });
}

function startQrPolling() {
  clearInterval(qrPolling);
  updateQrStatus();
  qrPolling = setInterval(updateQrStatus, 5000);
}

scheduleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    targetType: document.getElementById('target-type').value,
    target: document.getElementById('target').value,
    message: document.getElementById('message').value,
    scheduledAt: new Date(document.getElementById('scheduled-at').value).toISOString()
  };

  try {
    await api('/api/schedules', { method: 'POST', body: JSON.stringify(payload) });
    scheduleMessage.textContent = 'Mensagem agendada com sucesso!';
    scheduleForm.reset();
    loadSchedules();
  } catch (err) {
    scheduleMessage.textContent = err.message;
  }
});

refreshBtn.addEventListener('click', loadSchedules);

async function loadSchedules() {
  try {
    const data = await api('/api/schedules');
    if (!data.schedules.length) { scheduleList.innerHTML = '<p>Nenhum agendamento ainda.</p>'; return; }
    scheduleList.innerHTML = data.schedules.map((item) => `
      <div class="item">
        <strong>${item.targetType.toUpperCase()}:</strong> ${item.target}<br />
        <div>${item.message}</div>
        <div class="meta">Quando: ${new Date(item.scheduledAt).toLocaleString()} | Status: ${item.status}</div>
        ${item.sendUrl ? `<a href="${item.sendUrl}" target="_blank">Abrir envio no WhatsApp</a>` : ''}
        ${item.error ? `<div class="meta">Erro: ${item.error}</div>` : ''}
      </div>
    `).join('');
  } catch (err) { scheduleList.innerHTML = `<p>Erro ao carregar: ${err.message}</p>`; }
}

checkSession().catch(setLoggedOut);
