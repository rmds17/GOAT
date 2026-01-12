const ACCOUNT_STORAGE_KEY = 'goatAccount';
const DONE_STATUS_KEYWORDS = ['done', 'concluida', 'concluída', 'completed'];
let currentAccount = null;
let accountLoaded = false;

function refreshCurrentAccount() {
  try {
    const stored = sessionStorage.getItem(ACCOUNT_STORAGE_KEY);
    currentAccount = stored ? JSON.parse(stored) : null;
  } catch (err) {
    console.warn('Não foi possível ler a sessão atual:', err);
    currentAccount = null;
  }
  accountLoaded = true;
  updateAdminLinkVisibility();
}

function getCurrentAccount() {
  if (!accountLoaded) {
    refreshCurrentAccount();
  }
  return currentAccount;
}

function isCurrentUserAdmin() {
  return Boolean(getCurrentAccount()?.isAdmin);
}

function getAuthHeaders() {
  const account = getCurrentAccount();
  if (!account || !account.email || !account.passwordHash) {
    return {};
  }
  return {
    'X-Goat-Email': account.email,
    'X-Goat-Secret': account.passwordHash
  };
}

function isWorkOrderDone(wo) {
  if (!wo) return false;
  if (wo.completed) return true;
  if (!wo.status) return false;
  const normalized = wo.status.toString().trim().toLowerCase();
  return DONE_STATUS_KEYWORDS.includes(normalized);
}

function updateAdminLinkVisibility() {
  const adminLink = document.getElementById('admin-link');
  if (!adminLink) return;
  adminLink.style.display = isCurrentUserAdmin() ? '' : 'none';
}

// ======== Airtable via API do nosso servidor ========
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function listWorkOrders() {
  const json = await api('/api/workorders');
  return json.items || [];
}

async function createWorkOrder(data) {
  const json = await api('/api/workorders', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  return json.item;
}

async function updateWorkOrder(id, patch) {
  const json = await api(`/api/workorders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
  return json.item;
}

async function removeWorkOrder(id) {
  await api(`/api/workorders/${encodeURIComponent(id)}`, { method: 'DELETE' });
}


// ===== UI de OT =====
async function renderList() {
  const list = document.getElementById('wo-list');
  const empty = document.getElementById('wo-empty');
  if (!list || !empty) return;
  list.innerHTML = '';
  let items = [];
  try { items = await listWorkOrders(); } catch (e) { console.error(e); }

  if (!items.length) {
    empty.style.display = 'block';
    window.dispatchEvent(new CustomEvent('workorders:updated', { detail: [] }));
    return;
  }
  empty.style.display = 'none';

  items.forEach(wo => {
    const li = document.createElement('li');
    li.className = 'wo';
    if (isWorkOrderDone(wo)) {
      li.classList.add('done');
    }
    const titleText = (wo.title && wo.title.trim()) ? wo.title : `OT ${wo.code}`;
    li.innerHTML = `
      <div class="wo-head">
        <span class="code">${wo.code}</span>
        <span class="title">${titleText}</span>
      </div>
      <div class="wo-meta">
        <span>Prioridade: ${wo.priority}</span>
        ${wo.dueDate ? `<span>Limite: ${wo.dueDate.slice(0,10)}</span>` : ''}
        ${wo.asset ? `<span>Ativo: ${wo.asset}</span>` : ''}
        ${wo.elementId ? `<span>Element ID: ${wo.elementId}</span>` : ''}
        ${wo.status ? `<span>Status: ${wo.status}</span>` : ''}
        ${typeof wo.completed === 'boolean' ? `<span>Terminada: ${wo.completed ? 'Sim' : 'Não'}</span>` : ''}
      </div>
      ${wo.description ? `<p class="desc">${wo.description}</p>` : ''}
      <div class="actions">
        <button type="button" data-action="focus" class="ghost">Ver no modelo</button>
        <button type="button" data-action="delete" class="danger">Apagar</button>
      </div>
    `;
    li.querySelector('[data-action="focus"]').onclick = (e) => {
      e.preventDefault();
      if (!wo.elementId) {
        alert('Esta OT não tem Element ID associado.');
        return;
      }
      window.dispatchEvent(new CustomEvent('workorders:focus', { detail: { elementId: wo.elementId, id: wo.id } }));
    };
    li.querySelector('[data-action="delete"]').onclick = async () => {
      if (confirm(`Apagar ${wo.code}?`)) {
        try { await removeWorkOrder(wo.id); renderList(); } catch(e){ console.error(e); }
      }
    };
    list.appendChild(li);
  });

  window.dispatchEvent(new CustomEvent('workorders:updated', { detail: items }));
}

function initForm() {
  const form = document.getElementById('wo-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('f-title').value.trim();
    const priority = document.getElementById('f-priority').value;
    const dueDate = document.getElementById('f-due').value;
    const asset = document.getElementById('f-asset').value.trim();
    const elementId = document.getElementById('f-element-id').value.trim();
    const description = document.getElementById('f-desc').value.trim();
    try {
      const wo = await createWorkOrder({
        title,
        priority,
        dueDate,
        asset,
        description,
        elementId
      });
      form.reset();
      document.getElementById('picked-gid').textContent = '—';
      document.getElementById('picked-type').textContent = '—';
      picked = { globalId:'', type:'' };
      await renderList();
      alert(`OT criada: ${wo.code}`);
    } catch (e) {
      console.error(e);
      alert('Erro a criar OT.');
    }
  });
}

function hookSelectedElementToForm() {
  const elementIdInput = document.getElementById('f-element-id');
  if (!elementIdInput) return;

  window.addEventListener('viewer:selection', (event) => {
    const detail = event.detail || {};
    if (!detail || detail.hasSelection === false) return;
    const selectedElementId = detail.elementId;
    if (!selectedElementId) return;
    elementIdInput.value = selectedElementId;
  });
}

// arrancar
window.addEventListener('DOMContentLoaded', () => {
  refreshCurrentAccount();
  initForm();
  hookSelectedElementToForm();
  renderList();
});
