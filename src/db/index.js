const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'Postgres pool error', error: err.message }));
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS targets (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        url TEXT NOT NULL UNIQUE,
        interval_seconds INTEGER NOT NULL DEFAULT 60,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ping_logs (
        id SERIAL PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        status_code INTEGER,
        response_time_ms INTEGER,
        is_up BOOLEAN NOT NULL,
        error TEXT,
        checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_ping_logs_target_id ON ping_logs(target_id);
      CREATE INDEX IF NOT EXISTS idx_ping_logs_checked_at ON ping_logs(checked_at DESC);
    `);
    console.log(JSON.stringify({ level: 'info', msg: 'Database initialized' }));
  } finally {
    client.release();
  }
}

async function checkPoolHealth() {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    const latency = Date.now() - start;
    console.log(JSON.stringify({
      level: 'info',
      msg: 'DB pool health',
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      latency_ms: latency
    }));
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'DB health check failed', error: err.message }));
  }
}

module.exports = { pool, initDB, checkPoolHealth };
