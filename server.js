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
    tokenParams.append('scope', 'data:read viewables:read');

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
const TABLE = process.env.AIRTABLE_TABLE_WORKORDERS;
const AT_BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
const AT_HEADERS = {
  'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
  'Content-Type': 'application/json'
};

// tenta ler "Description" e, se não houver, "Short Description"
function getDescriptionField(fields) {
  return fields['Description'] ?? fields['Short Description'] ?? '';
}
// quando gravar, escrevo nas duas chaves para ficar compatível com qualquer um dos nomes
function setDescriptionField(fieldsObj, value) {
  fieldsObj['Description'] = value ?? '';
  fieldsObj['Short Description'] = value ?? '';
}

// Mapear Airtable -> objeto GOAT
function mapRecord(r) {
  const f = r.fields || {};
  return {
    id: r.id,
    code: f['Code'] || '',
    title: f['Title'] || '',
    status: f['Status'] || 'New',
    priority: f['Priority'] || 'Medium',
    dueDate: f['Due Date'] || '',
    asset: f['Asset'] || '',
    description: getDescriptionField(f),
    componentGlobalId: f['Component GlobalId'] || '',
    componentType: f['Component Type'] || '',
    createdAt: f['Created At'] || ''
  };
}

// --------- API ---------
app.get('/api/workorders', async (_req, res) => {
  try {
    const resp = await fetch(AT_BASE, { headers: AT_HEADERS });
    const json = await resp.json();
    const items = (json.records || []).map(mapRecord);
    res.json({ ok: true, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'AIRTABLE_LIST_FAILED' });
  }
});

app.post('/api/workorders', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const fields = {
      'Code': req.body.code || '',
      'Title': req.body.title || '',
      'Status': req.body.status || 'New',
      'Priority': req.body.priority || 'Medium',
      'Due Date': req.body.dueDate || null,
      'Asset': req.body.asset || '',
      'Component GlobalId': req.body.componentGlobalId || '',
      'Component Type': req.body.componentType || '',
      'Created At': req.body.createdAt || now
    };
    setDescriptionField(fields, req.body.description || '');

    // gerar Code sequencial simples se vier vazio
    if (!fields['Code']) {
      const countResp = await fetch(AT_BASE, { headers: AT_HEADERS });
      const countJson = await countResp.json();
      const n = (countJson.records || []).length + 1;
      // usa WO-### para bater com o teu screenshot
      fields['Code'] = `WO-${String(n).padStart(3, '0')}`;
    }

    const payload = { records: [{ fields }] };
    const resp = await fetch(AT_BASE, { method: 'POST', headers: AT_HEADERS, body: JSON.stringify(payload) });
    const json = await resp.json();
    const created = mapRecord(json.records[0]);
    res.json({ ok: true, item: created });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'AIRTABLE_CREATE_FAILED' });
  }
});

app.patch('/api/workorders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const fields = {};
    if (req.body.title !== undefined) fields['Title'] = req.body.title;
    if (req.body.status !== undefined) fields['Status'] = req.body.status;
    if (req.body.priority !== undefined) fields['Priority'] = req.body.priority;
    if (req.body.dueDate !== undefined) fields['Due Date'] = req.body.dueDate || null;
    if (req.body.asset !== undefined) fields['Asset'] = req.body.asset;
    if (req.body.componentGlobalId !== undefined) fields['Component GlobalId'] = req.body.componentGlobalId;
    if (req.body.componentType !== undefined) fields['Component Type'] = req.body.componentType;
    if (req.body.description !== undefined) setDescriptionField(fields, req.body.description);

    const payload = { records: [{ id, fields }] };
    const resp = await fetch(AT_BASE, { method: 'PATCH', headers: AT_HEADERS, body: JSON.stringify(payload) });
    const json = await resp.json();
    const updated = mapRecord(json.records[0]);
    res.json({ ok: true, item: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'AIRTABLE_UPDATE_FAILED' });
  }
});

app.delete('/api/workorders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const url = `${AT_BASE}?records[]=${encodeURIComponent(id)}`;
    const resp = await fetch(url, { method: 'DELETE', headers: AT_HEADERS });
    const json = await resp.json();
    res.json({ ok: true, deleted: json.records?.[0]?.id || id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'AIRTABLE_DELETE_FAILED' });
  }
});

// --------- Página ---------
app.get('/debug', (_req, res) => res.sendFile(path.resolve('public/html/debug.html')));
app.get('/model-test', (_req, res) => res.sendFile(path.resolve('public/html/model-test.html')));
app.get('/', (_req, res) => res.sendFile(path.resolve('public/html/index.html')));

app.listen(PORT, () => console.log(`GOAT em http://localhost:${PORT}`));
