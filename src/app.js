require('dotenv').config();
const express = require('express');
const targetsRouter = require('./routes/targets');
const statsRouter = require('./routes/stats');

const app = express();

app.use(express.json());

// Structured request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(JSON.stringify({
      level: 'info',
      msg: 'HTTP',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start
    }));
  });
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/targets', targetsRouter);
app.use('/api/stats', statsRouter);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(JSON.stringify({ level: 'error', msg: err.message }));
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
