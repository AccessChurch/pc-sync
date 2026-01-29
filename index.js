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
app.post('/sync', (req, res) => {
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

  console.log('Authorized manual sync triggered');

  res.json({
    ok: true,
    message: 'Secure sync triggered (no-op)',
    timestamp: new Date().toISOString()
  });
});
