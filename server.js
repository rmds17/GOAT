// // const express = require('express');
// // const app = express();
// // const PORT = process.env.PORT || 3000;

// // app.get('/', (req, res) => {
// //   res.send('Hello World!');
// // });

// // app.listen(PORT, () => {
// //   console.log(`Server listening on port ${PORT}`);
// // });

// // Handles server startup and port binding
// const app = require('./app');
// const PORT = process.env.PORT || 3001;

// app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
// });

// const express = require('express');
// const session = require('cookie-session');
// const path = require('path');
// const { PORT, SERVER_SESSION_SECRET } = require('./config.js');

// let app = express();
// app.use(express.static('public'));
// app.use(session({ secret: SERVER_SESSION_SECRET, maxAge: 24 * 60 * 60 * 1000 }));
// app.use(require('../../src/routes/auth.js'));
// app.use(require('../../src/routes/data-management.js'));

// // Serve index.html at root
// app.get('/', (req, res) => {
//     res.sendFile(path.join(__dirname, 'public', 'html', 'index.html'));
// });

// app.listen(PORT, () => console.log(`Server listening on port ${PORT}...`));

// server.js
const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.static('public'));
app.use(express.json());


/* -------- APS: rota de token 2-legged -------- */
app.get('/api/aps/token', async (_req, res) => {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', process.env.APS_CLIENT_ID);
    params.append('client_secret', process.env.APS_CLIENT_SECRET);
    params.append('scope', 'data:read');

    console.log('Requesting APS token with client:', process.env.APS_CLIENT_ID?.substring(0, 5) + '...');
    const r = await fetch(
      'https://developer.api.autodesk.com/authentication/v2/token',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params }
    );
    const j = await r.json();
    if (!r.ok) {
      console.error('Token request failed:', j);
      throw new Error(JSON.stringify(j));
    }
    console.log('Token obtained successfully');
    // o viewer só precisa disto:
    res.json({ access_token: j.access_token, expires_in: j.expires_in });
  } catch (err) {
    console.error('APS token error:', err);
    res.status(500).json({ error: 'APS_TOKEN_FAILED', message: err.message });
  }
});

/* -------- APS: Get Viewable URN from GUID -------- */
app.post('/api/aps/guid-to-urn', async (req, res) => {
  try {
    const { guid } = req.body;
    if (!guid) return res.status(400).json({ error: 'GUID required' });

    console.log('Converting GUID to URN:', guid);
    
    // The GUID needs to be base64url encoded as a URN
    // Format: urn:adsk.objects:os.object:GUID
    const urn = `dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOiR7Z3VpZH0=`;
    
    // Actually, let's use the proper format
    const properUrn = Buffer.from(`urn:adsk.wipprod:fs.file:${guid}`).toString('base64url');
    
    res.json({ 
      urn: properUrn,
      originalGuid: guid,
      message: 'GUID converted to encoded URN'
    });
  } catch (err) {
    console.error('GUID conversion error:', err);
    res.status(500).json({ error: 'GUID_CONVERSION_FAILED', details: err.message });
  }
});
app.post('/api/aps/check', async (req, res) => {
  try {
    const { urn } = req.body;
    if (!urn) return res.status(400).json({ error: 'URN required' });

    console.log('Checking model URN:', urn);
    res.json({ 
      status: 'ready',
      urn: urn,
      message: 'Model URN is ready to load'
    });
  } catch (err) {
    console.error('APS check error:', err);
    res.status(500).json({ error: 'APS_CHECK_FAILED', details: err.message });
  }
});

// ---------- Airtable helpers ----------
app.post('/api/aps/get-urn', async (req, res) => {
  try {
    const { projectId, viewableGuid } = req.body;
    if (!projectId || !viewableGuid) {
      return res.status(400).json({ error: 'projectId and viewableGuid required' });
    }

    console.log('Getting viewable URN for project:', projectId, 'guid:', viewableGuid);
    
    // Get 2-legged token with data:read scope
    const tokenParams = new URLSearchParams();
    tokenParams.append('grant_type', 'client_credentials');
    tokenParams.append('client_id', process.env.APS_CLIENT_ID);
    tokenParams.append('client_secret', process.env.APS_CLIENT_SECRET);
    tokenParams.append('scope', 'data:read');

    const tokenRes = await fetch(
      'https://developer.api.autodesk.com/authentication/v2/token',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenParams }
    );
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;

    // Get project hub items
    const hubUrl = `https://developer.api.autodesk.com/data/v1/projects/${projectId}/items?filter[type]=folders`;
    const hubRes = await fetch(hubUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!hubRes.ok) {
      console.log('Hub lookup failed, returning GUID-based URN');
      // Fallback: construct URN from GUID
      const urn = `urn:adsk.viewing:fs.file:${viewableGuid}`;
      return res.json({ urn, source: 'guid-fallback' });
    }

    // For now, just return the GUID-based URN
    const urn = `urn:adsk.viewing:fs.file:${viewableGuid}`;
    res.json({ urn, source: 'guid' });
  } catch (err) {
    console.error('Get URN error:', err);
    res.status(500).json({ error: 'GET_URN_FAILED', details: err.message });
  }
});

// ---------- Airtable helpers ----------
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE_ID || process.env.AIRTABLE_TABLE_WORKORDERS;
const AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
const AIRTABLE_TABLE_PATH = `/${encodeURIComponent(AIRTABLE_TABLE)}`;
const AT_HEADERS = {
  'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
  'Content-Type': 'application/json'
};
const WORKORDER_FIELDS = {
  title: 'Título',
  priority: 'Prioridade',
  dueDate: 'Data Limite',
  asset: 'Ativo / Zona',
  description: 'Descrição'
};

async function airtableRequest(path, options = {}) {
  const resp = await fetch(`${AIRTABLE_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...AT_HEADERS,
      ...(options.headers || {})
    }
  });
  const text = await resp.text();
  if (!resp.ok) {
    console.error('Airtable request failed', resp.status, text);
    throw new Error(`AIRTABLE_HTTP_${resp.status}`);
  }
  return text ? JSON.parse(text) : {};
}

function buildSearchParams(params = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(v => searchParams.append(key, v));
    } else if (value !== undefined && value !== null) {
      searchParams.append(key, value);
    }
  });
  return searchParams;
}

async function fetchAllRecords(params = {}) {
  const records = [];
  let offset;
  do {
    const searchParams = buildSearchParams(params);
    if (offset) searchParams.set('offset', offset);
    const qs = searchParams.toString();
    const data = await airtableRequest(`${AIRTABLE_TABLE_PATH}${qs ? `?${qs}` : ''}`);
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records;
}

// tenta ler "Description" e, se não houver, "Short Description"
function getDescriptionField(fields) {
  return fields[WORKORDER_FIELDS.description] ?? fields['Description'] ?? fields['Short Description'] ?? '';
}
// quando gravar, escrevo nas duas chaves para ficar compatível com qualquer um dos nomes
function setDescriptionField(fieldsObj, value) {
  const safeValue = value ?? '';
  fieldsObj[WORKORDER_FIELDS.description] = safeValue;
  fieldsObj['Description'] = safeValue;
  fieldsObj['Short Description'] = safeValue;
}

// Mapear Airtable -> objeto GOAT
function mapRecord(r) {
  const f = r.fields || {};
  return {
    id: r.id,
    code: f['Code'] || '',
    title: f[WORKORDER_FIELDS.title] || f['Title'] || '',
    status: f['Status'] || 'New',
    priority: f[WORKORDER_FIELDS.priority] || f['Priority'] || 'Medium',
    dueDate: f[WORKORDER_FIELDS.dueDate] || f['Due Date'] || '',
    asset: f[WORKORDER_FIELDS.asset] || f['Asset'] || '',
    description: getDescriptionField(f),
    componentGlobalId: f['Component GlobalId'] || '',
    componentType: f['Component Type'] || '',
    createdAt: f['Created At'] || ''
  };
}

// --------- API ---------
app.get('/api/workorders', async (_req, res) => {
  try {
    const records = await fetchAllRecords();
    res.json({ ok: true, items: records.map(mapRecord) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'AIRTABLE_LIST_FAILED' });
  }
});

// Raw Airtable proxy for debugging
app.get('/api/airtable', async (_req, res) => {
  try {
    const data = await airtableRequest(AIRTABLE_TABLE_PATH);
    res.json(data);
  } catch (e) {
    console.error('Airtable proxy failed:', e);
    const statusMatch = /AIRTABLE_HTTP_(\d+)/.exec(e.message || '');
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 500;
    res.status(status === 401 ? 401 : 500).json({ ok: false, error: 'AIRTABLE_PROXY_FAILED', details: e.message });
  }
});

// Airtable diagnostics: verify token identity and accessible bases
app.get('/api/airtable/debug', async (_req, res) => {
  try {
    const whoResp = await fetch('https://api.airtable.com/v0/meta/whoami', { headers: AT_HEADERS });
    const who = await whoResp.json();

    const basesResp = await fetch('https://api.airtable.com/v0/meta/bases', { headers: AT_HEADERS });
    const bases = await basesResp.json();

    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableName = process.env.AIRTABLE_TABLE_WORKORDERS;
    const hasBase = Array.isArray(bases.bases) && bases.bases.some(b => b.id === baseId);

    res.json({
      ok: true,
      whoami: who,
      bases: bases,
      env: { baseId, tableName },
      checks: { hasBase }
    });
  } catch (e) {
    console.error('Airtable debug failed:', e);
    res.status(500).json({ ok: false, error: 'AIRTABLE_DEBUG_FAILED', details: e.message });
  }
});

app.post('/api/workorders', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const fields = {
      'Code': req.body.code || '',
      [WORKORDER_FIELDS.title]: req.body.title || '',
      'Status': req.body.status || 'New',
      [WORKORDER_FIELDS.priority]: req.body.priority || 'Medium',
      [WORKORDER_FIELDS.dueDate]: req.body.dueDate || null,
      [WORKORDER_FIELDS.asset]: req.body.asset || '',
      'Component GlobalId': req.body.componentGlobalId || '',
      'Component Type': req.body.componentType || '',
      'Created At': req.body.createdAt || now
    };
    setDescriptionField(fields, req.body.description || '');

    if (!fields['Code']) {
      const codes = await fetchAllRecords({ 'fields[]': ['Code'] });
      const max = codes.reduce((acc, rec) => {
        const val = rec.fields['Code'];
        const match = typeof val === 'string' ? val.match(/^WO-(\d+)$/) : null;
        return match ? Math.max(acc, parseInt(match[1], 10)) : acc;
      }, 0);
      fields['Code'] = `WO-${String(max + 1).padStart(3, '0')}`;
    }

    const createdResponse = await airtableRequest(AIRTABLE_TABLE_PATH, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields }] })
    });
    const createdRecord = createdResponse.records && createdResponse.records[0];
    if (!createdRecord) {
      console.error('Airtable create returned no records');
      return res.status(500).json({ ok: false, error: 'AIRTABLE_CREATE_EMPTY' });
    }
    res.json({ ok: true, item: mapRecord(createdRecord) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'AIRTABLE_CREATE_FAILED', details: e.message });
  }
});

app.patch('/api/workorders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const fields = {};
    if (req.body.title !== undefined) fields[WORKORDER_FIELDS.title] = req.body.title;
    if (req.body.status !== undefined) fields['Status'] = req.body.status;
    if (req.body.priority !== undefined) fields[WORKORDER_FIELDS.priority] = req.body.priority;
    if (req.body.dueDate !== undefined) fields[WORKORDER_FIELDS.dueDate] = req.body.dueDate || null;
    if (req.body.asset !== undefined) fields[WORKORDER_FIELDS.asset] = req.body.asset;
    if (req.body.componentGlobalId !== undefined) fields['Component GlobalId'] = req.body.componentGlobalId;
    if (req.body.componentType !== undefined) fields['Component Type'] = req.body.componentType;
    if (req.body.description !== undefined) setDescriptionField(fields, req.body.description);

    const updatedResponse = await airtableRequest(AIRTABLE_TABLE_PATH, {
      method: 'PATCH',
      body: JSON.stringify({ records: [{ id, fields }] })
    });
    const updatedRecord = updatedResponse.records && updatedResponse.records[0];
    if (!updatedRecord) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    res.json({ ok: true, item: mapRecord(updatedRecord) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'AIRTABLE_UPDATE_FAILED', details: e.message });
  }
});

app.delete('/api/workorders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const deletedResponse = await airtableRequest(`${AIRTABLE_TABLE_PATH}/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    if (!deletedResponse || !deletedResponse.id) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    res.json({ ok: true, deleted: deletedResponse.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'AIRTABLE_DELETE_FAILED', details: e.message });
  }
});

// --------- Página ---------
app.get('/debug', (_req, res) => res.sendFile(path.resolve('public/html/debug.html')));
app.get('/model-test', (_req, res) => res.sendFile(path.resolve('public/html/model-test.html')));
app.get('/', (_req, res) => res.sendFile(path.resolve('public/html/index.html')));

app.listen(PORT, () => console.log(`GOAT em http://localhost:${PORT}`));
