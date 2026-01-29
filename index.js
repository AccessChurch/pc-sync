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
  console.log('Manual sync triggered');

  res.json({
    ok: true,
    message: 'Sync triggered (no-op)',
    timestamp: new Date().toISOString()
  });
});
