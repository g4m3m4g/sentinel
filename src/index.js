require('dotenv').config();
const app = require('./app');
const { initDB, checkPoolHealth } = require('./db');
const { startWorker } = require('./workers/pinger');

const PORT = process.env.PORT || 3000;

async function main() {
  try {
    await initDB();
    await startWorker();

    // Log DB pool health every 5 minutes
    setInterval(checkPoolHealth, 5 * 60 * 1000);

    app.listen(PORT, () => {
      console.log(JSON.stringify({ level: 'info', msg: `Sentinel running on port ${PORT}` }));
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'fatal', msg: 'Startup failed', error: err.message }));
    process.exit(1);
  }
}

main();
