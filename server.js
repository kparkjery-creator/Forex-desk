const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const HORIZON_DAYS = 180;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE = path.join(__dirname, "data", "calendar.json");

const MAJORS = [
  { key: "NFP", match: /non-farm|nonfarm|payroll/i, leads: [/adp/i, /jobless|claims/i, /ism manufacturing/i, /jolts/i] },
  { key: "CPI", match: /consumer price|cpi\b/i, leads: [/producer price|ppi/i, /pce/i] },
  { key: "PPI", match: /producer price|ppi\b/i, leads: [/cpi|consumer price/i] },
  { key: "FOMC", match: /fomc|fed interest|federal funds|interest rate decision/i, leads: [/cpi|consumer price/i, /pce/i, /payroll|non-farm|nonfarm/i] },
  { key: "PCE", match: /pce/i, leads: [/cpi|consumer price/i, /ppi|producer price/i] }
];

function iso(d) {
  return d.toISOString().slice(0, 10);
}

async function pullRange() {
  const from = iso(new Date());
  const toDate = new Date();
  toDate.setDate(toDate.getDate() + HORIZON_DAYS);
  const to = iso(toDate);
  const url = `https://biquote.io/api/calendar?countries=US&from=${from}&to=${to}`;
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "forex-desk/1.0" } });
  if (!res.ok) throw new Error("calendar " + res.status);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(events) {
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  const payload = { fetchedAt: new Date().toISOString(), events };
  fs.writeFileSync(CACHE, JSON.stringify(payload));
  return payload;
}

async function calendarWeekly(force) {
  const cached = readCache();
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < WEEK_MS;
  if (cached && fresh && !force) return cached;
  try {
    const events = await pullRange();
    return writeCache(events);
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}
function mapEvent(e) {
  return {
    title: e.name,
    date: e.time,
    impact: e.importance || "medium",
    forecast: e.forecast ?? "",
    previous: e.previous ?? "",
    actual: e.actual ?? ""
  };
}

function step(title, actual, forecast) {
  const claims = /jobless|claims/i.test(title);
  const a = Number(actual);
  const f = Number(forecast);
  if (actual == null || forecast == null || actual === "" || forecast === "" || Number.isNaN(a) || Number.isNaN(f)) {
    return { title, status: "waiting", text: title + " has not printed. No signal yet.", points: 0 };
  }
  if (claims && a < f) return { title, status: "usd-up", text: title + " " + a + " vs " + f + " forecast. Lower claims = labor still tight. USD up, gold down.", points: 1 };
  if (claims && a > f) return { title, status: "usd-down", text: title + " " + a + " vs " + f + " forecast. Higher claims = labor softening. USD down, gold up.", points: -1 };
  if (a > f) return { title, status: "usd-up", text: title + " " + a + " vs " + f + " forecast. Hotter than expected. USD up, gold down.", points: 1 };
  if (a < f) return { title, status: "usd-down", text: title + " " + a + " vs " + f + " forecast. Softer than expected. USD down, gold up.", points: -1 };
  return { title, status: "flat", text: title + " in line with forecast. No new direction.", points: 0 };
}

function signalFor(next, leads) {
  const steps = leads.map((e) => step(e.title, e.actual, e.forecast));
  const score = steps.reduce((n, s) => n + s.points, 0);
  const printed = steps.filter((s) => s.status !== "waiting");
  let call = "Wait. Not enough printed leads.";
  let gold = "Do not buy or sell gold only on this yet.";
  if (printed.length) {
    if (score >= 2) { call = "Signal: firm into " + (next ? next.title : "the event") + ". Expect USD up if the print holds."; gold = "Sell gold if wages or core also come in hot."; }
    else if (score === 1) { call = "Signal: slight USD-up lean into " + (next ? next.title : "the event") + "."; gold = "Lean sell gold. Flip only if wages or core print soft."; }
    else if (score <= -2) { call = "Signal: soft into " + (next ? next.title : "the event") + ". USD dip risk."; gold = "Buy gold only if the big print confirms soft."; }
    else if (score === -1) { call = "Signal: slight USD-down lean."; gold = "Lean buy gold, but wait for the big print."; }
    else call = "Signal: mixed. The small prints cancel out. The big event decides.";
  }
  return { score, call, gold, steps };
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/desk", async (req, res) => {
  try {
    const pack = await calendarWeekly(req.query.refresh === "1");
    const events = (pack.events || [])
      .filter((e) => e.countryCode === "US" || e.currency === "USD")
      .map(mapEvent)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const high = events.filter((e) => String(e.impact).toLowerCase() === "high");

    const majors = MAJORS.map((m) => {
      const upcoming = high.filter((e) => m.match.test(e.title));
      const next = upcoming[0] || null;
      const leads = next
        ? events.filter((e) => new Date(e.date) < new Date(next.date) && m.leads.some((rx) => rx.test(e.title))).slice(-6)
        : [];
      return { key: m.key, next, later: upcoming.slice(1, 6), leads, signal: signalFor(next, leads) };
    });

    const byMonth = {};
    for (const e of high) {
      const d = new Date(e.date);
      const key = d.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
      (byMonth[key] ||= []).push(e);
    }

    res.json({
      updated: new Date().toISOString(),
      horizonDays: HORIZON_DAYS,
      source: "biquote",
      fetchedAt: pack.fetchedAt,
      nextRefresh: new Date(new Date(pack.fetchedAt).getTime() + WEEK_MS).toISOString(),
      bias: signalFor(majors.find((m) => m.next)?.next, events.filter((e) => e.actual !== "" && e.actual != null).slice(-8)),
      majors,
      months: byMonth
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.get("/api/ticks", async (_req, res) => {
  const token = process.env.METAAPI_TOKEN;
  if (!token) return res.status(400).json({ error: "METAAPI_TOKEN is not set on Render" });
  try {
    const headers = { "auth-token": token, Accept: "application/json" };
    const accountsRes = await fetch("https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts", { headers });
    if (!accountsRes.ok) return res.status(502).json({ error: "MetaApi accounts " + accountsRes.status });
    const accounts = await accountsRes.json();
    const account = accounts.find((a) => a._id === process.env.METAAPI_ACCOUNT_ID) || accounts[0];
    if (!account) return res.status(404).json({ error: "No MetaApi account" });
    const region = account.region || "new-york";
    const base = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${account._id}`;
    const wanted = [
      ["Gold", ["XAUUSD", "XAUUSDm"]],
      ["EURUSD", ["EURUSD", "EURUSDm"]],
      ["Oil", ["USOIL", "XTIUSD", "UKOIL", "USOILm"]],
      ["DXY", ["DXY", "USDX", "USDINDEX"]]
    ];
    const quotes = [];
    for (const [name, symbols] of wanted) {
      let hit = null;
      for (const symbol of symbols) {
        const q = await fetch(`${base}/symbols/${symbol}/current-price?keepSubscription=true`, { headers });
        if (!q.ok) continue;
        hit = { name, symbol, ...(await q.json()) };
        break;
      }
      quotes.push(hit || { name, symbol: symbols[0], error: "not on this Exness account" });
    }
    res.json({ account: account.name || account._id, state: account.state, quotes, time: new Date().toISOString() });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.get("/api/news", async (_req, res) => {
  const feeds = [
    ["Asia", "https://news.google.com/rss/search?q=dollar+OR+Treasury+yields+when:1d&hl=en-US&gl=US&ceid=US:en"],
    ["London", "https://news.google.com/rss/search?q=euro+OR+ECB+OR+gold+when:1d&hl=en-GB&gl=GB&ceid=GB:en"],
    ["New York", "https://news.google.com/rss/search?q=NFP+OR+Fed+OR+oil+dollar+when:1d&hl=en-US&gl=US&ceid=US:en"]
  ];
  const items = [];
  for (const [session, url] of feeds) {
    try {
      const xml = await (await fetch(url, { headers: { "User-Agent": "forex-desk" } })).text();
      const blocks = xml.split("<item>").slice(1, 6);
      for (const block of blocks) {
        const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
        const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
        if (title) items.push({ session, title: title.replace(/&/g, "&").trim(), link: link.trim() });
      }
    } catch (err) {
      items.push({ session, title: "Feed failed: " + err.message, link: "" });
    }
  }
  res.json({ updated: new Date().toISOString(), items });
});

app.listen(PORT, () => console.log("forex-desk on " + PORT));
