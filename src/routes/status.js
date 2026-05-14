const express = require('express');
const router = express.Router();
const { pool } = require('../db');

/**
 * Queries all active targets with their 24h uptime, average response time,
 * and current status from the most recent ping log.
 *
 * Note: avg_response_ms_24h returns NULL (not 0) when there are no checks
 * in the last 24 hours, so the template can display "—" instead of a
 * misleading zero.
 *
 * @returns {Promise<Array>} Array of target rows
 */
async function getStatusData() {
  const { rows } = await pool.query(`
    SELECT
      t.id,
      t.name,
      t.url,
      t.active,
      COALESCE(
        ROUND(100.0 * SUM(CASE WHEN p.is_up THEN 1 ELSE 0 END) / NULLIF(COUNT(p.id), 0), 2),
        0
      ) AS uptime_percent_24h,
      COALESCE(ROUND(AVG(p.response_time_ms)), NULL) AS avg_response_ms_24h,
      (
        SELECT is_up FROM ping_logs
        WHERE target_id = t.id
        ORDER BY checked_at DESC LIMIT 1
      ) AS current_status
    FROM targets t
    LEFT JOIN ping_logs p
      ON p.target_id = t.id
      AND p.checked_at > NOW() - INTERVAL '24 hours'
    WHERE t.active = true
    GROUP BY t.id
    ORDER BY t.name
  `);
  return rows;
}

/**
 * Derives the overall system status from an array of target rows.
 *
 * Rows with current_status === null (no ping logs yet) are treated as
 * neither up nor down — they are skipped in the all-up / all-down checks.
 *
 * @param {Array} rows - Array of target rows from getStatusData()
 * @returns {string} One of: "No Monitors Configured", "All Systems Operational",
 *                           "Major Outage", "Degraded Performance"
 */
function computeOverallStatus(rows) {
  if (rows.length === 0) {
    return 'No Monitors Configured';
  }

  // Only consider rows that have a definitive status (true or false)
  const definitive = rows.filter(row => row.current_status !== null);

  const hasDown = definitive.some(row => row.current_status === false);
  const hasUp   = definitive.some(row => row.current_status === true);

  if (!hasDown && !hasUp) {
    // All rows have null current_status — treat like all-up (no known outage)
    return 'All Systems Operational';
  }

  if (hasDown && !hasUp) {
    return 'Major Outage';
  }

  if (!hasDown && hasUp) {
    return 'All Systems Operational';
  }

  // hasDown && hasUp
  return 'Degraded Performance';
}

/**
 * Maps an overall status string to its CSS banner modifier class.
 *
 * @param {string} overallStatus
 * @returns {string} CSS class modifier: "operational" | "degraded" | "outage" | "none"
 */
function bannerState(overallStatus) {
  switch (overallStatus) {
    case 'All Systems Operational': return 'operational';
    case 'Degraded Performance':    return 'degraded';
    case 'Major Outage':            return 'outage';
    default:                        return 'none';
  }
}

/**
 * Returns the indicator CSS modifier and aria-label for a target's current_status.
 *
 * @param {boolean|null} currentStatus
 * @returns {{ modifier: string, label: string }}
 */
function indicatorInfo(currentStatus) {
  if (currentStatus === true)  return { modifier: 'up',      label: 'Operational' };
  if (currentStatus === false) return { modifier: 'down',    label: 'Down' };
  return                              { modifier: 'unknown', label: 'No Data' };
}

/**
 * Formats a row's uptime_percent_24h value to two decimal places with a "%" suffix.
 *
 * pg returns NUMERIC columns as strings, so we parse first.
 *
 * @param {string|number} value
 * @returns {string} e.g. "99.95%"
 */
function formatUptime(value) {
  return `${parseFloat(value).toFixed(2)}%`;
}

/**
 * Formats a row's avg_response_ms_24h value.
 * Returns "—" when the value is null (no checks in the last 24 hours).
 *
 * @param {string|number|null} value
 * @returns {string} e.g. "142 ms" or "—"
 */
function formatAvgResponse(value) {
  if (value === null || value === undefined) return '—';
  return `${Math.round(Number(value))} ms`;
}

/**
 * Renders one <tr> for a target row.
 *
 * @param {object} row
 * @returns {string} HTML table row
 */
function renderRow(row) {
  const { modifier, label } = indicatorInfo(row.current_status);
  const uptime   = formatUptime(row.uptime_percent_24h);
  const avgResp  = formatAvgResponse(row.avg_response_ms_24h);

  return `
          <tr>
            <td><a href="${escapeHtml(row.url)}" rel="noopener noreferrer">${escapeHtml(row.name)}</a></td>
            <td>
              <span class="indicator indicator--${modifier}" aria-label="${label}"></span>
              ${escapeHtml(label)}
            </td>
            <td>${uptime}</td>
            <td>${avgResp}</td>
          </tr>`;
}

/**
 * Minimal HTML escaping to prevent XSS when embedding user-controlled strings.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders the full HTML status page as a string.
 *
 * @param {string} overallStatus - One of the four overall status labels
 * @param {Array}  rows          - Target rows from getStatusData()
 * @param {Date}   renderedAt    - Timestamp of when the page was rendered
 * @returns {string} Complete HTML document
 */
function renderStatusPage(overallStatus, rows, renderedAt) {
  const state     = bannerState(overallStatus);
  const timestamp = renderedAt.toLocaleString('en-GB', {
    day:    '2-digit',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const tableRows = rows.map(renderRow).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="60">
  <title>Sentinel Status</title>
  <style>
    /* ── Reset & base ─────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
                   Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      background: #f9fafb;
      color: #111827;
      min-width: 320px;
    }

    body {
      max-width: 1920px;
      margin: 0 auto;
      padding: 1.5rem 1rem;
      overflow-x: hidden;
    }

    /* ── Header ───────────────────────────────────────────────────── */
    header {
      margin-bottom: 1.5rem;
    }

    header h1 {
      font-size: clamp(1.5rem, 4vw, 2.25rem);
      font-weight: 700;
      color: #111827;
    }

    /* ── Banner ───────────────────────────────────────────────────── */
    .banner {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem 1.5rem;
      border-radius: 0.5rem;
      font-size: clamp(1rem, 2.5vw, 1.25rem);
      font-weight: 600;
      color: #fff;
      margin-bottom: 2rem;
      /* Ensure contrast ≥ 4.5:1 against white text on each background */
    }

    /* #22c55e on white text → contrast ~2.5:1 — use darker shade for AA */
    .banner--operational { background-color: #16a34a; } /* green-600, ~5.1:1 on #fff */
    .banner--degraded    { background-color: #a16207; } /* yellow-700, ~5.5:1 on #fff */
    .banner--outage      { background-color: #b91c1c; } /* red-700, ~5.9:1 on #fff */
    .banner--none        { background-color: #4b5563; } /* gray-600, ~7.0:1 on #fff */

    /* ── Table ────────────────────────────────────────────────────── */
    section[aria-label="Per-target status"] {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 480px;
    }

    thead th {
      text-align: left;
      padding: 0.625rem 0.75rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: #374151;
      background: #f3f4f6;
      border-bottom: 2px solid #e5e7eb;
    }

    tbody tr {
      border-bottom: 1px solid #e5e7eb;
    }

    tbody tr:last-child {
      border-bottom: none;
    }

    tbody td {
      padding: 0.75rem;
      font-size: 0.9375rem;
      vertical-align: middle;
      color: #111827;
    }

    tbody td a {
      color: #1d4ed8;
      text-decoration: none;
      word-break: break-all;
    }

    tbody td a:hover {
      text-decoration: underline;
    }

    /* ── Status indicator dot ─────────────────────────────────────── */
    .indicator {
      display: inline-block;
      width: 0.625rem;
      height: 0.625rem;
      border-radius: 50%;
      margin-right: 0.375rem;
      vertical-align: middle;
    }

    .indicator--up      { background-color: #16a34a; }
    .indicator--down    { background-color: #b91c1c; }
    .indicator--unknown { background-color: #6b7280; }

    /* ── Footer ───────────────────────────────────────────────────── */
    footer {
      margin-top: 2rem;
      font-size: 0.875rem;
      color: #6b7280;
    }

    footer p + p {
      margin-top: 0.25rem;
    }

    /* ── Responsive tweaks ────────────────────────────────────────── */
    @media (max-width: 600px) {
      tbody td {
        font-size: 0.875rem;
        padding: 0.625rem 0.5rem;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>Sentinel Status</h1>
  </header>

  <main>
    <section aria-label="Overall system status">
      <div class="banner banner--${state}">
        ${escapeHtml(overallStatus)}
      </div>
    </section>

    <section aria-label="Per-target status">
      <table>
        <thead>
          <tr>
            <th scope="col">Service</th>
            <th scope="col">Status</th>
            <th scope="col">Uptime (24h)</th>
            <th scope="col">Avg Response</th>
          </tr>
        </thead>
        <tbody>${tableRows}
        </tbody>
      </table>
    </section>

    <footer>
      <p>Last updated: ${timestamp}</p>
      <p id="countdown">Next refresh in: <span id="seconds">60</span>s</p>
    </footer>
  </main>

  <script>
    (function () {
      var el = document.getElementById('seconds');
      var remaining = 60;
      var timer = setInterval(function () {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(timer);
          remaining = 0;
        }
        el.textContent = remaining;
      }, 1000);
    })();
  </script>
</body>
</html>`;
}

/**
 * Returns a minimal HTML error page indicating that status data is temporarily
 * unavailable. Does NOT include stack traces or database error details.
 *
 * @returns {string} Complete HTML document
 */
function renderErrorPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sentinel Status — Unavailable</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
                   Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      background: #f9fafb;
      color: #111827;
    }
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem 1rem;
      text-align: center;
    }
    h1 {
      font-size: clamp(1.25rem, 4vw, 1.75rem);
      font-weight: 700;
      margin-bottom: 1rem;
      color: #111827;
    }
    p {
      font-size: 1rem;
      color: #6b7280;
      max-width: 480px;
    }
  </style>
</head>
<body>
  <h1>Status Temporarily Unavailable</h1>
  <p>We were unable to retrieve status data at this time. Please try again in a few moments.</p>
</body>
</html>`;
}

// ── Route handler ──────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const rows = await getStatusData();
    const overallStatus = computeOverallStatus(rows);
    const html = renderStatusPage(overallStatus, rows, new Date());
    res.send(html);
  } catch (err) {
    const errorHtml = renderErrorPage();
    res.status(503).send(errorHtml);
  }
});

module.exports = router;
module.exports.getStatusData = getStatusData;
module.exports.computeOverallStatus = computeOverallStatus;
module.exports.renderStatusPage = renderStatusPage;
module.exports.renderErrorPage = renderErrorPage;
