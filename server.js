// KASCCO Store Control System — persistent storage backend
// Postgres (Neon) key/value API + static frontend from /public
//
// Recommended folder layout on the host:
//
//   server.js
//   package.json
//   public/
//     index.html          ← thin shell (public)
//     mims.css
//     mims-app.js         ← app logic (still downloadable by browser, but not mixed into HTML)
//     login-bg/
//       slide-1.jpg …
//
// Data is NOT in those files — it lives in Postgres via /api/storage/:key

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // inline boot scripts in index.html
}));

// Photos on user profiles + backups need headroom
app.use(express.json({ limit: '15mb' }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
app.use('/api/', apiLimiter);

const PUBLIC_DIR = path.join(__dirname, 'public');

// Static frontend — long cache for css/js (HTML stays revalidated)
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.(?:js|css|jpg|jpeg|png|webp|svg|woff2)$/i.test(filePath)) {
      // 7 days — bump ?v= on index.html MIMS_PATHS.version when you deploy new assets
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    } else if (/\.html?$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}
if (!API_KEY) {
  console.warn('WARNING: API_KEY is not set. /api/storage is UNPROTECTED.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const provided = req.header('x-api-key');
  if (!provided || !safeEqual(provided, API_KEY)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

const KEY_PATTERN = /^[a-zA-Z0-9:_-]{1,200}$/;
function requireValidKey(req, res, next) {
  if (!KEY_PATTERN.test(req.params.key)) {
    return res.status(400).json({ error: 'invalid_key' });
  }
  next();
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// Batch get — reduces round-trips from the frontend (optional; single GET still works)
app.post('/api/storage/batchGet', requireApiKey, async (req, res) => {
  try {
    const keys = Array.isArray(req.body && req.body.keys) ? req.body.keys : [];
    const clean = keys.filter(k => typeof k === 'string' && KEY_PATTERN.test(k)).slice(0, 50);
    if (!clean.length) return res.json({ values: {} });
    const result = await pool.query(
      'SELECT key, value FROM kv_store WHERE key = ANY($1::text[])',
      [clean]
    );
    const values = {};
    for (const row of result.rows) values[row.key] = row.value;
    res.json({ values });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/storage/:key', requireApiKey, requireValidKey, async (req, res) => {
  try {
    const { key } = req.params;
    const result = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ key, value: result.rows[0].value });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

/** Server-side guards: old browser tabs cannot wipe newer oil / catalog data */
function mergeOilItemsServer(remote, incoming) {
  if (!Array.isArray(incoming)) return remote;
  if (!Array.isArray(remote) || !remote.length) return incoming;
  const map = new Map();
  remote.forEach((r) => {
    if (r && r.id != null) map.set(String(r.id), r);
  });
  incoming.forEach((r) => {
    if (!r || r.id == null) return;
    const id = String(r.id);
    const prev = map.get(id);
    if (!prev) {
      if (!r.balUpdatedAt) r.balUpdatedAt = Date.now();
      map.set(id, r);
      return;
    }
    const pTs = Number(prev.balUpdatedAt || 0);
    const iTs = Number(r.balUpdatedAt || 0);
    // Remote newer → keep remote balances
    if (pTs && iTs && pTs > iTs) {
      map.set(id, prev);
      return;
    }
    // Incoming has no stamp (old tab) → keep remote balances
    if (pTs && !iTs) {
      map.set(id, Object.assign({}, r, {
        openingDay: prev.openingDay,
        opening: prev.opening,
        dayUsage: prev.dayUsage,
        nightUsage: prev.nightUsage,
        closingDay: prev.closingDay,
        closingNight: prev.closingNight,
        balance: prev.balance,
        balUpdatedAt: prev.balUpdatedAt
      }));
      return;
    }
    const merged = Object.assign({}, prev, r);
    if (!merged.balUpdatedAt) merged.balUpdatedAt = Date.now();
    map.set(id, merged);
  });
  // keep remote-only products
  return Array.from(map.values());
}

function mergeInventoryServer(remote, incoming) {
  if (!Array.isArray(incoming)) return remote;
  if (!Array.isArray(remote) || !remote.length) return incoming;
  const weak = (v) => {
    const s = String(v || '').trim().toLowerCase();
    return !s || s === '(part)' || s === 'part' || s === '-' || s === '—';
  };
  const weakCode = (v) => {
    const s = String(v || '').trim().toUpperCase();
    return !s || s === '-' || s === '—' || s === 'GEN-X' || s === 'GEN';
  };
  const map = new Map();
  remote.forEach((r) => {
    if (r && r.id != null) map.set(String(r.id), r);
  });
  incoming.forEach((r) => {
    if (!r || r.id == null) return;
    const id = String(r.id);
    const prev = map.get(id) || {};
    const merged = Object.assign({}, prev, r);
    // qty: always take incoming (live issues/receives)
    if (r.qty != null) merged.qty = r.qty;
    // catalog fields: do not let empty wipe good remote
    if (weak(r.description) && !weak(prev.description)) merged.description = prev.description;
    if (weakCode(r.stockCode) && !weakCode(prev.stockCode)) merged.stockCode = prev.stockCode;
    const pShelf = String(prev.shelfCode || prev.shelf || '').trim();
    const iShelf = String(r.shelfCode || r.shelf || '').trim();
    if (!iShelf && pShelf) {
      merged.shelfCode = prev.shelfCode || prev.shelf;
      merged.shelf = prev.shelf || prev.shelfCode;
    }
    if (!merged.make && prev.make) merged.make = prev.make;
    map.set(id, merged);
  });
  return Array.from(map.values());
}

app.post('/api/storage/:key', requireApiKey, requireValidKey, async (req, res) => {
  try {
    const { key } = req.params;
    let { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: 'missing_value' });
    }

    // Load existing value for protected keys
    if (key === 'oilItems' || key === 'inventory') {
      const existing = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
      if (existing.rows.length) {
        const remote = existing.rows[0].value;
        if (key === 'oilItems') {
          value = mergeOilItemsServer(remote, value);
        } else if (key === 'inventory') {
          value = mergeInventoryServer(remote, value);
        }
      } else if (key === 'oilItems' && Array.isArray(value)) {
        const ts = Date.now();
        value.forEach((r) => {
          if (r && !r.balUpdatedAt) r.balUpdatedAt = ts;
        });
      }
    }

    await pool.query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
    res.json({ key, value });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.delete('/api/storage/:key', requireApiKey, requireValidKey, async (req, res) => {
  try {
    const { key } = req.params;
    await pool.query('DELETE FROM kv_store WHERE key = $1', [key]);
    res.json({ key, deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/storage', requireApiKey, async (req, res) => {
  try {
    const result = await pool.query('SELECT key, updated_at FROM kv_store ORDER BY key');
    res.json({ keys: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// SPA fallback — any non-API route serves index.html
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'server_error' });
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`KASCCO storage API + static public/ on port ${PORT}`));
  })
  .catch((e) => {
    console.error('Failed to set up database schema:', e);
    process.exit(1);
  });
