const ACCOUNT_STORAGE_KEY = 'goatAccount';
const DONE_STATUS_KEYWORDS = ['done', 'concluida', 'concluída', 'completed'];
let currentAccount = null;
let accountLoaded = false;
let cachedWorkOrders = [];
let workOrderFilter = 'all';
let isModelReady = false;

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

function passesCurrentFilter(wo) {
  if (workOrderFilter === 'open') {
    return !isWorkOrderDone(wo);
  }
  if (workOrderFilter === 'done') {
    return isWorkOrderDone(wo);
  }
  return true;
}

function applyFilter(items = []) {
  return items.filter(passesCurrentFilter);
}

function updateEmptyStateElement(emptyEl, totalItems, filteredItems) {
  if (!emptyEl) return;
  if (totalItems === 0) {
    emptyEl.textContent = 'Ainda não há OTs.';
    emptyEl.style.display = 'block';
    return;
  }
  if (filteredItems === 0) {
    emptyEl.textContent = 'Nenhuma OT corresponde ao filtro selecionado.';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
}

function updateAdminLinkVisibility() {
  const adminLink = document.getElementById('admin-link');
  if (!adminLink) return;
  adminLink.style.display = '';
}

function setWorkOrderListLocked(locked) {
  const lockMessage = document.getElementById('wo-list-locked');
  const filterControls = document.getElementById('wo-filter-controls');
  const list = document.getElementById('wo-list');
  const empty = document.getElementById('wo-empty');
  if (lockMessage) {
    lockMessage.style.display = locked ? 'block' : 'none';
  }
  if (filterControls) {
    filterControls.style.display = locked ? 'none' : '';
  }
  if (list) {
    list.style.display = locked ? 'none' : '';
  }
  if (locked && empty) {
    empty.style.display = 'none';
  }
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
async function renderList(options = {}) {
  const { skipFetch = false } = options;
  const list = document.getElementById('wo-list');
  const empty = document.getElementById('wo-empty');
  if (!list || !empty) return;

  if (!isModelReady) {
    setWorkOrderListLocked(true);
    return;
  }

  setWorkOrderListLocked(false);
  list.innerHTML = '';
  if (!skipFetch || !cachedWorkOrders.length) {
    try {
      cachedWorkOrders = await listWorkOrders();
    } catch (e) {
      console.error(e);
      cachedWorkOrders = [];
    }
  }

  const sourceItems = Array.isArray(cachedWorkOrders) ? cachedWorkOrders : [];
  const filteredItems = applyFilter(sourceItems);
  updateEmptyStateElement(empty, sourceItems.length, filteredItems.length);

  if (!filteredItems.length) {
    window.dispatchEvent(new CustomEvent('workorders:updated', { detail: sourceItems }));
    return;
  }

  filteredItems.forEach(wo => {
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

  window.dispatchEvent(new CustomEvent('workorders:updated', { detail: sourceItems }));
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

function initWorkOrderFilters() {
  const radios = document.querySelectorAll('input[name="wo-status-filter"]');
  if (!radios || !radios.length) return;
  radios.forEach((radio) => {
    radio.addEventListener('change', (event) => {
      if (!event.target.checked) return;
      const { value } = event.target;
      workOrderFilter = value || 'all';
      renderList({ skipFetch: true });
    });
  });
}

// arrancar
window.addEventListener('DOMContentLoaded', () => {
  refreshCurrentAccount();
  initForm();
  hookSelectedElementToForm();
  initWorkOrderFilters();
  setWorkOrderListLocked(true);
});

window.addEventListener('viewer:model-ready', () => {
  if (isModelReady) return;
  isModelReady = true;
  setWorkOrderListLocked(false);
  renderList();
});
