const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET overall stats summary
router.get('/summary', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        t.id,
        t.name,
        t.url,
        t.active,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN p.is_up THEN 1 ELSE 0 END) / NULLIF(COUNT(p.id), 0), 2), 0) AS uptime_percent_24h,
        COALESCE(ROUND(AVG(p.response_time_ms)), 0) AS avg_response_ms_24h,
        (SELECT is_up FROM ping_logs WHERE target_id = t.id ORDER BY checked_at DESC LIMIT 1) AS current_status
      FROM targets t
      LEFT JOIN ping_logs p ON p.target_id = t.id AND p.checked_at > NOW() - INTERVAL '24 hours'
      GROUP BY t.id
      ORDER BY t.name
    `);
    res.json(rows);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'GET /stats/summary failed', error: err.message }));
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
