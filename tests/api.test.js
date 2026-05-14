require('dotenv').config({ path: '.env.test' });
const request = require('supertest');
const app = require('../src/app');
const { pool, initDB } = require('../src/db');

beforeAll(async () => {
  await initDB();
  await pool.query('DELETE FROM ping_logs');
  await pool.query('DELETE FROM targets');
});

afterAll(async () => {
  await pool.query('DELETE FROM ping_logs');
  await pool.query('DELETE FROM targets');
  await pool.end();
});

describe('Health', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Targets API', () => {
  let targetId;

  it('POST /api/targets creates a target', async () => {
    const res = await request(app)
      .post('/api/targets')
      .send({ name: 'Google', url: 'https://google.com', interval_seconds: 60 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    targetId = res.body.id;
  });

  it('POST /api/targets rejects duplicate URL', async () => {
    const res = await request(app)
      .post('/api/targets')
      .send({ name: 'Google2', url: 'https://google.com' });
    expect(res.status).toBe(409);
  });

  it('POST /api/targets rejects invalid URL', async () => {
    const res = await request(app)
      .post('/api/targets')
      .send({ name: 'Bad', url: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('GET /api/targets returns list', async () => {
    const res = await request(app).get('/api/targets');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('GET /api/targets/:id returns target', async () => {
    const res = await request(app).get(`/api/targets/${targetId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(targetId);
    expect(res.body.stats).toBeDefined();
  });

  it('PATCH /api/targets/:id updates target', async () => {
    const res = await request(app)
      .patch(`/api/targets/${targetId}`)
      .send({ name: 'Google Updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Google Updated');
  });

  it('DELETE /api/targets/:id removes target', async () => {
    const res = await request(app).delete(`/api/targets/${targetId}`);
    expect(res.status).toBe(204);
  });

  it('GET /api/targets/:id returns 404 after delete', async () => {
    const res = await request(app).get(`/api/targets/${targetId}`);
    expect(res.status).toBe(404);
  });
});

describe('Stats API', () => {
  it('GET /api/stats/summary returns array', async () => {
    const res = await request(app).get('/api/stats/summary');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Status Page', () => {
  // 7.1 — No targets: returns 200 and "No Monitors Configured"
  // Requirements: 1.1, 1.2, 2.5
  it('GET /status with no targets returns 200 and "No Monitors Configured"', async () => {
    // beforeAll already cleared targets and ping_logs, so the table is empty here
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('No Monitors Configured');
  });

  // 7.2 — One active target with no ping logs: shows "No Data" indicator
  // Requirements: 3.4
  describe('with one active target and no ping logs', () => {
    let targetId;

    beforeEach(async () => {
      const { rows } = await pool.query(
        `INSERT INTO targets (name, url, interval_seconds, active)
         VALUES ('No Data Target', 'https://example-nodata.com', 60, true)
         RETURNING id`
      );
      targetId = rows[0].id;
    });

    afterEach(async () => {
      await pool.query('DELETE FROM targets WHERE id = $1', [targetId]);
    });

    it('returns indicator--unknown and aria-label="No Data"', async () => {
      const res = await request(app).get('/status');
      expect(res.status).toBe(200);
      expect(res.text).toContain('indicator--unknown');
      expect(res.text).toContain('aria-label="No Data"');
    });
  });

  // 7.3 — All targets up: shows "All Systems Operational"
  // Requirements: 2.2, 3.2
  describe('with all targets up', () => {
    let targetId;
    let pingLogId;

    beforeEach(async () => {
      const targetRes = await pool.query(
        `INSERT INTO targets (name, url, interval_seconds, active)
         VALUES ('Up Target', 'https://example-up.com', 60, true)
         RETURNING id`
      );
      targetId = targetRes.rows[0].id;

      const pingRes = await pool.query(
        `INSERT INTO ping_logs (target_id, is_up, response_time_ms, checked_at)
         VALUES ($1, true, 100, NOW())
         RETURNING id`,
        [targetId]
      );
      pingLogId = pingRes.rows[0].id;
    });

    afterEach(async () => {
      await pool.query('DELETE FROM ping_logs WHERE id = $1', [pingLogId]);
      await pool.query('DELETE FROM targets WHERE id = $1', [targetId]);
    });

    it('returns "All Systems Operational" and indicator--up', async () => {
      const res = await request(app).get('/status');
      expect(res.status).toBe(200);
      expect(res.text).toContain('All Systems Operational');
      expect(res.text).toContain('indicator--up');
    });
  });

  // 7.4 — One target down: shows "Major Outage"
  // Requirements: 2.4, 3.3
  describe('with one target down', () => {
    let targetId;
    let pingLogId;

    beforeEach(async () => {
      const targetRes = await pool.query(
        `INSERT INTO targets (name, url, interval_seconds, active)
         VALUES ('Down Target', 'https://example-down.com', 60, true)
         RETURNING id`
      );
      targetId = targetRes.rows[0].id;

      const pingRes = await pool.query(
        `INSERT INTO ping_logs (target_id, is_up, response_time_ms, checked_at)
         VALUES ($1, false, 0, NOW())
         RETURNING id`,
        [targetId]
      );
      pingLogId = pingRes.rows[0].id;
    });

    afterEach(async () => {
      await pool.query('DELETE FROM ping_logs WHERE id = $1', [pingLogId]);
      await pool.query('DELETE FROM targets WHERE id = $1', [targetId]);
    });

    it('returns "Major Outage" and indicator--down', async () => {
      const res = await request(app).get('/status');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Major Outage');
      expect(res.text).toContain('indicator--down');
    });
  });
});
