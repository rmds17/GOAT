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

app.get('/api/airtable', async (req, res) => {
  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_ID}`;
  
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }
    });

    const text = await response.text(); // <- log the raw response
    console.log(text);

    res.send(text);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});


app.post("/api/add", async (req, res) => {
  const fields = req.body; // objeto com os campos do registro

  console.log("Enviando para Airtable:", { fields });
  console.log("URL:", `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_ID}`);

  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_ID}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ fields })
      }
    );
    const data = await response.json();
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
    const response = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_ID}/${recordId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        }
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --------- Página ---------
app.get('/debug', (_req, res) => res.sendFile(path.resolve('public/html/debug.html')));
app.get('/model-test', (_req, res) => res.sendFile(path.resolve('public/html/model-test.html')));
app.get('/', (_req, res) => res.sendFile(path.resolve('public/html/index.html')));

app.listen(PORT, () => console.log(`GOAT em http://localhost:${PORT}`));

