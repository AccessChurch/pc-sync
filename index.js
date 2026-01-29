//Load .env
require('dotenv').config();

//Call to Airtable
const Airtable = require('airtable');

// Call to Axios
const axios = require('axios');

//test code
const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Hello from pc-sync 👋');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

//health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

//OAuth Routes
app.get('/oauth/start', (req, res) => {
  const { PCO_APP_ID, PCO_REDIRECT_URI } = process.env;

  const authUrl =
    `https://api.planningcenteronline.com/oauth/authorize` +
    `?client_id=${PCO_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(PCO_REDIRECT_URI)}` +
    `&response_type=code`;

  res.redirect(authUrl);
});

app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const tokenResponse = await axios.post(
      'https://api.planningcenteronline.com/oauth/token',
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.PCO_REDIRECT_URI,
        client_id: process.env.PCO_APP_ID,
        client_secret: process.env.PCO_SECRET
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const { access_token } = tokenResponse.data;

    // TEMPORARY: log token to verify success (we’ll store it properly next)
    console.log('PCO ACCESS TOKEN:', access_token);

    res.send(
      'Authorization successful. You can close this window.'
    );

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send('OAuth failed');
  }
});


//sync Endpoint
app.post('/sync', async (req, res) => {
  const providedSecret = req.headers['x-sync-secret'];
  const expectedSecret = process.env.SYNC_SECRET;

  if (!expectedSecret) {
    return res.status(500).json({
      ok: false,
      error: 'Server misconfigured: SYNC_SECRET not set'
    });
  }

  if (providedSecret !== expectedSecret) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized'
    });
  }

try {
  const base = getAirtableBase();
  const tableName = process.env.AIRTABLE_TABLE_NAME;

  if (!tableName) {
    throw new Error('AIRTABLE_TABLE_NAME not set');
  }

  const records = await base(tableName)
    .select({ maxRecords: 5 })
    .firstPage();

  console.log(`Fetched ${records.length} Airtable records`);

  records.forEach(record => {
    console.log({
      id: record.id,
      fields: record.fields
    });
  });

  res.json({
    ok: true,
    message: 'Airtable read successful',
    recordCount: records.length
  });
} catch (err) {
  console.error(err);

  res.status(500).json({
    ok: false,
    error: err.message
  });
}
//PCO Dry-RUN CODE
const pco = getPlanningCenterClient();

const response = await pco.get('/calendar/v2/events', {
  params: { per_page: 1 }
});

console.log('Planning Center response sample:', {
  count: response.data?.data?.length,
  firstEvent: response.data?.data?.[0]?.attributes?.name
});



});


//Airtable Coding
function getAirtableBase() {
  const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;

  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error('Airtable environment variables not set');
  }

  Airtable.configure({
    apiKey: AIRTABLE_API_KEY
  });

  return Airtable.base(AIRTABLE_BASE_ID);
}

//Axios Helper - PCO
function getPlanningCenterClient() {
  const { PCO_APP_ID, PCO_SECRET } = process.env;

  if (!PCO_APP_ID || !PCO_SECRET) {
    throw new Error('Planning Center credentials not set');
  }

  return axios.create({
    baseURL: 'https://api.planningcenteronline.com',
    auth: {
      username: PCO_APP_ID,
      password: PCO_SECRET
    }
  });
}
