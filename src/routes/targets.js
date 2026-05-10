const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET all targets
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM targets ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'GET /targets failed', error: err.message }));
    res.status(500).json({ error: 'Database error' });
  }
});

// GET single target with recent stats
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const target = await pool.query('SELECT * FROM targets WHERE id = $1', [id]);
    if (!target.rows.length) return res.status(404).json({ error: 'Not found' });

    const logs = await pool.query(
      'SELECT * FROM ping_logs WHERE target_id = $1 ORDER BY checked_at DESC LIMIT 50',
      [id]
    );

    const stats = await pool.query(`
      SELECT
        COUNT(*) AS total_checks,
        SUM(CASE WHEN is_up THEN 1 ELSE 0 END) AS up_count,
        ROUND(AVG(response_time_ms)) AS avg_response_ms,
        ROUND(100.0 * SUM(CASE WHEN is_up THEN 1 ELSE 0 END) / COUNT(*), 2) AS uptime_percent
      FROM ping_logs
      WHERE target_id = $1
        AND checked_at > NOW() - INTERVAL '24 hours'
    `, [id]);

    res.json({ ...target.rows[0], stats: stats.rows[0], recent_logs: logs.rows });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'GET /targets/:id failed', error: err.message }));
    res.status(500).json({ error: 'Database error' });
  }
});

// POST create target
router.post('/', async (req, res) => {
  const { name, url, interval_seconds = 60 } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url are required' });

  try {
    new URL(url); // validate URL
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO targets (name, url, interval_seconds) VALUES ($1, $2, $3) RETURNING *',
      [name, url, interval_seconds]
    );
    console.log(JSON.stringify({ level: 'info', msg: 'Target created', id: rows[0].id, url }));
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'URL already exists' });
    console.error(JSON.stringify({ level: 'error', msg: 'POST /targets failed', error: err.message }));
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH update target
router.patch('/:id', async (req, res) => {
  const { name, interval_seconds, active } = req.body;
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE targets SET
        name = COALESCE($1, name),
        interval_seconds = COALESCE($2, interval_seconds),
        active = COALESCE($3, active)
       WHERE id = $4 RETURNING *`,
      [name, interval_seconds, active, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE target
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM targets WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
