// ======== APS 3D Viewer ========

let viewer;
let picked = { globalId: '', type: '' };

console.log('[APS] Script loaded');

// ---------------- TOKEN ----------------

async function getToken() {
  try {
    console.log('[APS] Requesting token...');
    const response = await fetch('/api/aps/token');
    console.log('[APS] Token response:', response.status);
    
    if (!response.ok) {
      const json = await response.json();
      throw new Error(json.error || `HTTP ${response.status}`);
    }
    const json = await response.json();
    console.log('[APS] Token received');
    return json.access_token;
  } catch (err) {
    console.error('[APS] Token error:', err);
    return null;
  }
}

// ---------------- UI HELPERS ----------------

// abre/fecha um grupo de propriedades (toggle)
function togglePropGroup(groupEl) {
  if (!groupEl) return;
  groupEl.classList.toggle('collapsed');
}

// mostra ou esconde o header "Item selecionado" + linha GlobalId/Tipo
function setSelectionUI(selected) {
  const propsPanel = document.getElementById('properties-list');
  if (!propsPanel) return;

  const panel = propsPanel.closest('.panel');
  if (!panel) return;

  const header = panel.querySelector('.panel-header');
  const summary = panel.querySelector('.selected-summary');

  if (selected) {
    if (header) header.style.display = 'none';
    if (summary) summary.style.display = 'none';
  } else {
    if (header) header.style.display = '';
    if (summary) summary.style.display = '';
  }
}

// ---------------- PROPRIEDADES ----------------

function updatePropertiesPanel(result, propsContainer) {
  if (!result) return;

  const props = result.properties || [];

  // GlobalId / IfcGUID / externalId
  const gidProp =
    props.find(p => p.displayName === 'GlobalId' || p.displayName === 'IfcGUID') || null;
  const globalId = gidProp
    ? gidProp.displayValue
    : (result.externalId || '');

  // Tipo (Type Name / Type / Tipo)
  const typeProp =
    props.find(p =>
      p.displayName === 'Type Name' ||
      p.displayName === 'Tipo' ||
      p.displayName === 'Type'
    ) || null;
  const typeName = typeProp
    ? typeProp.displayValue
    : (result.name || '');

  picked.globalId = globalId || '';
  picked.type = typeName || '';

  // --- General Info: Global ID, Tipo, ElementId, Category, CategoryId ---
  const generalProps = [];

  function addGeneralLabel(label, value) {
    if (value != null && value !== '') {
      generalProps.push({ label, value });
    }
  }

  // Global ID + Tipo primeiro
  addGeneralLabel('Global ID', globalId);
  addGeneralLabel('Tipo', typeName);

  // Depois Element ID, Category, Category ID vindos das propriedades
  function findProp(name) {
    return props.find(p => p.displayName === name && p.displayValue != null && p.displayValue !== '');
  }

  const elId = findProp('ElementId');
  const cat = findProp('Category');
  const catId = findProp('CategoryId');

  if (elId) addGeneralLabel('Element ID', elId.displayValue);
  if (cat) addGeneralLabel('Category', cat.displayValue);
  if (catId) addGeneralLabel('Category ID', catId.displayValue);

  // --- Agrupar restantes por categoria, excluindo grupos que não queremos ---
  const groups = {};

  for (const p of props) {
    const value = p.displayValue;
    if (value === '' || value == null) continue;

    const name = p.displayName;

    // já usados em General Info → não repetir
    if (name === 'ElementId' || name === 'Category' || name === 'CategoryId') continue;
    if (name === 'GlobalId' || name === 'IfcGUID' || name === 'Type Name' || name === 'Tipo' || name === 'Type') continue;

    const catName = p.displayCategory || 'Outros';

    // grupos a esconder
    if (
      catName === '__VIEWABLE_IN__' ||
      catName === '__INTERNALREF__' ||
      catName === '__PARENT__' ||
      catName === 'Graphics'
    ) {
      continue;
    }

    if (!groups[catName]) groups[catName] = [];
    groups[catName].push(p);
  }

  const catNames = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'pt'));

  // --- Construir HTML ---
  let html = '';

  // General Info (sempre aberta, sem toggle)
  if (generalProps.length) {
    html += `<div class="prop-group general-info">`;
    html += `<div class="prop-group-title">GENERAL INFO</div>`;
    html += `<div class="prop-group-body">`;

    for (const gp of generalProps) {
      html += `
        <div class="prop-row">
          <span class="prop-name">${gp.label}</span>
          <span class="prop-value">${gp.value}</span>
        </div>
      `;
    }

    html += `</div></div>`;
  }

  // Restantes grupos: começam todos colapsados
  for (const catName of catNames) {
    const list = groups[catName];
    if (!list || !list.length) continue;

    html += `<div class="prop-group collapsible collapsed">`;
    html += `
      <div class="prop-group-header" onclick="togglePropGroup(this.parentElement)">
        <span class="prop-group-title">${catName}</span>
        <span class="prop-group-arrow">▾</span>
      </div>
      <div class="prop-group-body">
    `;

    for (const p of list) {
      html += `
        <div class="prop-row">
          <span class="prop-name">${p.displayName}</span>
          <span class="prop-value">${p.displayValue}</span>
        </div>
      `;
    }

    html += `</div></div>`;
  }

  if (!html) {
    html = '<em>Sem propriedades visíveis.</em>';
  }

  propsContainer.innerHTML = html;

  console.log('[APS] Selected element:', {
    globalId: picked.globalId,
    type: picked.type,
    propsCount: props.length
  });
}

// ---------------- EVENTO DE SELEÇÃO ----------------

function onSelectionChanged(event) {
  const propsContainer = document.getElementById('properties-list');
  if (!propsContainer || !viewer) return;

  let dbId = null;

  if (event && Array.isArray(event.dbIdArray) && event.dbIdArray.length > 0) {
    dbId = event.dbIdArray[0];
  } else if (event && Array.isArray(event.nodeArray) && event.nodeArray.length > 0) {
    dbId = event.nodeArray[0];
  }

  // nada selecionado → voltar ao estado "default"
  if (!dbId) {
    picked.globalId = '';
    picked.type = '';
    setSelectionUI(false);
    propsContainer.innerHTML = '<em>Seleciona um elemento no modelo para ver as propriedades.</em>';
    return;
  }

  // há seleção → esconder header + resumo, mostrar abas
  setSelectionUI(true);

  viewer.getProperties(
    dbId,
    function (result) {
      updatePropertiesPanel(result, propsContainer);
    },
    function (err) {
      console.error('[APS] Erro em getProperties:', err);
      propsContainer.innerHTML = '<em>Não foi possível ler as propriedades.</em>';
    }
  );
}

// ---------------- INICIALIZAÇÃO DO VIEWER ----------------

async function initViewer() {
  try {
    console.log('[APS] Starting viewer initialization...');
    
    if (!window.Autodesk || !window.Autodesk.Viewing) {
      console.warn('[APS] Autodesk Viewing library not available yet');
      return;
    }

    const token = await getToken();
    if (!token) {
      console.error('[APS] No token available');
      return;
    }

    console.log('[APS] Token received, initializing viewer...');

    const options = {
      env: 'AutodeskProduction',
      accessToken: token
    };

    Autodesk.Viewing.Initializer(options, () => {
      try {
        const container = document.getElementById('viewerContainer');
        if (!container) {
          console.error('[APS] viewerContainer not found');
          return;
        }
        
        console.log('[APS] Creating viewer instance...');
        viewer = new Autodesk.Viewing.GuiViewer3D(container);
        viewer.start();
        console.log('[APS] Viewer started successfully');

        // evento de seleção
        viewer.addEventListener(
          Autodesk.Viewing.SELECTION_CHANGED_EVENT,
          onSelectionChanged
        );
      } catch (err) {
        console.error('[APS] Error during viewer initialization:', err);
      }
    });
  } catch (err) {
    console.error('[APS] Unexpected error:', err);
  }
}

// ---------------- LOAD DE MODELO ----------------

async function loadModel(urn) {
  if (!viewer) {
    console.error('[APS] Viewer not initialized');
    return;
  }

  const token = await getToken();
  if (!token) {
    console.error('[APS] No token available for loading model');
    return;
  }

  try {
    console.log('[APS] Loading model with URN:', urn);

    function base64urlEncode(str) {
      try {
        const b64 = btoa(str);
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      } catch (e) {
        console.error('[APS] base64 encoding failed:', e);
        return null;
      }
    }

    let finalUrn = urn;
    if (urn.startsWith('urn:')) {
      const after = urn.slice(4);
      if (!/^[A-Za-z0-9_-]+$/.test(after)) {
        const encoded = base64urlEncode(urn);
        if (!encoded) throw new Error('Failed to encode URN');
        finalUrn = `urn:${encoded}`;
        console.log('[APS] Encoded raw URN to:', finalUrn);
      } else {
        finalUrn = urn;
      }
    } else {
      if (/^[A-Za-z0-9_-]+$/.test(urn)) {
        finalUrn = `urn:${urn}`;
      } else {
        const encoded = base64urlEncode(urn);
        if (!encoded) throw new Error('Failed to encode URN');
        finalUrn = `urn:${encoded}`;
        console.log('[APS] Encoded raw URN to:', finalUrn);
      }
    }

    Autodesk.Viewing.Document.load(
      finalUrn,
      (doc) => {
        console.log('[APS] Document loaded, getting default geometry...');
        const viewable = doc.getRoot().getDefaultGeometry();
        console.log('[APS] Loading document node...');
        viewer.loadDocumentNode(doc, viewable);
        console.log('[APS] Model loaded successfully');
      },
      (error) => console.error('[APS] Error loading model:', error),
      null,
      null,
      { accessToken: token }
    );
  } catch (err) {
    console.error('[APS] Failed to load model:', err);
  }
}

// ---------------- UI: BOTÃO CARREGAR MODELO ----------------

function handleLoadModel() {
  const input = document.getElementById('f-urn');
  const urn = input.value.trim();
  
  if (!urn) {
    alert('Por favor, cole um URN válido');
    return;
  }
  
  console.log('[APS] User requested to load model with URN:', urn);
  loadModel(urn);
}

// ---------------- BOOTSTRAP ----------------

console.log('[APS] Waiting for page load...');
let initAttempts = 0;

document.addEventListener('DOMContentLoaded', () => {
  console.log('[APS] DOM loaded');
  
  const checkAutodesk = setInterval(() => {
    initAttempts++;
    console.log('[APS] Checking for Autodesk library (attempt ' + initAttempts + ')...');
    
    if (window.Autodesk && window.Autodesk.Viewing) {
      clearInterval(checkAutodesk);
      console.log('[APS] Autodesk library found');
      initViewer();
    }
  }, 500);

  setTimeout(() => {
    clearInterval(checkAutodesk);
    if (!window.Autodesk || !window.Autodesk.Viewing) {
      console.warn('[APS] Autodesk library did not load from CDN');
      console.warn('[APS] This might be a network issue or CDN is blocked');
    }
  }, 15000);
});
