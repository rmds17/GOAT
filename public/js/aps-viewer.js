// ======== APS 3D Viewer ========

let viewer;
let picked = { globalId: '', type: '' };

console.log('[APS] Script loaded');

// Fetch token from backend
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

// Initialize the Autodesk Viewer
async function initViewer() {
  try {
    console.log('[APS] Starting viewer initialization...');
    
    // Check if Autodesk library is loaded
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

        // Setup selection handler to capture building elements
        viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, (event) => {
          if (event.dbIdArray && event.dbIdArray.length > 0) {
            const dbId = event.dbIdArray[0];
            
            // Get element properties
            viewer.getProperties(dbId, (props) => {
              const globalId = props.find(p => p.displayName === 'GlobalId');
              const type = props.find(p => p.displayName === 'IfcType' || p.displayName === 'Type');
              
              picked.globalId = globalId ? globalId.value : '';
              picked.type = type ? type.value : '';
              
              const gidEl = document.getElementById('picked-gid');
              const typeEl = document.getElementById('picked-type');
              if (gidEl) gidEl.textContent = picked.globalId || '—';
              if (typeEl) typeEl.textContent = picked.type || '—';
              
              console.log('[APS] Selected element:', { globalId: picked.globalId, type: picked.type });
            });
          }
        });
      } catch (err) {
        console.error('[APS] Error during viewer initialization:', err);
      }
    });
  } catch (err) {
    console.error('[APS] Unexpected error:', err);
  }
}

// Load a model from Autodesk (requires URN)
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

    // Helper: base64url-encode a string
    function base64urlEncode(str) {
      try {
        const b64 = btoa(str);
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      } catch (e) {
        console.error('[APS] base64 encoding failed:', e);
        return null;
      }
    }

    // Determine final URN in the form 'urn:<base64url>' which Viewer expects
    let finalUrn = urn;
    if (urn.startsWith('urn:')) {
      const after = urn.slice(4);
      // If the part after 'urn:' contains characters outside base64url, treat as raw and encode
      if (!/^[A-Za-z0-9_-]+$/.test(after)) {
        const encoded = base64urlEncode(urn);
        if (!encoded) throw new Error('Failed to encode URN');
        finalUrn = `urn:${encoded}`;
        console.log('[APS] Encoded raw URN to:', finalUrn);
      } else {
        finalUrn = urn; // already encoded
      }
    } else {
      // If user supplied only the base64url part, prefix with 'urn:'
      if (/^[A-Za-z0-9_-]+$/.test(urn)) {
        finalUrn = `urn:${urn}`;
      } else {
        // Raw string without prefix — encode entire string
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

// Handle URN input from UI
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

// Initialize on page load - with retries
console.log('[APS] Waiting for page load...');
let initAttempts = 0;
document.addEventListener('DOMContentLoaded', () => {
  console.log('[APS] DOM loaded');
  
  // Wait for Autodesk library to load from CDN
  const checkAutodesk = setInterval(() => {
    initAttempts++;
    console.log('[APS] Checking for Autodesk library (attempt ' + initAttempts + ')...');
    
    if (window.Autodesk && window.Autodesk.Viewing) {
      clearInterval(checkAutodesk);
      console.log('[APS] Autodesk library found');
      initViewer();
    }
  }, 500);

  // Timeout after 15 seconds
  setTimeout(() => {
    clearInterval(checkAutodesk);
    if (!window.Autodesk || !window.Autodesk.Viewing) {
      console.warn('[APS] Autodesk library did not load from CDN');
      console.warn('[APS] This might be a network issue or CDN is blocked');
    }
  }, 15000);
});
