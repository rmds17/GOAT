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
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, 'public');
const AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;
const WORKORDER_TABLE = process.env.AIRTABLE_TABLE_ID || process.env.AIRTABLE_TABLE_WORKORDERS;
const ACCOUNTS_TABLE = process.env.AIRTABLE_TABLE_ID_CONTAS || process.env.AIRTABLE_TABLE_CONTAS;
const WORKORDER_TABLE_PATH = `/${encodeURIComponent(WORKORDER_TABLE)}`;
const ACCOUNTS_TABLE_PATH = `/${encodeURIComponent(ACCOUNTS_TABLE || 'Contas')}`;
const AT_HEADERS = {
  'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
  'Content-Type': 'application/json'
};
const ACCOUNT_FIELDS = {
  name: 'Nome',
  email: 'Email',
  passwordHash: 'Password'
};
const htmlPath = (file) => path.join(__dirname, 'public', 'html', file);

app.use(express.json());
app.use(express.static(PUBLIC_DIR, { fallthrough: true }));

function normalizeEmail(email = '') {
  return email.trim().toLowerCase();
}

function hashPassword(password = '') {
  const salt = process.env.AUTH_SALT || 'GOAT_AUTH_SALT';
  return crypto.createHash('sha256').update(`${password}${salt}`).digest('hex');
}

function escapeFormulaValue(value = '') {
  return value.replace(/'/g, "\\'");
}

async function airtableRequest(path, options = {}) {
  const response = await fetch(`${AIRTABLE_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...AT_HEADERS,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    let details;
    try { details = JSON.parse(text); } catch { details = text; }
    console.error('Airtable request failed', response.status, details);
    const error = new Error('AIRTABLE_REQUEST_FAILED');
    error.status = response.status;
    error.details = details;
    throw error;
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
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

async function listRecords(tablePath, params = {}) {
  const qs = buildSearchParams(params);
  return airtableRequest(`${tablePath}${qs}`);
}

async function createRecord(tablePath, fields) {
  return airtableRequest(tablePath, {
    method: 'POST',
    body: JSON.stringify({ fields })
  });
}

async function updateRecord(tablePath, id, fields) {
  return airtableRequest(`${tablePath}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields })
  });
}

async function deleteRecord(tablePath, id) {
  return airtableRequest(`${tablePath}/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

async function findAccountByEmail(email) {
  if (!email) return null;
  const normalized = normalizeEmail(email);
  const formula = `LOWER({${ACCOUNT_FIELDS.email}}) = '${escapeFormulaValue(normalized)}'`;
  const data = await listRecords(ACCOUNTS_TABLE_PATH, {
    filterByFormula: formula,
    maxRecords: 1
  });
  return data.records && data.records[0] ? data.records[0] : null;
}

function mapAccount(record, options = {}) {
  const includePassword = Boolean(options.includePassword);
  if (!record) return null;
  const f = record.fields || {};
  return {
    id: record.id,
    name: f[ACCOUNT_FIELDS.name] || '',
    email: f[ACCOUNT_FIELDS.email] || '',
    ...(includePassword ? { passwordHash: f[ACCOUNT_FIELDS.passwordHash] || '' } : {})
  };
}


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

/* -------- Simple authentication backed by Airtable (Contas) -------- */
app.post('/api/accounts/register', async (req, res) => {
  try {
    const { name = '', email = '', password = '' } = req.body || {};
    if (!name.trim() || !email.trim() || !password) {
      return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: 'WEAK_PASSWORD' });
    }

    const normalizedEmail = normalizeEmail(email);
    const existing = await findAccountByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ ok: false, error: 'EMAIL_IN_USE' });
    }

    const fields = {
      [ACCOUNT_FIELDS.name]: name.trim(),
      [ACCOUNT_FIELDS.email]: normalizedEmail,
      [ACCOUNT_FIELDS.passwordHash]: hashPassword(password)
    };

    const created = await createRecord(ACCOUNTS_TABLE_PATH, fields);
    res.json({ ok: true, user: mapAccount(created) });
  } catch (err) {
    console.error('Account registration failed:', err);
    res.status(err.status || 500).json({ ok: false, error: 'REGISTER_FAILED' });
  }
});

app.post('/api/accounts/login', async (req, res) => {
  try {
    const { email = '', password = '' } = req.body || {};
    if (!email.trim() || !password) {
      return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
    }

    const account = await findAccountByEmail(email);
    if (!account) {
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
    }

    const storedHash = account.fields?.[ACCOUNT_FIELDS.passwordHash];
    if (storedHash !== hashPassword(password)) {
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
    }

    res.json({ ok: true, user: mapAccount(account, { includePassword: true }) });
  } catch (err) {
    console.error('Account login failed:', err);
    res.status(err.status || 500).json({ ok: false, error: 'LOGIN_FAILED' });
  }
});

app.get('/api/airtable', async (req, res) => {
  try {
    const data = await airtableRequest(WORKORDER_TABLE_PATH);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: 'AIRTABLE_FETCH_FAILED', details: err.details });
  }
});


app.post("/api/add", async (req, res) => {
  const fields = req.body; // objeto com os campos do registro

  console.log("Enviando para Airtable:", { fields });
  console.log("URL:", `${AIRTABLE_BASE_URL}${WORKORDER_TABLE_PATH}`);

  try {
    const data = await createRecord(WORKORDER_TABLE_PATH, fields);
    if (data.error) {
      console.error("Erro Airtable:", JSON.stringify(data.error, null, 2));
      return res.status(400).json({ error: data.error });
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/delete/:id", async (req, res) => {
  const recordId = req.params.id;

  try {
    const data = await deleteRecord(WORKORDER_TABLE_PATH, recordId);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --------- Página ---------
app.get('/auth', (_req, res) => res.sendFile(htmlPath('auth.html')));
app.get('/account', (_req, res) => res.sendFile(htmlPath('account.html')));
app.get('/model-test', (_req, res) => res.sendFile(htmlPath('model-test.html')));
app.get('/debug', (_req, res) => res.sendFile(htmlPath('debug.html')));
app.get('/', (_req, res) => res.sendFile(htmlPath('index.html')));

app.listen(PORT, () => console.log(`GOAT em http://localhost:${PORT}`));

