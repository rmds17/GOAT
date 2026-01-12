const ACCOUNT_STORAGE_KEY = 'goatAccount';
const ADMIN_OVERRIDE_KEY = 'goatAdminOverride';
const DONE_STATUS_KEYWORDS = ['done', 'concluida', 'concluída', 'concluido', 'concluído', 'completed'];
const DEFAULT_DONE_LABEL = 'Concluída';

let cachedAccount = null;

function readStoredAccount() {
  if (cachedAccount) return cachedAccount;
  try {
    const raw = sessionStorage.getItem(ACCOUNT_STORAGE_KEY);
    cachedAccount = raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn('Não foi possível interpretar a sessão guardada:', err);
    cachedAccount = null;
  }
  return cachedAccount;
}

function isAdminAccount(account) {
  return Boolean(account && account.isAdmin);
}

function getOverrideEmail() {
  try {
    const raw = sessionStorage.getItem(ADMIN_OVERRIDE_KEY);
    return raw ? raw.toLowerCase() : '';
  } catch (err) {
    console.warn('Erro a ler override de admin:', err);
    return '';
  }
}

function setOverrideEmail(email) {
  try {
    if (email) {
      sessionStorage.setItem(ADMIN_OVERRIDE_KEY, email.toLowerCase());
    } else {
      sessionStorage.removeItem(ADMIN_OVERRIDE_KEY);
    }
  } catch (err) {
    console.warn('Erro a escrever override admin:', err);
  }
}

function hasAdminOverride() {
  return Boolean(getOverrideEmail());
}

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const account = readStoredAccount();
  if (account && account.email && account.passwordHash) {
    headers['X-Goat-Email'] = account.email;
    headers['X-Goat-Secret'] = account.passwordHash;
  }
  const overrideEmail = getOverrideEmail();
  if (overrideEmail) {
    headers['X-Goat-Admin-Override'] = overrideEmail;
  }
  return headers;
}

function hasDoneStatus(value) {
  if (!value) return false;
  const normalized = value.toString().trim().toLowerCase();
  return DONE_STATUS_KEYWORDS.includes(normalized);
}

function isWorkOrderDone(item) {
  if (!item) return false;
  if (item.completed) return true;
  return hasDoneStatus(item.status);
}

async function fetchWorkOrders() {
  const res = await fetch('/api/workorders');
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data?.error || `HTTP_${res.status}`);
  }
  return data.items || [];
}

async function markWorkOrderDone(id, overrideStatus) {
  const headers = getAuthHeaders();
  const body = overrideStatus ? { status: overrideStatus } : {};
  const res = await fetch(`/api/workorders/${encodeURIComponent(id)}/done`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    const code = data?.error || `HTTP_${res.status}`;
    const err = new Error(code);
    err.code = code;
    throw err;
  }
  return data.item;
}

function setWarning(message) {
  const warning = document.getElementById('admin-warning');
  const wrapper = document.getElementById('admin-list-wrapper');
  if (!warning || !wrapper) return;
  if (message) {
    warning.textContent = message;
    warning.style.display = 'block';
    wrapper.style.display = 'none';
  } else {
    warning.textContent = '';
    warning.style.display = 'none';
  }
}

function setListVisible(visible) {
  const wrapper = document.getElementById('admin-list-wrapper');
  if (!wrapper) return;
  wrapper.style.display = visible ? 'flex' : 'none';
}

function renderList(items) {
  const listEl = document.getElementById('admin-list');
  const countEl = document.getElementById('admin-count');
  if (!listEl || !countEl) return;

  if (!Array.isArray(items) || !items.length) {
    listEl.innerHTML = '<em>Não existem OT registadas.</em>';
    countEl.textContent = '';
    return;
  }

  const openItems = items.filter(item => !isWorkOrderDone(item));
  countEl.textContent = `${openItems.length} por concluir de um total de ${items.length}`;

  listEl.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('article');
    li.className = 'wo-admin';
    if (isWorkOrderDone(item)) li.classList.add('done');

    const meta = [
      `Prioridade: ${item.priority || '—'}`,
      item.dueDate ? `Limite: ${item.dueDate.slice(0, 10)}` : null,
      item.asset ? `Ativo: ${item.asset}` : null,
      item.elementId ? `Element ID: ${item.elementId}` : null,
      item.status ? `Status: ${item.status}` : null,
      typeof item.completed === 'boolean' ? `Terminada: ${item.completed ? 'Sim' : 'Não'}` : null
    ].filter(Boolean).map(value => `<span>${value}</span>`).join('');

    li.innerHTML = `
      <div class="wo-admin-head">
        <span class="wo-admin-code">${item.code}</span>
        <span class="wo-admin-title">${(item.title && item.title.trim()) ? item.title : `OT ${item.code}`}</span>
      </div>
      <div class="wo-admin-meta">${meta}</div>
      ${item.description ? `<p>${item.description}</p>` : ''}
      ${isWorkOrderDone(item) ? '' : '<div class="wo-admin-actions"><button type="button" class="success" data-action="done">Marcar concluída</button></div>'}
    `;

    const doneBtn = li.querySelector('[data-action="done"]');
    if (doneBtn) {
      doneBtn.addEventListener('click', async () => {
        if (!confirm(`Marcar ${item.code} como concluída?`)) return;
        doneBtn.disabled = true;
        try {
          await markWorkOrderDone(item.id, DEFAULT_DONE_LABEL);
          await loadAndRender();
        } catch (err) {
          alert('Não foi possível concluir esta OT.');
          console.error(err);
        } finally {
          doneBtn.disabled = false;
        }
      });
    }

    listEl.appendChild(li);
  });
}

async function loadAndRender() {
  try {
    setWarning('');
    setListVisible(true);
    const listEl = document.getElementById('admin-list');
    if (listEl) {
      listEl.innerHTML = '<em>A carregar...</em>';
    }
    const items = await fetchWorkOrders();
    renderList(items);
  } catch (err) {
    console.error('Erro a obter OTs:', err);
    setWarning('Não foi possível carregar as OTs. Tenta novamente mais tarde.');
    setListVisible(false);
  }
}

function hasAdminPermission() {
  return hasAdminOverride();
}

function refreshGateVisibility() {
  const gate = document.getElementById('admin-gate');
  if (!gate) return;
  if (hasAdminPermission()) {
    gate.style.display = 'none';
  } else {
    gate.style.display = '';
    setListVisible(false);
  }
}

async function handleGateSubmit(event) {
  event.preventDefault();
  const emailInput = document.getElementById('admin-gate-email');
  const messageBox = document.getElementById('admin-gate-message');
  if (!emailInput || !messageBox) return;

  const email = (emailInput.value || '').trim().toLowerCase();
  if (!email) {
    messageBox.textContent = 'Indica um email válido.';
    messageBox.style.display = 'block';
    messageBox.className = 'message error';
    return;
  }

  try {
    messageBox.textContent = 'A validar...';
    messageBox.style.display = 'block';
    messageBox.className = 'message';
    const res = await fetch('/api/admin/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      throw new Error(data?.error || `HTTP_${res.status}`);
    }
    setOverrideEmail(email);
    messageBox.style.display = 'none';
    refreshGateVisibility();
    setWarning('');
    setListVisible(true);
    loadAndRender();
  } catch (err) {
    console.error('Admin gate validation failed:', err);
    messageBox.textContent = 'Email não autorizado para o painel.';
    messageBox.style.display = 'block';
    messageBox.className = 'message error';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setOverrideEmail('');
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (hasAdminPermission()) {
        loadAndRender();
      } else {
        setWarning('Confirma o email de administrador antes de continuar.');
      }
    });
  }

  const logoButton = document.getElementById('admin-logo');
  if (logoButton) {
    logoButton.addEventListener('click', () => {
      window.location.href = '/';
    });
  }

  const gateForm = document.getElementById('admin-gate-form');
  if (gateForm) {
    gateForm.addEventListener('submit', handleGateSubmit);
  }

  refreshGateVisibility();
  if (hasAdminPermission()) {
    setWarning('');
    loadAndRender();
  } else {
    setWarning('Confirma o email autorizado para ver esta lista.');
  }
});
