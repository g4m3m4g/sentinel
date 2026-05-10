const axios = require('axios');
const cron = require('node-cron');
const { pool } = require('../db');

const jobs = new Map();

async function pingTarget(target) {
  const start = Date.now();
  let is_up = false, status_code = null, response_time_ms = null, error = null;

  try {
    const res = await axios.get(target.url, { timeout: 10000, validateStatus: () => true });
    status_code = res.status;
    response_time_ms = Date.now() - start;
    is_up = status_code >= 200 && status_code < 400;
  } catch (err) {
    response_time_ms = Date.now() - start;
    error = err.message;
  }

  try {
    await pool.query(
      'INSERT INTO ping_logs (target_id, status_code, response_time_ms, is_up, error) VALUES ($1, $2, $3, $4, $5)',
      [target.id, status_code, response_time_ms, is_up, error]
    );
    console.log(JSON.stringify({
      level: 'info', msg: 'Ping recorded',
      target: target.name, url: target.url,
      is_up, status_code, response_time_ms
    }));
  } catch (dbErr) {
    console.error(JSON.stringify({ level: 'error', msg: 'Failed to save ping', error: dbErr.message }));
  }
}

function getSchedule(intervalSeconds) {
  // node-cron minimum is 1 second; clamp to reasonable values
  const secs = Math.max(10, intervalSeconds);
  if (secs < 60) return `*/${secs} * * * * *`; // every N seconds
  const mins = Math.floor(secs / 60);
  return `*/${mins} * * * *`;
}

async function startWorker() {
  const { rows: targets } = await pool.query('SELECT * FROM targets WHERE active = true');

  for (const target of targets) {
    scheduleTarget(target);
  }

  console.log(JSON.stringify({ level: 'info', msg: 'Worker started', targets: targets.length }));
}

function scheduleTarget(target) {
  if (jobs.has(target.id)) {
    jobs.get(target.id).stop();
  }

  const schedule = getSchedule(target.interval_seconds);
  const job = cron.schedule(schedule, () => pingTarget(target));
  jobs.set(target.id, job);

  // immediate first ping
  pingTarget(target);
}

function stopWorker() {
  for (const job of jobs.values()) job.stop();
  jobs.clear();
}

module.exports = { startWorker, stopWorker, pingTarget, scheduleTarget };
