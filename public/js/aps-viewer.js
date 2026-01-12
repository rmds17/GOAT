// ======== APS 3D Viewer ========

let viewer;
let picked = { globalId: '', type: '' };
let geometryReady = false;
let THREE_REF = null;
const elementIdDbIdCache = new Map();
const ELEMENT_ID_PROPERTY_NAMES = [
  'ElementId',
  'Element ID',
  'Element Id',
  'ElementID',
  'Revit Element Id',
  'Revit Element ID',
  'Id do elemento',
  'ID do elemento'
];
const ELEMENT_ID_FALLBACK_LIMIT = 25;
const ELEMENT_ID_PROPERTY_NORMALIZED = ELEMENT_ID_PROPERTY_NAMES.map(name => normalizePropertyName(name));
let pendingElementFocus = null;

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

// mostra/esconde o cabeçalho "Item selecionado" e a linha GlobalId / Tipo
function setSelectionUI(selected) {
  const propsContainer = document.getElementById('properties-list');
  if (!propsContainer) return;

  const panel = propsContainer.closest('.panel');
  if (!panel) return;

  const summary = panel.querySelector('.selected-summary');
  const gidEl = document.getElementById('picked-gid');
  const typeEl = document.getElementById('picked-type');

  const header = panel.querySelector('.panel-header');
  if (header) header.style.display = '';
  if (summary) summary.style.display = selected ? 'none' : '';

  if (!selected) {
    if (gidEl) gidEl.textContent = '—';
    if (typeEl) typeEl.textContent = '—';
  }
}

// ativa / desativa o painel de OTs consoante haja item selecionado
function setOTEnabled(enabled) {
  const locked = document.getElementById('ot-locked');
  const content = document.getElementById('ot-content');
  if (!locked || !content) return;

  if (enabled) {
    locked.style.display = 'none';
    content.style.display = '';
    content.style.opacity = '1';
  } else {
    locked.style.display = '';
    content.style.display = 'none';
    content.style.opacity = '0.4';
  }
}

function togglePropertiesPanel(collapsed) {
  const body = document.getElementById('properties-panel-body');
  const toggle = document.getElementById('properties-toggle');
  if (!body || !toggle) return;
  if (collapsed) {
    body.style.display = 'none';
    toggle.classList.add('collapsed');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Mostrar';
  } else {
    body.style.display = '';
    toggle.classList.remove('collapsed');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.textContent = 'Esconder';
  }
}

function broadcastViewerSelection(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent('viewer:selection', { detail }));
  } catch (err) {
    console.warn('[APS] Failed to broadcast viewer selection', err);
  }
}

// ---------------- ELEMENT FOCUS HELPERS ----------------

function getThreeRef() {
  if (THREE_REF) return THREE_REF;
  if (window.THREE) {
    THREE_REF = window.THREE;
    return THREE_REF;
  }
  if (window.Autodesk && window.Autodesk.Viewing && window.Autodesk.Viewing.THREE) {
    THREE_REF = window.Autodesk.Viewing.THREE;
    return THREE_REF;
  }
  return null;
}

function normalizePropertyName(name = '') {
  if (!name) return '';
  let normalized = String(name);
  if (typeof normalized.normalize === 'function') {
    normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return normalized.replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
}

function isMatchingElementIdPropertyName(name = '') {
  const normalized = normalizePropertyName(name);
  if (!normalized) return false;
  if (ELEMENT_ID_PROPERTY_NORMALIZED.includes(normalized)) return true;
  return ELEMENT_ID_PROPERTY_NORMALIZED.some(target => target && normalized.includes(target));
}

function findElementIdProperty(props = []) {
  return props.find(prop => isMatchingElementIdPropertyName(prop.displayName));
}

function extractNumericElementId(value) {
  if (value == null || value === '') return null;
  const numeric = Number(String(value).trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function viewerSearchAsync(term, attrNames) {
  return new Promise((resolve) => {
    viewer.search(
      term,
      (dbIds) => resolve(Array.isArray(dbIds) ? dbIds : []),
      () => resolve([]),
      attrNames && attrNames.length ? attrNames : undefined
    );
  });
}

function getPropertiesAsync(dbId) {
  return new Promise((resolve) => {
    viewer.getProperties(
      dbId,
      (result) => resolve(result || null),
      () => resolve(null)
    );
  });
}

async function searchSingleDbId(term, attrNames) {
  const matches = await viewerSearchAsync(term, attrNames);
  return matches.length ? matches[0] : null;
}

async function searchDbIdWithVerification(term, numericId) {
  const matches = await viewerSearchAsync(term);
  if (!matches.length) return null;

  const limit = Math.min(matches.length, ELEMENT_ID_FALLBACK_LIMIT);
  for (let i = 0; i < limit; i += 1) {
    const candidate = matches[i];
    const propsResult = await getPropertiesAsync(candidate);
    if (!propsResult || !Array.isArray(propsResult.properties)) continue;

    const prop = findElementIdProperty(propsResult.properties);
    const propNumericValue = extractNumericElementId(prop?.displayValue);
    if (prop && propNumericValue === numericId) {
      return candidate;
    }
  }

  return null;
}

async function fetchDbIdForElement(elementId) {
  const numericId = Number(elementId);
  if (!Number.isFinite(numericId)) return null;

  const searchTerm = String(numericId);
  const directMatch = await searchSingleDbId(searchTerm, ELEMENT_ID_PROPERTY_NAMES);
  if (directMatch != null) {
    elementIdDbIdCache.set(numericId, directMatch);
    return directMatch;
  }

  console.log('[APS] Element ID direct search failed, trying fallback scan for', numericId);
  const verifiedMatch = await searchDbIdWithVerification(searchTerm, numericId);
  elementIdDbIdCache.set(numericId, verifiedMatch ?? null);
  return verifiedMatch ?? null;
}

async function focusElementByElementId(elementId, options = {}) {
  if (!viewer || !geometryReady) {
    pendingElementFocus = elementId;
    return;
  }
  const numericId = Number(String(elementId).trim());
  if (!Number.isFinite(numericId) || numericId <= 0) {
    console.warn('[APS] Invalid Element ID provided:', elementId);
    return;
  }
  let dbId = elementIdDbIdCache.get(numericId);
  if (dbId === undefined) {
    console.log('[APS] Searching for Element ID', numericId);
    dbId = await fetchDbIdForElement(numericId);
  }
  if (!Number.isFinite(dbId) || dbId === null) {
    console.warn('[APS] No element found for Element ID', numericId);
    alert('Não encontrei o elemento com esse Element ID no modelo. Confirma se foi carregado o mesmo modelo.');
    return;
  }

  console.log('[APS] Focusing dbId', dbId, 'for Element ID', numericId);
  viewer.clearSelection();
  viewer.select([dbId]);
  if (options.fitToView !== false) {
    viewer.fitToView([dbId]);
  }
}

// ---------------- PROPRIEDADES ----------------

function updatePropertiesPanel(result, propsContainer, dbId) {
  if (!result) return null;

  const props = Array.isArray(result.properties) ? result.properties : [];

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

  function addGeneral(label, value) {
    if (value != null && value !== '') {
      generalProps.push({ label, value });
    }
  }

  // Global ID + Tipo primeiro
  addGeneral('Global ID', globalId);
  addGeneral('Tipo', typeName);

  // Depois Element ID, Category, Category ID vindos das propriedades
  function findProp(name) {
    return props.find(
      p => p.displayName === name &&
           p.displayValue != null &&
           p.displayValue !== ''
    );
  }

  const elementIdProp = findElementIdProperty(props);
  const cat = findProp('Category');
  const catId = findProp('CategoryId');

  if (elementIdProp) {
    addGeneral(elementIdProp.displayName || 'Element ID', elementIdProp.displayValue);
    const cachedValue = extractNumericElementId(elementIdProp.displayValue);
    if (dbId != null && cachedValue != null) {
      elementIdDbIdCache.set(cachedValue, dbId);
    }
  }
  if (cat) addGeneral('Category', cat.displayValue);
  if (catId) addGeneral('Category ID', catId.displayValue);

  // --- Agrupar restantes por categoria, excluindo grupos que não queremos ---
  const groups = {};

  for (const p of props) {
    const value = p.displayValue;
    if (value === '' || value == null) continue;

    const name = p.displayName;

    // já usados na General Info → não repetir
    if (
      name === 'ElementId' ||
      name === 'Category' ||
      name === 'CategoryId' ||
      name === 'GlobalId' ||
      name === 'IfcGUID' ||
      name === 'Type Name' ||
      name === 'Tipo' ||
      name === 'Type'
    ) {
      continue;
    }

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

  return elementIdProp ? elementIdProp.displayValue : null;
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

  // nada selecionado → estado default
  if (!dbId) {
    picked.globalId = '';
    picked.type = '';
    setSelectionUI(false);   // mostra “Item selecionado” normal
    setOTEnabled(false);     // bloqueia painel de OTs
    propsContainer.innerHTML =
      '<em>Seleciona um elemento no modelo para ver as propriedades.</em>';
    broadcastViewerSelection({ hasSelection: false });
    return;
  }

  // há seleção → esconder header “Item selecionado” e desbloquear OTs
  setSelectionUI(true);
  setOTEnabled(true);

  viewer.getProperties(
    dbId,
    function (result) {
      const elementIdValue = updatePropertiesPanel(result, propsContainer, dbId);
      const elementIdLabel = document.getElementById('picked-element-id');
      if (elementIdLabel) {
        elementIdLabel.textContent = elementIdValue ?? '—';
      }
      broadcastViewerSelection({
        hasSelection: true,
        dbId,
        elementId: elementIdValue ? String(elementIdValue).trim() : null,
        globalId: picked.globalId || null,
        type: picked.type || null
      });
    },
    function (err) {
      console.error('[APS] Erro em getProperties:', err);
      propsContainer.innerHTML = '<em>Não foi possível ler as propriedades.</em>';
      broadcastViewerSelection({ hasSelection: false });
    }
  );
}

window.addEventListener('workorders:focus', (event) => {
  const detail = event.detail || {};
  const elementId = detail.elementId || detail.ElementId || detail.element_id;
  if (!elementId) {
    alert('Esta OT não tem um Element ID associado.');
    return;
  }
  focusElementByElementId(elementId);
});


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

        const threeNs = getThreeRef();
        if (threeNs && viewer.setSelectionColor) {
          viewer.setSelectionColor(new threeNs.Color(0x2563eb));
        }

        viewer.addEventListener(
          Autodesk.Viewing.SELECTION_CHANGED_EVENT,
          onSelectionChanged
        );
        viewer.addEventListener(
          Autodesk.Viewing.GEOMETRY_LOADED_EVENT,
          () => {
            geometryReady = true;
            try {
              window.dispatchEvent(new CustomEvent('viewer:model-ready'));
            } catch (err) {
              console.warn('[APS] Failed to dispatch model-ready event', err);
            }
            if (pendingElementFocus) {
              const pending = pendingElementFocus;
              pendingElementFocus = null;
              focusElementByElementId(pending);
            }
          }
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
  const toggleButton = document.getElementById('properties-toggle');
  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
      togglePropertiesPanel(isExpanded);
    });
  } else {
    console.warn('[APS] properties toggle button not found');
  }
  togglePropertiesPanel(false);
  
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
  }, 20000);
});
