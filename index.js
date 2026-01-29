// Load .env (local only; Railway ignores this)
require('dotenv').config();

const express = require('express');
const Airtable = require('airtable');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/**
 * Helper: Railway UI sometimes shows quotes in the Variables view.
 * At runtime it’s usually fine, but stripping wrapping quotes makes it bulletproof.
 */
function env(name) {
  const v = process.env[name];
  if (!v) return v;
  return String(v).replace(/^"|"$/g, '');
}

/** -----------------------------
 *  Airtable helper
 *  -----------------------------
 */
function getAirtableBase() {
  const AIRTABLE_API_KEY = env('AIRTABLE_API_KEY');
  const AIRTABLE_BASE_ID = env('AIRTABLE_BASE_ID');

  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error('Airtable environment variables not set');
  }

  Airtable.configure({ apiKey: AIRTABLE_API_KEY });
  return Airtable.base(AIRTABLE_BASE_ID);
}

/** -----------------------------
 *  Planning Center Calendar helper (OAuth Bearer token)
 *  -----------------------------
 */
function getPlanningCenterOAuthClient() {
  const token = env('PCO_ACCESS_TOKEN');

  if (!token) {
    throw new Error('PCO_ACCESS_TOKEN not set');
  }

  return axios.create({
    baseURL: 'https://api.planningcenteronline.com',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

/** -----------------------------
 *  Basic routes
 *  -----------------------------
 */
app.get('/', (req, res) => {
  res.send('Hello from pc-sync 👋');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/** -----------------------------
 *  OAuth start + callback (kept for re-auth)
 *  Note: callback does NOT print/log tokens.
 *  If you ever need a new token later, we can add a safe “one-time handoff” endpoint.
 *  -----------------------------
 */
app.get('/oauth/start', (req, res) => {
  const PCO_APP_ID = env('PCO_APP_ID');
  const PCO_REDIRECT_URI = env('PCO_REDIRECT_URI');

  if (!PCO_APP_ID || !PCO_REDIRECT_URI) {
    return res.status(500).json({
      ok: false,
      error: 'Missing OAuth env vars',
      hasPCO_APP_ID: !!PCO_APP_ID,
      hasPCO_REDIRECT_URI: !!PCO_REDIRECT_URI,
    });
  }

  const params = new URLSearchParams({
    client_id: PCO_APP_ID,
    redirect_uri: PCO_REDIRECT_URI,
    response_type: 'code',
    scope: 'calendar',
    state: String(Date.now()),
  });

  const authUrl = `https://api.planningcenteronline.com/oauth/authorize?${params.toString()}`;

  // Debug mode: shows the exact URL instead of redirecting
  if (req.query.debug === '1') {
    return res.json({ authUrl });
  }

  return res.redirect(authUrl);
});

app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    // We still exchange the code so we know OAuth is working.
    // We are NOT printing tokens here.
    await axios.post(
      'https://api.planningcenteronline.com/oauth/token',
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: env('PCO_REDIRECT_URI'),
        client_id: env('PCO_APP_ID'),
        client_secret: env('PCO_SECRET'),
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    console.log('OAuth success: token exchange completed (tokens not logged).');
    return res.send('OAuth successful ✅ You can close this window.');
  } catch (err) {
    console.error('OAuth failed:', err.response?.data || err.message);
    return res.status(500).send('OAuth failed');
  }
});

/** -----------------------------
 *  Secure sync endpoint (Airtable read + Calendar dry-run)
 *  -----------------------------
 */
app.post('/sync', async (req, res) => {
  const providedSecret = req.headers['x-sync-secret'];
  const expectedSecret = env('SYNC_SECRET');

  if (!expectedSecret) {
    return res.status(500).json({
      ok: false,
      error: 'Server misconfigured: SYNC_SECRET not set',
    });
  }

  if (providedSecret !== expectedSecret) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
    });
  }

  try {
    // 1) Airtable read (log-only)
    const base = getAirtableBase();
    const tableName = env('AIRTABLE_TABLE_NAME');
    if (!tableName) throw new Error('AIRTABLE_TABLE_NAME not set');

    const records = await base(tableName)
      .select({ maxRecords: 5 })
      .firstPage();

    console.log(`Fetched ${records.length} Airtable records`);
    records.forEach((record) => {
      console.log({ id: record.id, fields: record.fields });
    });

    // 2) Planning Center Calendar read (dry-run)
    const pco = getPlanningCenterOAuthClient();
    const response = await pco.get('/calendar/v2/events', {
      params: { per_page: 1 },
    });

    const firstEventName = response.data?.data?.[0]?.attributes?.name || null;
    console.log('Planning Center response sample:', {
      count: response.data?.data?.length ?? 0,
      firstEvent: firstEventName,
    });

    // Respond ONCE, after both tasks are done
    return res.json({
      ok: true,
      message: 'Airtable + Planning Center dry run successful',
      airtableRecordCount: records.length,
      planningCenterSampleEventName: firstEventName,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/** -----------------------------
 *  Start server (must be last)
 *  -----------------------------
 */
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
