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
