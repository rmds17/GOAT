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
    li.innerHTML = `
      <div class="wo-head">
        <span class="code">${wo.code}</span>
        <span class="title">${wo.title || ''}</span>
      </div>
      <div class="wo-meta">
        <span>Prioridade: ${wo.priority}</span>
        ${wo.dueDate ? `<span>Limite: ${wo.dueDate.slice(0,10)}</span>` : ''}
        ${wo.asset ? `<span>Ativo: ${wo.asset}</span>` : ''}
        ${wo.elementId ? `<span>Element ID: ${wo.elementId}</span>` : ''}
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

// arrancar
window.addEventListener('DOMContentLoaded', () => {
  initForm();
  renderList();
});
