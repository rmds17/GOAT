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

// ===== Viewer IFC =====
let viewer;
let picked = { globalId: '', type: '' };

function initViewer() {
  const container = document.getElementById('viewer-container');
  viewer = new window.IfcViewerAPI.IfcViewerAPI({
    container,
    backgroundColor: new Uint8Array([240, 242, 245])
  });
  viewer.axes.setAxes();
  viewer.grid.setGrid();

  // duplo clique para apanhar elemento
  container.addEventListener('dblclick', async () => {
    const res = await viewer.pickIfcItem(true);
    if (!res) return;
    const { modelID, id } = res; // expressID
    try {
      const props = await viewer.IFC.getProperties(modelID, id, true);
      picked.globalId = (props.GlobalId && props.GlobalId.value) || '';
      picked.type = props.type || (props.Name && props.Name.value) || 'IFC Element';
      document.getElementById('picked-gid').textContent = picked.globalId || '—';
      document.getElementById('picked-type').textContent = picked.type || '—';
    } catch (e) { console.warn(e); }
  });
}

async function loadIFC(file) {
  if (!file) return;
  document.getElementById('file-name').textContent = file.name;
  await viewer.IFC.setWasmPath('https://unpkg.com/web-ifc@0.0.47/');
  await viewer.loadIfc(await file.arrayBuffer(), true);
  viewer.context.renderer.postProduction.active = true;
}

// ===== UI de OT =====
async function renderList() {
  const list = document.getElementById('wo-list');
  const empty = document.getElementById('wo-empty');
  list.innerHTML = '';
  let items = [];
  try { items = await listWorkOrders(); } catch (e) { console.error(e); }

  if (!items.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  items.forEach(wo => {
    const li = document.createElement('li');
    li.className = 'wo' + (wo.status === 'Done' ? ' done' : '');
    li.innerHTML = `
      <div class="wo-head">
        <span class="code">${wo.code}</span>
        <span class="title">${wo.title || ''}</span>
      </div>
      <div class="wo-meta">
        <span>Status: ${wo.status}</span>
        <span>Prioridade: ${wo.priority}</span>
        ${wo.dueDate ? `<span>Limite: ${wo.dueDate.slice(0,10)}</span>` : ''}
        ${wo.asset ? `<span>Ativo: ${wo.asset}</span>` : ''}
        ${wo.componentGlobalId ? `<span>Elem: ${wo.componentGlobalId}</span>` : ''}
      </div>
      ${wo.description ? `<p class="desc">${wo.description}</p>` : ''}
      <div class="actions">
        <button data-action="toggle">${wo.status === 'Done' ? 'Reabrir' : 'Concluir'}</button>
        <button data-action="delete" class="danger">Apagar</button>
      </div>
    `;
    li.querySelector('[data-action="toggle"]').onclick = async () => {
      const next = wo.status === 'Done' ? 'New' : 'Done';
      try { await updateWorkOrder(wo.id, { status: next }); renderList(); } catch(e){ console.error(e); }
    };
    li.querySelector('[data-action="delete"]').onclick = async () => {
      if (confirm(`Apagar ${wo.code}?`)) {
        try { await removeWorkOrder(wo.id); renderList(); } catch(e){ console.error(e); }
      }
    };
    list.appendChild(li);
  });
}

function initForm() {
  const form = document.getElementById('wo-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('f-title').value.trim();
    const priority = document.getElementById('f-priority').value;
    const dueDate = document.getElementById('f-due').value;
    const asset = document.getElementById('f-asset').value.trim();
    const description = document.getElementById('f-desc').value.trim();
    try {
      const wo = await createWorkOrder({
        title, priority, dueDate, asset, description,
        componentGlobalId: picked.globalId || '',
        componentType: picked.type || '',
        status: 'New'
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

function initFileInput() {
  const input = document.getElementById('ifc-file');
  input.addEventListener('change', (e) => loadIFC(e.target.files?.[0]));
}

// arrancar
window.addEventListener('DOMContentLoaded', () => {
  initViewer();
  initForm();
  initFileInput();
  renderList();
});
