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
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);
console.log('[admin] allowed emails:', ADMIN_EMAILS);
const STATUS_DEFAULT = process.env.WORKORDER_STATUS_DEFAULT || 'Por concluir';
const STATUS_DONE = process.env.WORKORDER_STATUS_DONE || 'Concluída';
const WORKORDER_FIELD_OPTIONS = {
  title: ['Título'],
  priority: ['Prioridade'],
  dueDate: ['Data Limite'],
  asset: ['Ativo / Zona'],
  description: ['Descrição'],
  elementId: ['Element ID'],
  status: ['Status', 'Estado', 'Situação']
  ,completed: ['Terminada', 'Concluída']
};

const WORKORDER_FIELDS = {};
const WORKORDER_FIELD_INDEX = {};
const FIELD_NAME_TO_KEY = {};

Object.entries(WORKORDER_FIELD_OPTIONS).forEach(([key, options]) => {
  WORKORDER_FIELD_INDEX[key] = 0;
  WORKORDER_FIELDS[key] = options?.[0] || '';
  options.forEach((name) => {
    if (!name) return;
    FIELD_NAME_TO_KEY[name.toLowerCase()] = key;
  });
});

const OPTIONAL_WORKORDER_KEYS = new Set([
  'priority',
  'dueDate',
  'asset',
  'description',
  'elementId',
  'status',
  'completed'
]);

function isOptionalWorkOrderKey(key) {
  return OPTIONAL_WORKORDER_KEYS.has(key);
}

const htmlPath = (file) => path.join(__dirname, 'public', 'html', file);

app.use(express.json());
app.use(express.static(PUBLIC_DIR, { fallthrough: true }));

function normalizeEmail(email = '') {
  return email.trim().toLowerCase();
}

function isAdminEmail(email = '') {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
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
  try {
    return await airtableRequest(tablePath, {
      method: 'POST',
      body: JSON.stringify({ fields })
    });
  } catch (err) {
    if (handleUnknownFieldError(err, fields)) {
      return createRecord(tablePath, fields);
    }
    throw err;
  }
}

async function updateRecord(tablePath, id, fields) {
  try {
    return await airtableRequest(`${tablePath}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields })
    });
  } catch (err) {
    if (handleUnknownFieldError(err, fields)) {
      return updateRecord(tablePath, id, fields);
    }
    throw err;
  }
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
  const emailValue = f[ACCOUNT_FIELDS.email] || '';
  const normalizedEmail = normalizeEmail(emailValue);
  return {
    id: record.id,
    name: f[ACCOUNT_FIELDS.name] || '',
    email: emailValue,
    isAdmin: isAdminEmail(normalizedEmail),
    ...(includePassword ? { passwordHash: f[ACCOUNT_FIELDS.passwordHash] || '' } : {})
  };
}

async function authenticateRequest(req) {
  const rawEmail = req.headers['x-goat-email'];
  const secret = req.headers['x-goat-secret'];
  if (!rawEmail || !secret) return null;
  const accountRecord = await findAccountByEmail(rawEmail);
  if (!accountRecord) return null;
  const storedHash = accountRecord.fields?.[ACCOUNT_FIELDS.passwordHash];
  if (!storedHash || storedHash !== secret) {
    return null;
  }
  return mapAccount(accountRecord, { includePassword: true });
}

function getFieldOptions(key) {
  return WORKORDER_FIELD_OPTIONS[key] || [];
}

function readWorkOrderField(fields, key) {
  const options = getFieldOptions(key);
  for (const name of options) {
    if (!name) continue;
    const value = fields[name];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return '';
}

function resolveFieldName(key) {
  return WORKORDER_FIELDS[key] || getFieldOptions(key)[0] || '';
}

function advanceFieldName(key) {
  const options = getFieldOptions(key);
  if (!options || options.length <= 1) return false;
  const currentIndex = WORKORDER_FIELD_INDEX[key] || 0;
  const nextIndex = (currentIndex + 1) % options.length;
  if (nextIndex === currentIndex) return false;
  WORKORDER_FIELD_INDEX[key] = nextIndex;
  WORKORDER_FIELDS[key] = options[nextIndex];
  console.warn(`[airtable] Switching field mapping for "${key}" to "${WORKORDER_FIELDS[key]}"`);
  return true;
}

function safeJSONParse(value) {
  if (typeof value !== 'string') return value || null;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return null;
  }
}

function mapWorkOrder(record) {
  if (!record) return null;
  const f = record.fields || {};
  return {
    id: record.id,
    code: record.id.slice(-6),
    title: readWorkOrderField(f, 'title') || '',
    priority: readWorkOrderField(f, 'priority') || 'Medium',
    dueDate: readWorkOrderField(f, 'dueDate') || '',
    asset: readWorkOrderField(f, 'asset') || '',
    description: readWorkOrderField(f, 'description') || '',
    elementId: readWorkOrderField(f, 'elementId') || '',
    status: readWorkOrderField(f, 'status') || STATUS_DEFAULT,
    completed: Boolean(readWorkOrderField(f, 'completed'))
  };
}

function buildWorkOrderFields(payload = {}) {
  const fields = {};
  const setField = (key, value) => {
    if (value === undefined || value === null) return;
    const fieldName = resolveFieldName(key);
    if (!fieldName) return;
    if (key === 'completed') {
      if (typeof value === 'boolean') {
        fields[fieldName] = value;
        return;
      }
      if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase();
        if (lowered === 'true' || lowered === '1' || lowered === 'yes' || lowered === 'on') {
          fields[fieldName] = true;
          return;
        }
        if (lowered === 'false' || lowered === '0' || lowered === 'no' || lowered === 'off') {
          fields[fieldName] = false;
          return;
        }
      }
      return;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return;
      if (key === 'elementId') {
        const numeric = Number(trimmed);
        if (Number.isNaN(numeric)) return;
        fields[fieldName] = numeric;
      } else {
        fields[fieldName] = trimmed;
      }
      return;
    }
    if (key === 'elementId') {
      const numeric = Number(value);
      if (Number.isNaN(numeric)) return;
      fields[fieldName] = numeric;
      return;
    }
    fields[fieldName] = value;
  };

  setField('title', payload.title);
  setField('priority', payload.priority);
  setField('dueDate', payload.dueDate);
  setField('asset', payload.asset);
  setField('description', payload.description);
  setField('elementId', payload.elementId);
  setField('status', payload.status);
  setField('completed', payload.completed);

  if (!Object.prototype.hasOwnProperty.call(fields, '__aliasTries')) {
    Object.defineProperty(fields, '__aliasTries', {
      value: {},
      enumerable: false,
      configurable: true,
      writable: true
    });
  }

  return fields;
}

function extractUnknownFieldName(err) {
  const detail = err?.details?.error || err?.details || null;
  if (!detail || typeof detail !== 'object') return null;
  const type = detail.type || detail.error?.type;
  if (type !== 'UNKNOWN_FIELD_NAME' && type !== 'INVALID_REQUEST_UNKNOWN_FIELD_NAME') {
    return null;
  }
  const message = detail.message || '';
  const match = message.match(/"([^"\\]+)"/);
  return match ? match[1] : null;
}

function handleUnknownFieldError(err, fields) {
  const fieldName = extractUnknownFieldName(err);
  if (!fieldName) return false;
  const key = FIELD_NAME_TO_KEY[fieldName.toLowerCase()];
  if (!key) return false;
  if (!fields.__aliasTries) {
    Object.defineProperty(fields, '__aliasTries', {
      value: {},
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  const options = getFieldOptions(key);
  const previousTries = fields.__aliasTries[key] || 0;
  if (!options || previousTries >= (options.length - 1)) {
    if (isOptionalWorkOrderKey(key)) {
      if (fields && Object.prototype.hasOwnProperty.call(fields, fieldName)) {
        delete fields[fieldName];
      }
      console.warn(`[airtable] Dropping optional workorder field "${fieldName}" (key "${key}") because Airtable column is missing`);
      fields.__aliasTries[key] = options.length || previousTries + 1;
      return true;
    }
    return false;
  }
  const advanced = advanceFieldName(key);
  if (!advanced) return false;
  fields.__aliasTries[key] = previousTries + 1;
  const newName = resolveFieldName(key);
  if (!newName) return false;
  if (fields && Object.prototype.hasOwnProperty.call(fields, fieldName)) {
    fields[newName] = fields[fieldName];
    delete fields[fieldName];
  }
  console.warn(`[airtable] Retrying request using fallback field "${newName}" for key "${key}"`);
  return true;
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

app.get('/api/workorders', async (_req, res) => {
  try {
    const params = { maxRecords: 200 };
    const sortField = resolveFieldName('title');
    if (sortField) {
      params['sort[0][field]'] = sortField;
      params['sort[0][direction]'] = 'desc';
    }
    const data = await listRecords(WORKORDER_TABLE_PATH, params);
    const items = (data.records || []).map(mapWorkOrder);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('List workorders failed:', err);
    res.status(err.status || 500).json({ ok: false, error: 'LIST_WORKORDERS_FAILED', details: err.details });
  }
});

app.post('/api/workorders', async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.title || !payload.title.trim()) {
      return res.status(400).json({ ok: false, error: 'TITLE_REQUIRED' });
    }
    if (!payload.status) {
      payload.status = STATUS_DEFAULT;
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'completed')) {
      payload.completed = false;
    }
    const fields = buildWorkOrderFields(payload);
    const created = await createRecord(WORKORDER_TABLE_PATH, fields);
    res.json({ ok: true, item: mapWorkOrder(created) });
  } catch (err) {
    console.error('Create workorder failed:', err);
    res.status(err.status || 500).json({ ok: false, error: 'CREATE_WORKORDER_FAILED', details: err.details });
  }
});

app.patch('/api/workorders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ ok: false, error: 'WORKORDER_ID_REQUIRED' });
    const payload = req.body || {};
    const wantsStatusChange = Object.prototype.hasOwnProperty.call(payload, 'status');
    const wantsCompletedChange = Object.prototype.hasOwnProperty.call(payload, 'completed');
    if (wantsStatusChange || wantsCompletedChange) {
      const account = await authenticateRequest(req);
      if (!account) {
        return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      }
      if (!account.isAdmin) {
        return res.status(403).json({ ok: false, error: 'ADMIN_ONLY' });
      }
    }
    const fields = buildWorkOrderFields(payload);
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ ok: false, error: 'NO_FIELDS_TO_UPDATE' });
    }
    const updated = await updateRecord(WORKORDER_TABLE_PATH, id, fields);
    res.json({ ok: true, item: mapWorkOrder(updated) });
  } catch (err) {
    console.error('Update workorder failed:', err);
    res.status(err.status || 500).json({ ok: false, error: 'UPDATE_WORKORDER_FAILED', details: err.details });
  }
});

app.post('/api/workorders/:id/done', async (req, res) => {
  try {
    const account = await authenticateRequest(req);
    if (!account) {
      return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
    }
    if (!account.isAdmin) {
      return res.status(403).json({ ok: false, error: 'ADMIN_ONLY' });
    }
    const { id } = req.params;
    if (!id) return res.status(400).json({ ok: false, error: 'WORKORDER_ID_REQUIRED' });
    const overrideStatus = req.body && typeof req.body.status === 'string' && req.body.status.trim()
      ? req.body.status.trim()
      : STATUS_DONE;
    const fields = buildWorkOrderFields({ status: overrideStatus, completed: true });
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ ok: false, error: 'STATUS_FIELD_MISSING' });
    }
    const updated = await updateRecord(WORKORDER_TABLE_PATH, id, fields);
    res.json({ ok: true, item: mapWorkOrder(updated) });
  } catch (err) {
    console.error('Mark workorder done failed:', err);
    res.status(err.status || 500).json({ ok: false, error: 'COMPLETE_WORKORDER_FAILED', details: err.details });
  }
});

app.post('/api/admin/access', (req, res) => {
  try {
    const { email = '' } = req.body || {};
    const normalized = normalizeEmail(email);
    const allowed = Boolean(normalized && ADMIN_EMAILS.includes(normalized));
    if (!allowed) {
      return res.status(403).json({ ok: false, error: 'ADMIN_EMAIL_REQUIRED' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin access check failed:', err);
    res.status(500).json({ ok: false, error: 'ADMIN_ACCESS_FAILED' });
  }
});

app.delete('/api/workorders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ ok: false, error: 'WORKORDER_ID_REQUIRED' });
    await deleteRecord(WORKORDER_TABLE_PATH, id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete workorder failed:', err);
    res.status(err.status || 500).json({ ok: false, error: 'DELETE_WORKORDER_FAILED', details: err.details });
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
app.get('/admin', (_req, res) => res.sendFile(htmlPath('admin.html')));
app.get('/model-test', (_req, res) => res.sendFile(htmlPath('model-test.html')));
app.get('/debug', (_req, res) => res.sendFile(htmlPath('debug.html')));
app.get('/', (_req, res) => res.sendFile(htmlPath('index.html')));

app.listen(PORT, () => console.log(`GOAT em http://localhost:${PORT}`));

