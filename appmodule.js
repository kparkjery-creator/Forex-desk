// Forex Desk mobile app: accounts, plans, gated dashboard, signal history.
// Mounted from server.js with: require("./appmodule")(app, express);
// Storage: data/app-users.json and data/app-signals.json (on Render's free tier the disk resets on redeploy; attach a Render Disk or move to a database for real use).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = path.join(__dirname, "data");
const USERS = path.join(DIR, "app-users.json");
const SIGS = path.join(DIR, "app-signals.json");
const SECRET_FILE = path.join(DIR, "app-secret.txt");

const PLANS = {
  standard: { name: "Standard", price: 15, keys: ["NFP", "CPI", "CORE", "FOMC"], bias: "3 major releases (NFP, CPI, FOMC)", direction: false, swing: false },
  pro: { name: "Pro", price: 25, keys: ["NFP", "CPI", "CORE", "PPI", "FOMC", "PCE"], bias: "all high-impact USD releases", direction: false, swing: false },
  ultimate: { name: "Ultimate", price: 50, keys: ["NFP", "CPI", "CORE", "PPI", "FOMC", "PCE"], bias: "all high-impact USD releases", direction: true, swing: true }
};

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, body) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(body, null, 2)); }

function secret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  try { return fs.readFileSync(SECRET_FILE, "utf8").trim(); } catch {}
  const s = crypto.randomBytes(32).toString("hex");
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(SECRET_FILE, s); } catch {}
  return s;
}
const SECRET = secret();

function hashPw(pw, salt) { salt = salt || crypto.randomBytes(16).toString("hex"); return { salt, hash: crypto.scryptSync(pw, salt, 64).toString("hex") }; }
function checkPw(pw, u) { const h = crypto.scryptSync(pw, u.salt, 64); const b = Buffer.from(u.hash, "hex"); return b.length === h.length && crypto.timingSafeEqual(h, b); }

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return body + "." + mac;
}
function verify(token) {
  if (!token || typeof token !== "string") return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const good = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}

const attempts = new Map(); // ip+email -> {n, t}
function throttled(key) {
  const now = Date.now(), a = attempts.get(key);
  if (!a || now - a.t > 15 * 60000) { attempts.set(key, { n: 0, t: now }); return false; }
  return a.n >= 8;
}
function fail(key) { const a = attempts.get(key) || { n: 0, t: Date.now() }; a.n++; attempts.set(key, a); }

function publicUser(u) {
  const active = u.status === "active" && (!u.expires || new Date(u.expires) > new Date());
  return { email: u.email, plan: u.plan || null, status: active ? "active" : (u.status === "pending" ? "pending" : (u.status === "active" ? "expired" : "none")), expires: u.expires || null };
}

module.exports = function mount(app, express) {
  const json = express.json({ limit: "50kb" });
  const sendErr = (res, code, msg) => res.status(code).json({ error: msg });

  function auth(req, res, next) {
    const t = (req.headers.authorization || "").replace(/^Bearer /, "");
    const p = verify(t);
    if (!p) return sendErr(res, 401, "Please log in again.");
    const users = readJson(USERS, []);
    const u = users.find((x) => x.email === p.email);
    if (!u) return sendErr(res, 401, "Account not found.");
    req.user = u; req.users = users; next();
  }
  function admin(req, res, next) {
    const key = process.env.ADMIN_KEY;
    if (!key) return sendErr(res, 503, "Admin is off: set the ADMIN_KEY environment variable on the server.");
    const given = String(req.headers["x-admin-key"] || "");
    const a = Buffer.from(given), b = Buffer.from(key);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return sendErr(res, 403, "Wrong admin key.");
    next();
  }

  app.post("/api/app/signup", json, (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const pw = String(req.body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return sendErr(res, 400, "Enter a valid email.");
    if (pw.length < 8 || pw.length > 100) return sendErr(res, 400, "Password must be 8 to 100 characters.");
    const users = readJson(USERS, []);
    if (users.some((u) => u.email === email)) return sendErr(res, 409, "That email already has an account. Log in instead.");
    const h = hashPw(pw);
    const u = { email, salt: h.salt, hash: h.hash, plan: null, status: "none", created: new Date().toISOString() };
    users.push(u); writeJson(USERS, users);
    res.json({ token: sign({ email, exp: Date.now() + 30 * 86400000 }), user: publicUser(u) });
  });

  app.post("/api/app/login", json, (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const pw = String(req.body.password || "");
    const key = (req.ip || "") + "|" + email;
    if (throttled(key)) return sendErr(res, 429, "Too many attempts. Try again in 15 minutes.");
    const u = readJson(USERS, []).find((x) => x.email === email);
    if (!u || !checkPw(pw, u)) { fail(key); return sendErr(res, 401, "Wrong email or password."); }
    attempts.delete(key);
    res.json({ token: sign({ email, exp: Date.now() + 30 * 86400000 }), user: publicUser(u) });
  });

  app.get("/api/app/me", auth, (req, res) => res.json({ user: publicUser(req.user), plans: PLANS, payment: process.env.PAYMENT_NOTE || "" }));

  // The user asks for a plan; it stays "pending" until the admin confirms payment.
  app.post("/api/app/plan", auth, json, (req, res) => {
    const plan = String(req.body.plan || "");
    if (!PLANS[plan]) return sendErr(res, 400, "Unknown plan.");
    req.user.plan = plan; req.user.status = "pending"; req.user.requested = new Date().toISOString();
    writeJson(USERS, req.users);
    res.json({ user: publicUser(req.user), payment: process.env.PAYMENT_NOTE || "Payment is confirmed by the admin. Contact the admin with your account email, then your plan is switched on." });
  });

  async function loadDesk() {
    const port = process.env.PORT || 3000;
    const r = await fetch("http://127.0.0.1:" + port + "/api/desk");
    if (!r.ok) throw new Error("desk " + r.status);
    return r.json();
  }

  app.get("/api/app/dashboard", auth, async (req, res) => {
    const pu = publicUser(req.user);
    if (pu.status !== "active") return res.status(402).json({ error: pu.status === "pending" ? "Your plan is waiting for payment confirmation." : "Choose a plan to see signals.", user: pu });
    const plan = PLANS[pu.plan];
    const out = { user: pu, plan: { key: pu.plan, ...plan }, events: [], bias: null, biasLocked: null, direction: null, swing: null, daily: null, notice: null };
    try {
      const d = await loadDesk();
      const now = Date.now() - 3 * 3600000;
      for (const m of d.majors || []) {
        if (!plan.keys.includes(m.key) || !m.next) continue;
        const t = new Date(m.next.date).getTime();
        if (t < now) continue;
        out.events.push({ key: m.key, title: m.next.title, date: m.next.date, forecast: m.next.forecast, previous: m.next.previous });
      }
      out.events.sort((a, b) => new Date(a.date) - new Date(b.date));
      const b = d.bias || {};
      const allowed = plan.keys.includes(b.focusKey) || (b.focusKey === "—");
      if (allowed) {
        out.bias = { focusTitle: b.focusTitle, focusWhen: b.focusWhen, call: b.call, gold: b.gold, score: b.score, noTrade: b.noTrade, lockPreEvent: b.lockPreEvent, blockedByPrice: b.blockedByPrice, macroLean: b.macroLean, whatMatters: b.whatMatters, narrative: b.narrative, rule: b.rule, pulse: b.pulse };
        if (plan.direction) out.direction = { lean: b.macroLean || "flat", text: b.gold, score: b.score };
      } else {
        out.biasLocked = "The next big release (" + (b.focusTitle || b.focusKey) + ") is not on the Standard plan. Pro covers all high-impact USD news.";
      }
    } catch (e) {
      out.notice = "Market data is unavailable right now. Try again in a minute.";
    }
    const sigs = readJson(SIGS, []);
    const today = new Date().toISOString().slice(0, 10);
    out.daily = sigs.filter((s) => s.type === "daily" && s.date === today).slice(-1)[0] || null;
    if (plan.swing) out.swing = sigs.filter((s) => s.type === "swing" && !s.result).slice(-1)[0] || null;
    res.json(out);
  });

  app.get("/api/app/history", auth, (req, res) => {
    const type = req.query.type === "swing" ? "swing" : "daily";
    const pu = publicUser(req.user);
    if (pu.status !== "active") return sendErr(res, 402, "Choose a plan to see history.");
    if (type === "swing" && !PLANS[pu.plan].swing) return sendErr(res, 403, "Swing history is on the Ultimate plan.");
    const d = new Date();
    const cur = d.toISOString().slice(0, 7);
    const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const rows = readJson(SIGS, []).filter((s) => s.type === type && [cur, prev].includes(String(s.date).slice(0, 7))).sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
    const closed = rows.filter((r) => r.result === "win" || r.result === "loss");
    const wins = closed.filter((r) => r.result === "win").length;
    res.json({ type, rows, wins, losses: closed.length - wins, winRate: closed.length ? Number((wins / closed.length).toFixed(3)) : null, note: "Only the current and previous month are shown. A small sample says little about the future." });
  });

  // ---- admin (ADMIN_KEY required) ----
  app.get("/api/app/admin/users", admin, (req, res) => res.json({ users: readJson(USERS, []).map(publicUser) }));
  app.post("/api/app/admin/activate", admin, json, (req, res) => {
    const users = readJson(USERS, []);
    const u = users.find((x) => x.email === String(req.body.email || "").toLowerCase());
    if (!u) return sendErr(res, 404, "No such user.");
    const plan = String(req.body.plan || u.plan || "");
    if (!PLANS[plan]) return sendErr(res, 400, "Unknown plan.");
    const days = Math.max(1, Math.min(366, parseInt(req.body.days, 10) || 30));
    u.plan = plan; u.status = "active"; u.expires = new Date(Date.now() + days * 86400000).toISOString();
    writeJson(USERS, users); res.json({ user: publicUser(u) });
  });
  app.post("/api/app/admin/deactivate", admin, json, (req, res) => {
    const users = readJson(USERS, []);
    const u = users.find((x) => x.email === String(req.body.email || "").toLowerCase());
    if (!u) return sendErr(res, 404, "No such user.");
    u.status = "none"; writeJson(USERS, users); res.json({ user: publicUser(u) });
  });
  app.post("/api/app/admin/signal", admin, json, (req, res) => {
    const b = req.body || {};
    const type = b.type === "swing" ? "swing" : "daily";
    const side = ["BUY", "SELL", "FLAT"].includes(b.side) ? b.side : null;
    if (!side) return sendErr(res, 400, "Side must be BUY, SELL or FLAT.");
    const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
    const sigs = readJson(SIGS, []);
    const row = { id: crypto.randomBytes(6).toString("hex"), type, side, date: String(b.date || new Date().toISOString().slice(0, 10)).slice(0, 10), at: new Date().toISOString(), event: String(b.event || "").slice(0, 60), entry: num(b.entry), sl: num(b.sl), tp: num(b.tp), note: String(b.note || "").slice(0, 300), result: null };
    sigs.push(row); writeJson(SIGS, sigs); res.json({ signal: row });
  });
  app.post("/api/app/admin/result", admin, json, (req, res) => {
    const sigs = readJson(SIGS, []);
    const s = sigs.find((x) => x.id === req.body.id);
    if (!s) return sendErr(res, 404, "No such signal.");
    if (!["win", "loss", "scratch", null].includes(req.body.result)) return sendErr(res, 400, "Result must be win, loss or scratch.");
    s.result = req.body.result; writeJson(SIGS, sigs); res.json({ signal: s });
  });
  app.get("/api/app/admin/signals", admin, (req, res) => res.json({ signals: readJson(SIGS, []).slice(-60).reverse() }));
};
