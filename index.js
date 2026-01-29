//Load .env
require('dotenv').config();

//Call to Airtable
const Airtable = require('airtable');

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
