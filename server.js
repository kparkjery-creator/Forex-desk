const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const HORIZON_DAYS = 180;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MS = 3 * 60 * 60 * 1000; // refresh calendar actuals every 3h
const CACHE = path.join(__dirname, "data", "calendar.json");

const MAJORS = [
  { key: "NFP", match: /non-farm|nonfarm|payroll/i, leads: [/adp/i, /jobless|claims/i, /ism manufacturing/i, /jolts/i] },
  { key: "CORE", match: /core\s*(cpi|pce)|cpi.*ex.*food|ex food and energy|core consumer/i, leads: [/producer price|ppi/i, /ism.*prices/i, /payroll|non-farm|nonfarm|average hourly|hourly earnings/i] },
  { key: "CPI", match: /consumer price|cpi\b/i, leads: [/producer price|ppi/i, /ism.*prices/i, /payroll|non-farm|nonfarm|average hourly|hourly earnings/i, /core\s*cpi/i] },
  { key: "PPI", match: /producer price|ppi\b/i, leads: [/cpi|consumer price/i, /ism.*prices/i] },
  { key: "FOMC", match: /fomc|fed interest|federal funds|interest rate decision/i, leads: [/core\s*(cpi|pce)/i, /cpi|consumer price/i, /pce/i, /payroll|non-farm|nonfarm/i] },
  { key: "PCE", match: /\bpce\b|personal consumption/i, leads: [/core\s*cpi/i, /cpi|consumer price/i, /ppi|producer price/i] }
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
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MS;
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

function eventFamily(title) {
  const t = String(title || "");
  if (/core\s*(cpi|pce)|ex food and energy/i.test(t)) return "CORE";
  if (/consumer price|\bcpi\b/i.test(t)) return "CPI";
  if (/\bpce\b|personal consumption/i.test(t)) return "PCE";
  if (/producer price|\bppi\b/i.test(t)) return "PPI";
  if (/fomc|fed interest|federal funds|interest rate decision/i.test(t)) return "FOMC";
  if (/non-?farm|payroll/i.test(t)) return "NFP";
  if (/retail sales/i.test(t)) return "RETAIL";
  if (/ism manufacturing/i.test(t)) return "ISM";
  return "OTHER";
}

function isTier1(family) {
  return /CPI|CORE|PCE|PPI|FOMC|NFP/.test(family);
}

function hoursUntil(dateStr) {
  if (!dateStr) return null;
  return (new Date(dateStr).getTime() - Date.now()) / 3600000;
}

/** What actually moves each Tier-1 event — lead weights by family */
function leadWeight(leadTitle, targetFamily) {
  const t = String(leadTitle || "");
  const core = /core\s*(cpi|pce)|ex food and energy/i.test(t);
  const headlineCpi = /consumer price|\bcpi\b/i.test(t) && !core;
  const ppi = /producer price|\bppi\b/i.test(t);
  const ismPx = /ism.*prices|prices paid/i.test(t);
  const wages = /hourly earnings|average hourly|wage/i.test(t);
  const payroll = /non-?farm|payroll/i.test(t);
  const claims = /jobless|claims/i.test(t);
  const adp = /adp/i.test(t);
  const jolts = /jolts/i.test(t);
  const ismEmp = /ism.*employment/i.test(t);
  const retail = /retail sales/i.test(t);

  // matrix: weight for this lead given the TARGET event family
  switch (targetFamily) {
    case "CPI":
    case "CORE":
    case "PCE":
      if (core) return 3.0;           // Core is the decision print
      if (ppi || ismPx) return 2.0;   // price pipeline
      if (headlineCpi) return 1.0;    // headline secondary
      if (wages) return 0.5;          // soft wages ≠ soft CPI
      if (payroll || claims || adp || jolts || ismEmp) return 0.4;
      return 0.3;
    case "PPI":
      if (ppi) return 3.0;
      if (ismPx) return 2.5;
      if (core) return 1.5;
      if (payroll || wages) return 0.5;
      return 0.5;
    case "NFP":
      if (payroll) return 3.0;
      if (wages) return 2.5;          // wages are the gold flip for NFP
      if (adp || claims || jolts || ismEmp) return 2.0;
      if (retail) return 1.0;
      if (core || ppi || ismPx) return 0.5; // inflation leads weak for NFP path
      return 0.5;
    case "FOMC":
      if (core) return 3.0;
      if (ppi || ismPx || headlineCpi) return 2.0;
      if (payroll || wages) return 1.5;
      return 0.5;
    default:
      if (core || wages) return 2.0;
      if (ppi || ismPx || payroll) return 1.5;
      return 1.0;
  }
}

function isPolicyLead(title) {
  const t = String(title || "");
  if (/michigan|sentiment|current conditions|consumer expectations/i.test(t) && !/inflation expectation/i.test(t)) return false;
  return /payroll|non-?farm|hourly earnings|wage|jobless|claims|adp|jolts|ism.*prices|ism.*employment|producer price|\bppi\b|core\s*(cpi|pce)|consumer price|\bcpi\b|pce|retail sales|employment/i.test(t);
}

function step(title, actual, forecast, targetTitle) {
  const targetFamily = eventFamily(targetTitle);
  const claims = /jobless|claims/i.test(title);
  const core = /core\s*(cpi|pce)|ex food and energy/i.test(title);
  const wages = /hourly earnings|average hourly|wage/i.test(title);
  const labor = /payroll|non-?farm|claims|adp|jolts|employment/i.test(title) && !wages;
  const weight = leadWeight(title, targetFamily);

  const a = Number(actual);
  const f = Number(forecast);
  if (actual == null || forecast == null || actual === "" || forecast === "" || Number.isNaN(a) || Number.isNaN(f)) {
    return { title, status: "waiting", text: title + " has not printed. No signal yet.", points: 0, weight };
  }
  let points = 0;
  let status = "flat";
  let text = title + " in line. No new direction.";
  if (claims && a < f) {
    status = "usd-up"; points = weight;
    text = title + " " + a + " vs " + f + " (tight labor). Weight " + weight + " for " + targetFamily + ".";
  } else if (claims && a > f) {
    status = "usd-down"; points = -weight;
    text = title + " " + a + " vs " + f + " (soft labor). Weight " + weight + " for " + targetFamily + ".";
  } else if (a > f) {
    status = "usd-up"; points = weight;
    text = title + " " + a + " vs " + f + " HOT. Weight " + weight + " → " + targetFamily + "." + (core ? " Decision print." : labor || wages ? " Secondary for this event." : "");
  } else if (a < f) {
    status = "usd-down"; points = -weight;
    text = title + " " + a + " vs " + f + " SOFT. Weight " + weight + " → " + targetFamily + "." + (core ? " Decision print." : labor || wages ? " Secondary for this event." : "");
  }
  return { title, status, text, points, weight };
}

/** Live price-action filter: gold, DXY, 10Y day change + vs 20SMA */
async function readPriceAction() {
  const out = {
    goldLast: null, goldChg: null, goldVsSma: null,
    dxyLast: null, dxyChg: null, dxyVsSma: null,
    y10: null, yChg: null,
    agreesBuyGold: false,
    agreesSellGold: false,
    text: "Price action unavailable"
  };
  function sma(vals, n) {
    const c = vals.filter((v) => v != null);
    if (c.length < n) return null;
    const s = c.slice(-n);
    return s.reduce((a, b) => a + b, 0) / s.length;
  }
  try {
    const g = await yahooChart("GC=F", "1d", "3mo");
    const meta = g.chart.result[0].meta;
    const q = g.chart.result[0].indicators.quote[0];
    const closes = q.close || [];
    out.goldLast = Number(meta.regularMarketPrice);
    const prev = Number(meta.chartPreviousClose || meta.previousClose || out.goldLast);
    out.goldChg = out.goldLast - prev;
    const ma = sma(closes, 20);
    out.goldVsSma = ma != null ? (out.goldLast >= ma ? "above" : "below") : null;
  } catch (err) {}
  try {
    const d = await yahooChart("DX-Y.NYB", "1d", "3mo");
    const meta = d.chart.result[0].meta;
    const closes = d.chart.result[0].indicators.quote[0].close || [];
    out.dxyLast = Number(meta.regularMarketPrice);
    const prev = Number(meta.chartPreviousClose || meta.previousClose || out.dxyLast);
    out.dxyChg = out.dxyLast - prev;
    const ma = sma(closes, 20);
    out.dxyVsSma = ma != null ? (out.dxyLast >= ma ? "above" : "below") : null;
  } catch (err) {}
  try {
    const y = await yahooChart("^TNX", "1d", "5d");
    const meta = y.chart.result[0].meta;
    out.y10 = Number(meta.regularMarketPrice);
    const prev = Number(meta.chartPreviousClose || meta.previousClose || out.y10);
    out.yChg = out.y10 - prev;
  } catch (err) {}

  // Buy gold agreement: gold firm or reclaiming, DXY soft, yields not ripping higher
  const goldOk = out.goldChg == null || out.goldChg >= -5;
  const dxySoft = out.dxyChg == null || out.dxyChg <= 0.05;
  const yieldsOk = out.yChg == null || out.yChg <= 0.03;
  out.agreesBuyGold = goldOk && dxySoft && yieldsOk && out.goldVsSma !== "below";

  // Sell gold agreement: gold soft, DXY firm or yields up
  const goldWeak = out.goldChg != null && out.goldChg < -5;
  const dxyFirm = out.dxyChg != null && out.dxyChg > 0.05;
  const yieldsUp = out.yChg != null && out.yChg > 0.02;
  out.agreesSellGold = (goldWeak || out.goldVsSma === "below") && (dxyFirm || yieldsUp || out.dxyVsSma === "above");

  out.text = [
    out.goldLast != null ? ("Gold " + out.goldLast.toFixed(1) + " Δ" + (out.goldChg != null ? out.goldChg.toFixed(1) : "—") + " SMA " + (out.goldVsSma || "—")) : null,
    out.dxyLast != null ? ("DXY " + out.dxyLast.toFixed(2) + " Δ" + (out.dxyChg != null ? out.dxyChg.toFixed(3) : "—") + " SMA " + (out.dxyVsSma || "—")) : null,
    out.y10 != null ? ("10Y " + out.y10.toFixed(2) + " Δ" + (out.yChg != null ? out.yChg.toFixed(3) : "—")) : null
  ].filter(Boolean).join(" · ") || "Price action unavailable";
  return out;
}

function decisionPrintValue(family, leads, next) {
  const rows = [next, ...(leads || [])].filter(Boolean);
  // Prefer actual on the NEXT event itself (just printed)
  if (next && next.actual !== "" && next.actual != null) {
    if (/core\s*(cpi|pce)|ex food and energy/i.test(next.title)) {
      return { key: "core", value: Number(next.actual), title: next.title };
    }
    if (/non-?farm|payroll/i.test(next.title)) {
      const wage = rows.find((e) => /hourly earnings|average hourly/i.test(e.title) && e.actual !== "" && e.actual != null);
      return { key: "nfp", value: Number(next.actual), wage: wage ? Number(wage.actual) : null, title: next.title };
    }
    if (/producer price|\bppi\b/i.test(next.title)) {
      return { key: "ppi", value: Number(next.actual), title: next.title };
    }
  }
  // For upcoming inflation events, past Core CPI is context (lastDecision) not the live decision
  if (family === "CPI" || family === "CORE") {
    const core = rows.find((e) => /core\s*cpi|cpi.*ex.*food|ex food and energy/i.test(e.title) && e.actual !== "" && e.actual != null);
    // only if that core print is the same day as next or next already printed
    if (core && next && Math.abs(new Date(core.date) - new Date(next.date)) < 2 * 86400000) {
      return { key: "core", value: Number(core.actual), title: core.title };
    }
  }
  if (family === "PCE") {
    const core = rows.find((e) => /core\s*pce/i.test(e.title) && e.actual !== "" && e.actual != null);
    if (core) return { key: "core", value: Number(core.actual), title: core.title };
  }
  if (family === "NFP") {
    const nfp = rows.find((e) => /non-?farm|payroll/i.test(e.title) && e.actual !== "" && e.actual != null);
    const wage = rows.find((e) => /hourly earnings|average hourly/i.test(e.title) && e.actual !== "" && e.actual != null);
    if (nfp) return { key: "nfp", value: Number(nfp.actual), wage: wage ? Number(wage.actual) : null, title: nfp.title };
  }
  if (family === "PPI") {
    const ppi = rows.find((e) => /producer price|core\s*ppi|\bppi\b/i.test(e.title) && e.actual !== "" && e.actual != null);
    if (ppi) return { key: "ppi", value: Number(ppi.actual), title: ppi.title };
  }
  if (family === "FOMC") {
    // FOMC is decision text; no numeric here
    return null;
  }
  return null;
}

function buildNarrative(sig, focus) {
  const key = (focus && focus.key) || sig.family || "OTHER";
  if (sig.lockPreEvent) {
    return "FLAT into every Tier-1. No lean on forecasts. Leads are background only. Trade the decision print after release, and only if price action agrees.";
  }
  if (key === "FOMC" || sig.family === "FOMC") {
    return "FOMC: trade statement wording + Chair, not a priced hold alone. Hot Core CPI (0.3%) is the main lead — sell-gold lean only after hawkish surprise AND price agrees. FLAT in last 2h before 20:00 CAT.";
  }
  if (sig.blockedByPrice) {
    return "Macro lean exists but PRICE ACTION blocks it. " + (sig.priceAction && sig.priceAction.text ? sig.priceAction.text + ". " : "") + "Wait for gold + DXY + yields to align.";
  }
  if (sig.decision) {
    return sig.call + " " + (sig.gold || "");
  }
  return "Scenario board for " + key + ". What matters: " + (sig.whatMatters || "decision print") + ". No pre-print size.";
}

function signalFor(next, leads, priceAction) {
  const targetTitle = next ? next.title : "";
  const family = eventFamily(targetTitle);
  const filtered = (leads || []).filter((e) => isPolicyLead(e.title));
  const steps = filtered.map((e) => step(e.title, e.actual, e.forecast, targetTitle));
  let score = Math.round(steps.reduce((n, s) => n + s.points, 0) * 10) / 10;
  const printed = steps.filter((s) => s.status !== "waiting");
  const decision = decisionPrintValue(family, leads, next);

  const hrs = hoursUntil(next && next.date);
  const tier1 = isTier1(family);
  // Flat into ANY Tier-1 in the last 2 hours until decision print is in
  const lockPreEvent = tier1 && hrs != null && hrs > -0.25 && hrs <= 2 && !decision;

  const whatMattersMap = {
    CPI: "Core CPI MoM (not headline energy)",
    CORE: "Core CPI MoM",
    PCE: "Core PCE MoM",
    PPI: "Core PPI / PPI MoM",
    NFP: "Payrolls + average hourly earnings (wages are the gold flip)",
    FOMC: "Statement + dots + Chair — not the hold that was priced",
    OTHER: "The actual print vs forecast"
  };
  const whatMatters = whatMattersMap[family] || whatMattersMap.OTHER;

  let call = "Wait. Not enough printed leads.";
  let gold = "Do not buy or sell gold only on this yet.";
  let noTrade = true;
  let blockedByPrice = false;
  let macroLean = null; // "buy_gold" | "sell_gold" | null

  if (lockPreEvent) {
    call = "FLAT · " + family + " within 2 hours. Scenarios only.";
    gold = "No lean into the print. Trade " + whatMatters + " after release + price agreement.";
    score = 0;
  } else if (decision) {
    // Post-decision rules — every event family
    if (decision.key === "core") {
      if (decision.value >= 0.3) {
        macroLean = "sell_gold";
        call = "Decision: Core HOT " + decision.value + "%.";
        gold = "Sell gold / USD firm — unless price action blocks.";
        score = Math.max(score, 3);
        noTrade = false;
      } else if (decision.value <= 0.2) {
        macroLean = "buy_gold";
        call = "Decision: Core soft/in line " + decision.value + "%.";
        gold = "Buy gold path — only if price action agrees.";
        score = Math.min(score, -3);
        noTrade = false;
      } else {
        call = "Decision: Core " + decision.value + "% mixed.";
        gold = "Flat until gold and DXY agree.";
      }
    } else if (decision.key === "nfp") {
      const softJobs = decision.value < (Number((next && next.forecast) || leads.find((l) => /payroll/i.test(l.title))?.forecast) || decision.value + 1);
      const softWages = decision.wage != null && decision.wage <= 0.2;
      if (softJobs && softWages) {
        macroLean = "buy_gold";
        call = "Decision: NFP soft + wages soft.";
        gold = "Buy gold path — only if price action agrees.";
        score = Math.min(score, -3);
        noTrade = false;
      } else if (!softJobs || (decision.wage != null && decision.wage >= 0.3)) {
        macroLean = "sell_gold";
        call = "Decision: NFP firm and/or wages hot.";
        gold = "Sell gold path — only if price action agrees.";
        score = Math.max(score, 3);
        noTrade = false;
      } else {
        call = "Decision: NFP mixed.";
        gold = "Flat — need wages + price agreement.";
      }
    } else if (decision.key === "ppi") {
      if (decision.value > 0.3) {
        macroLean = "sell_gold";
        call = "Decision: PPI hot " + decision.value + ".";
        gold = "Sell-gold lean into CPI window if price agrees.";
        noTrade = false;
        score = Math.max(score, 2);
      } else if (decision.value < 0.2) {
        macroLean = "buy_gold";
        call = "Decision: PPI soft " + decision.value + ".";
        gold = "Soft pipeline — buy-gold lean if price agrees.";
        noTrade = false;
        score = Math.min(score, -2);
      }
    }
  } else if (printed.length) {
    // Background only — never a pre-print order for any Tier-1
    if (tier1) {
      call = "Scenario board · " + family + " · score " + score + " (background only).";
      gold = "FLAT until " + whatMatters + " prints. Leads do not authorize size.";
      noTrade = true;
    } else if (score >= 2) {
      macroLean = "sell_gold";
      call = "Firm leads (non-Tier1).";
      gold = "Sell-gold lean if price agrees.";
      noTrade = false;
    } else if (score <= -2) {
      macroLean = "buy_gold";
      call = "Soft leads (non-Tier1).";
      gold = "Buy-gold lean if price agrees.";
      noTrade = false;
    } else {
      call = "Mixed leads.";
      gold = "Flat.";
    }
  }

  // PRICE ACTION GATE — required for any directional lean
  if (macroLean && priceAction) {
    if (macroLean === "buy_gold" && !priceAction.agreesBuyGold) {
      blockedByPrice = true;
      noTrade = true;
      gold = "Macro wants buy gold but PRICE BLOCKS: " + priceAction.text + ". Wait for alignment.";
      call = (call || "") + " · blocked by price action";
    } else if (macroLean === "sell_gold" && !priceAction.agreesSellGold) {
      blockedByPrice = true;
      noTrade = true;
      gold = "Macro wants sell gold but PRICE BLOCKS: " + priceAction.text + ". Wait for alignment.";
      call = (call || "") + " · blocked by price action";
    } else if (macroLean === "buy_gold" && priceAction.agreesBuyGold) {
      gold = "Buy gold — macro + price action agree. " + priceAction.text;
    } else if (macroLean === "sell_gold" && priceAction.agreesSellGold) {
      gold = "Sell gold — macro + price action agree. " + priceAction.text;
    }
  } else if (macroLean && !priceAction) {
    gold = (gold || "") + " (price action not loaded — treat as unconfirmed)";
    noTrade = true;
  }

  return {
    score,
    call,
    gold,
    steps,
    noTrade,
    lockPreEvent: !!lockPreEvent,
    blockedByPrice,
    postPrintCore: decision && decision.key === "core" ? decision.value : null,
    decision,
    family,
    whatMatters,
    macroLean,
    priceAction: priceAction || null,
    rule: "Every Tier-1: flat into the print. Weight leads by what moves THAT event. Decision print decides. Price action (gold+DXY+yields) must agree or stay flat."
  };
}

function mergeLeads(primary, fallback) {
  const out = [...primary];
  const keys = new Set(primary.map((e) => e.title.toLowerCase()));
  for (const row of fallback) {
    if (!keys.has(row.title.toLowerCase())) out.push(row);
  }
  return out.sort((a, b) => new Date(a.date) - new Date(b.date));
}

const WEEK_LEADS = [
  { title: "ADP employment", date: "2026-09-30T12:15:00Z", actual: "90", forecast: "68", previous: "36" },
  { title: "Initial jobless claims", date: "2026-10-01T12:30:00Z", actual: "197", forecast: "200", previous: "198" },
  { title: "ISM manufacturing employment", date: "2026-10-01T14:00:00Z", actual: "52.7", forecast: "51.2", previous: "51.2" },
  { title: "ISM prices paid", date: "2026-10-01T14:00:00Z", actual: "77.9", forecast: "71.1", previous: "71.1" },
  { title: "Nonfarm payrolls", date: "2026-10-02T12:30:00Z", actual: "29", forecast: "90", previous: "133" },
  { title: "Average hourly earnings", date: "2026-10-02T12:30:00Z", actual: "0.1", forecast: "0.3", previous: "0.3" }
];

const CPI_LEADS = [
  { title: "Nonfarm payrolls", date: "2026-10-02T12:30:00Z", actual: "29", forecast: "90", previous: "133" },
  { title: "Average hourly earnings", date: "2026-10-02T12:30:00Z", actual: "0.1", forecast: "0.3", previous: "0.3" },
  { title: "ISM prices paid", date: "2026-10-01T14:00:00Z", actual: "77.9", forecast: "71.1", previous: "71.1" },
  { title: "Core CPI MoM", date: "2026-10-14T12:30:00Z", actual: "0.3", forecast: "0.2", previous: "0.3" },
  { title: "CPI MoM", date: "2026-10-14T12:30:00Z", actual: "0.6", forecast: "0.6", previous: "0.4" },
  { title: "Core CPI YoY", date: "2026-10-14T12:30:00Z", actual: "2.6", forecast: "2.5", previous: "2.4" },
  { title: "CPI YoY", date: "2026-10-14T12:30:00Z", actual: "3.7", forecast: "3.6", previous: "3.4" }
];

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
      let next = upcoming[0] || null;
      if (m.key === "CORE" && upcoming.length) {
        const coreHit = upcoming.find((e) => /core/i.test(e.title));
        if (coreHit) next = coreHit;
      }
      if (m.key === "CPI" && upcoming.length) {
        const head = upcoming.find((e) => !/core/i.test(e.title));
        if (head) next = head;
      }
      const leads = next
        ? events.filter((e) => new Date(e.date) < new Date(next.date) && m.leads.some((rx) => rx.test(e.title))).slice(-6)
        : [];
      let used = leads.filter((e) => e.actual !== "" && e.actual != null);
      if (m.key === "NFP") {
        used = mergeLeads(used, WEEK_LEADS);
      }
      if (m.key === "CPI" || m.key === "CORE") {
        used = mergeLeads(used, CPI_LEADS);
      }
      if (!used.length && m.key === "NFP") used = WEEK_LEADS;
      if (!used.length && (m.key === "CPI" || m.key === "CORE")) used = CPI_LEADS;
      return { key: m.key, next, later: upcoming.filter((e) => e !== next).slice(0, 5), leads: used, signal: signalFor(next, used) };
    });

    const byMonth = {};
    for (const e of high) {
      const d = new Date(e.date);
      const key = d.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
      (byMonth[key] ||= []).push(e);
    }

    // Nearest upcoming Tier-1 by clock — do NOT prefer CORE over FOMC
    const ordered = majors
      .filter((m) => m.next && new Date(m.next.date).getTime() > Date.now() - 6 * 3600000)
      .sort((a, b) => new Date(a.next.date) - new Date(b.next.date));
    const focus = ordered[0] || majors.filter((m) => m.next).sort((a, b) => new Date(a.next.date) - new Date(b.next.date))[0];

    // Live printed leads first; static seeds only fill gaps (never override live actuals)
    const leadPool = events.filter((e) => e.actual !== "" && e.actual != null).slice(-20);
    function seedFill(primary, seeds) {
      return mergeLeads(primary, seeds); // primary wins on same title
    }
    let leadsForBias = leadPool.filter((e) => isPolicyLead(e.title));
    if (focus && (focus.key === "CPI" || focus.key === "CORE" || focus.key === "PCE" || focus.key === "FOMC")) {
      leadsForBias = seedFill(leadsForBias, CPI_LEADS).filter((e) => isPolicyLead(e.title));
    } else if (focus && focus.key === "NFP") {
      leadsForBias = seedFill(leadsForBias, WEEK_LEADS).filter((e) => isPolicyLead(e.title));
    } else {
      leadsForBias = seedFill(leadsForBias, CPI_LEADS.concat(WEEK_LEADS)).filter((e) => isPolicyLead(e.title));
    }
    // Drop stale seeds older than 45 days from lead scoring noise
    const cutoff = Date.now() - 45 * 86400000;
    leadsForBias = leadsForBias.filter((e) => !e.date || new Date(e.date).getTime() > cutoff);

    const pa = await readPriceAction();
    const sig = signalFor(focus?.next, leadsForBias, pa);
    sig.focusKey = focus?.key || "—";
    sig.focusTitle = focus?.next?.title || "—";
    sig.focusWhen = focus?.next?.date || null;
    sig.narrative = buildNarrative(sig, focus);
    sig.pulse = new Date().toISOString();
    // Last decision summary (past Core CPI etc.) separate from next-event focus
    const lastCore = leadsForBias.find((e) => /core\s*cpi/i.test(e.title) && e.actual !== "" && e.actual != null);
    if (lastCore) {
      sig.lastDecision = {
        title: lastCore.title,
        actual: lastCore.actual,
        forecast: lastCore.forecast,
        when: lastCore.date,
        lean: Number(lastCore.actual) >= 0.3 ? "sell_gold" : Number(lastCore.actual) <= 0.2 ? "buy_gold" : "flat"
      };
    }

    res.json({
      updated: new Date().toISOString(),
      horizonDays: HORIZON_DAYS,
      source: "biquote",
      fetchedAt: pack.fetchedAt,
      nextRefresh: new Date(new Date(pack.fetchedAt).getTime() + CACHE_MS).toISOString(),
      bias: sig,
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
      ["Gold 24/7", ["XAUUSD247"]],
      ["Gold", ["XAUUSD", "XAUUSDm", "XAUUSDr", "XAUUSDz"]],
      ["EURUSD", ["EURUSD", "EURUSDm"]],
      ["GBPUSD", ["GBPUSD", "GBPUSDm"]],
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

let goldCache = { at: 0, quote: null };

async function readGold() {
  const now = Date.now();
  if (goldCache.quote && now - goldCache.at < 1500) return goldCache.quote;
  const out = { source: "", bid: null, ask: null, price: null, prev: null, change: null, changePct: null, time: new Date().toISOString() };
  const token = process.env.METAAPI_TOKEN;
  if (token) {
    try {
      const headers = { "auth-token": token, Accept: "application/json" };
      const accounts = await (await fetch("https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts", { headers })).json();
      const account = Array.isArray(accounts) && (accounts.find((a) => a._id === process.env.METAAPI_ACCOUNT_ID) || accounts[0]);
      if (account) {
        const base = `https://mt-client-api-v1.${account.region || "new-york"}.agiliumtrade.ai/users/current/accounts/${account._id}`;
        // XAUUSD247 = Exness 7-day gold (weekend tradeable). Normal XAUUSD Mon–Fri.
        const goldSyms = ["XAUUSD247", "XAUUSD", "XAUUSDm", "XAUUSDr", "XAUUSDz"];
        for (const symbol of goldSyms) {
          const q = await fetch(`${base}/symbols/${symbol}/current-price?keepSubscription=true`, { headers });
          if (!q.ok) continue;
          const body = await q.json();
          if (body.bid == null && body.ask == null) continue;
          const bid = body.bid != null ? body.bid : body.ask;
          const ask = body.ask != null ? body.ask : body.bid;
          const quote = {
            ...out,
            source: "Exness " + symbol,
            symbol,
            bid,
            ask,
            price: bid,
            weekend247: /247/.test(symbol)
          };
          goldCache = { at: now, quote };
          return quote;
        }
      }
    } catch (err) {}
  }
  try {
    const yRes = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d", { headers: { "User-Agent": "Mozilla/5.0" } });
    if (yRes.ok) {
      const y = await yRes.json();
      const meta = (((y.chart || {}).result || [])[0] || {}).meta || {};
      const price = Number(meta.regularMarketPrice);
      const prev = Number(meta.previousClose || meta.chartPreviousClose);
      if (price) {
        const change = prev ? price - prev : null;
        const quote = {
          ...out,
          source: "COMEX GC=F",
          price,
          bid: price,
          ask: price,
          prev: prev || null,
          change,
          changePct: prev ? (change / prev) * 100 : null,
          time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : out.time
        };
        goldCache = { at: now, quote };
        return quote;
      }
    }
  } catch (err) {}
  try {
    const spot = await (await fetch("https://api.goldprice.dev/v1/prices?symbol=XAU-USD-SPOT")).json();
    const row = (spot.symbols || [])[0] || {};
    const price = Number(row.price);
    if (price) {
      const quote = { ...out, source: "spot", price, bid: Number(row.bid || price), ask: Number(row.ask || price) };
      goldCache = { at: now, quote };
      return quote;
    }
  } catch (err) {}
  if (goldCache.quote) return { ...goldCache.quote, source: goldCache.quote.source + " cached" };
  const err = new Error("gold feed unavailable");
  err.status = 502;
  throw err;
}

app.get("/api/gold", async (_req, res) => {
  try {
    res.json(await readGold());
  } catch (err) {
    res.status(err.status || 502).json({ error: String(err.message || err) });
  }
});

app.get("/api/gold/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders && res.flushHeaders();
  let closed = false;
  req.on("close", () => { closed = true; });
  const push = async () => {
    if (closed) return;
    try {
      res.write("data: " + JSON.stringify(await readGold()) + "\n\n");
    } catch (err) {
      res.write("data: " + JSON.stringify({ error: String(err.message || err) }) + "\n\n");
    }
  };
  await push();
  const timer = setInterval(push, 2000);
  req.on("close", () => clearInterval(timer));
});


let bookCache = { at: 0, body: null };
app.get("/api/book", async (_req, res) => {
  if (bookCache.body && Date.now() - bookCache.at < 20000) return res.json(bookCache.body);
  const symbols = [
    ["Gold", "GC=F", 0.4],
    ["DXY", "DX-Y.NYB", 0.02],
    ["Oil", "CL=F", 0.03],
    ["EURUSD", "EURUSD=X", 0.00012],
    ["GBPUSD", "GBPUSD=X", 0.00012]
  ];
  const quotes = [];
  for (const [name, symbol, spread] of symbols) {
    try {
      const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1m&range=1d";
      const raw = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 forex-desk" } });
      const text = await raw.text();
      if (!raw.ok || text.startsWith("Too Many")) throw new Error("rate limited");
      const body = JSON.parse(text);
      const meta = body.chart.result[0].meta;
      const last = Number(meta.regularMarketPrice);
      const prev = Number(meta.chartPreviousClose || meta.previousClose || last);
      const fx = /USD$|EURUSD|GBPUSD|USDJPY/.test(name) && name !== "DXY";
      const dp = fx ? 5 : 2;
      quotes.push({
        name, symbol, source: "live",
        bid: Number((last - spread / 2).toFixed(dp)),
        ask: Number((last + spread / 2).toFixed(dp)),
        last: Number(last.toFixed(dp)),
        change: Number((last - prev).toFixed(dp)),
        time: new Date((meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString()
      });
    } catch (err) {
      quotes.push({ name, symbol, error: String(err.message || err) });
    }
  }
  // Fill gold from Exness/readGold if yahoo gold failed
  const goldQ = quotes.find((q) => q.name === "Gold");
  if (goldQ && goldQ.error) {
    try {
      const g = await readGold();
      if (g.price) {
        goldQ.error = undefined;
        goldQ.bid = g.bid; goldQ.ask = g.ask; goldQ.last = g.price; goldQ.source = g.source;
      }
    } catch (err) {}
  }
  const body = { updated: new Date().toISOString(), quotes };
  if (quotes.some((q) => q.last != null)) bookCache = { at: Date.now(), body };
  res.json(body);
});

let macroCache = { at: 0, body: null };

async function yahooChart(symbol, interval, range) {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=" + interval + "&range=" + range;
  const raw = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 forex-desk" } });
  const text = await raw.text();
  if (!raw.ok || text.startsWith("Too Many")) throw new Error("yahoo " + symbol);
  return JSON.parse(text);
}

function atr14(highs, lows, closes) {
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i], l = lows[i], pc = closes[i - 1];
    if (h == null || l == null || pc == null || closes[i] == null) continue;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < 14) return null;
  const slice = trs.slice(-14);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function sma(vals, n) {
  const clean = vals.filter((v) => v != null);
  if (clean.length < n) return null;
  const s = clean.slice(-n);
  return s.reduce((a, b) => a + b, 0) / s.length;
}

// Override macro with full curve
app.get("/api/macro", async (_req, res) => {
  if (macroCache.body && Date.now() - macroCache.at < 60000) return res.json(macroCache.body);
  const out = { us10y: null, us5y: null, us3m: null, spread10_5: null, dxy: null, realYield: null, time: new Date().toISOString() };
  try {
    const y = await yahooChart("^TNX", "1d", "5d");
    out.us10y = Number(y.chart.result[0].meta.regularMarketPrice);
  } catch (err) {}
  try {
    const y = await yahooChart("^FVX", "1d", "5d");
    out.us5y = Number(y.chart.result[0].meta.regularMarketPrice);
  } catch (err) {}
  try {
    const y = await yahooChart("^IRX", "1d", "5d");
    out.us3m = Number(y.chart.result[0].meta.regularMarketPrice);
  } catch (err) {}
  try {
    const d = await yahooChart("DX-Y.NYB", "1d", "5d");
    out.dxy = Number(d.chart.result[0].meta.regularMarketPrice);
  } catch (err) {}
  if (out.us10y != null && out.us5y != null) out.spread10_5 = Number((out.us10y - out.us5y).toFixed(3));
  if (out.us10y != null && out.us3m != null) out.spread10_3m = Number((out.us10y - out.us3m).toFixed(3));
  if (out.us10y != null) out.realYield = Number((out.us10y - 2.4).toFixed(2));
  macroCache = { at: Date.now(), body: out };
  res.json(out);
});

let instCache = { at: 0, body: null };
app.get("/api/institutional", async (_req, res) => {
  if (instCache.body && Date.now() - instCache.at < 90000) return res.json(instCache.body);
  const out = {
    time: new Date().toISOString(),
    fedFunds: null,
    impliedRate: null,
    holdProb: null,
    hikeProb: null,
    cutProb: null,
    meeting: "2026-10-28",
    regime: global.DESK_REGIME || "mixed",
    tech: { gold: null, dxy: null },
    atr: { gold: null, goldPips: null },
    speakers: [],
    curve: null
  };
  try {
    const zq = await yahooChart("ZQ=F", "1d", "5d");
    const px = Number(zq.chart.result[0].meta.regularMarketPrice);
    out.fedFunds = px;
    out.impliedRate = Number((100 - px).toFixed(3));
    // Rough split vs 3.875 mid of 3.75-4.00 target: above mid → hike odds, below → cut/hold
    const mid = 3.875;
    const gap = out.impliedRate - mid;
    if (gap > 0.12) {
      out.hikeProb = Math.min(85, Math.round(50 + gap * 200));
      out.holdProb = 100 - out.hikeProb;
      out.cutProb = 0;
    } else if (gap < -0.12) {
      out.cutProb = Math.min(85, Math.round(50 + Math.abs(gap) * 200));
      out.holdProb = 100 - out.cutProb;
      out.hikeProb = 0;
    } else {
      out.holdProb = Math.round(55 + (1 - Math.abs(gap) / 0.12) * 20);
      out.hikeProb = Math.round((100 - out.holdProb) / 2);
      out.cutProb = 100 - out.holdProb - out.hikeProb;
    }
  } catch (err) {
    out.fedFundsError = String(err.message || err);
  }
  try {
    const g = await yahooChart("GC=F", "1d", "3mo");
    const q = g.chart.result[0].indicators.quote[0];
    const closes = q.close || [];
    const highs = q.high || [];
    const lows = q.low || [];
    const last = closes.filter((x) => x != null).slice(-1)[0];
    const ma20 = sma(closes, 20);
    const atr = atr14(highs, lows, closes);
    out.tech.gold = {
      last,
      sma20: ma20 ? Number(ma20.toFixed(2)) : null,
      vsSma: ma20 && last != null ? (last >= ma20 ? "above" : "below") : null
    };
    out.atr.gold = atr ? Number(atr.toFixed(2)) : null;
    out.atr.goldPips = atr ? Number(atr.toFixed(0)) : null;
  } catch (err) {}
  try {
    const d = await yahooChart("DX-Y.NYB", "1d", "3mo");
    const closes = d.chart.result[0].indicators.quote[0].close || [];
    const last = closes.filter((x) => x != null).slice(-1)[0];
    const ma20 = sma(closes, 20);
    out.tech.dxy = {
      last,
      sma20: ma20 ? Number(ma20.toFixed(2)) : null,
      vsSma: ma20 && last != null ? (last >= ma20 ? "above" : "below") : null
    };
  } catch (err) {}
  try {
    const pack = await calendarWeekly(false);
    const now = Date.now();
    out.speakers = (pack.events || [])
      .filter((e) => /fed|fomc|powell|williams|jefferson|waller|bowman|barr|collins|barkin|goolsbee|musalem/i.test(e.name || ""))
      .filter((e) => new Date(e.time).getTime() >= now - 86400000)
      .slice(0, 8)
      .map((e) => ({
        title: e.name,
        date: e.time,
        tone: /hike|tight|inflation|restrictive|higher/i.test(e.name || "") ? "hawkish" :
              /cut|ease|dovish|slowdown|soft/i.test(e.name || "") ? "dovish" : "neutral"
      }));
  } catch (err) {}
  try {
    const m = macroCache.body || {};
    out.curve = {
      us3m: m.us3m, us5y: m.us5y, us10y: m.us10y,
      spread10_5: m.spread10_5, spread10_3m: m.spread10_3m, realYield: m.realYield
    };
  } catch (err) {}
  instCache = { at: Date.now(), body: out };
  res.json(out);
});


let confCache = { at: 0, body: null };
app.get("/api/confluence", async (_req, res) => {
  if (confCache.body && Date.now() - confCache.at < 45000) return res.json(confCache.body);
  const out = {
    time: new Date().toISOString(),
    session: null,
    sessionNote: null,
    noTradeZone: false,
    fakeout: null,
    levels: null,
    deltas: [],
    orb: null,
    sizing: null,
    divergence: null,
    lockout: null
  };

  // Session profile in CAT (UTC+2)
  const catHour = (new Date().getUTCHours() + 2) % 24;
  if (catHour >= 0 && catHour < 8) {
    out.session = "Asia";
    out.sessionNote = "Quiet range. Smaller breakouts. Prefer mean-reversion templates, not news spikes.";
  } else if (catHour >= 8 && catHour < 14) {
    out.session = "London";
    out.sessionNote = "Liquidity builds. Range expansion common. Prepare ORB into 14:30 CAT US prints.";
  } else if (catHour >= 14 && catHour < 16) {
    out.session = "London–NY overlap";
    out.sessionNote = "Highest impact window. Tier-1 US data prints here. Widen stops, cut size.";
  } else if (catHour >= 16 && catHour < 22) {
    out.session = "New York";
    out.sessionNote = "Trend continuation or fade of the 14:30 move. Do not chase the first spike blindly.";
  } else {
    out.session = "Off-hours";
    out.sessionNote = "Thin liquidity. Avoid new risk unless 24/7 gold is the plan.";
  }

  // Pull desk bias for deltas + score
  let bias = null;
  let goldPx = null;
  let atr = null;
  let dxy = null;
  let us10y = null;
  let realYield = null;
  try {
    // reuse calendar/desk scoring without HTTP
    const pack = await calendarWeekly(false);
    const events = (pack.events || [])
      .filter((e) => e.countryCode === "US" || e.currency === "USD")
      .map(mapEvent)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const high = events.filter((e) => String(e.impact).toLowerCase() === "high");
    const nextHigh = high.find((e) => new Date(e.date) > new Date()) || high[0];
    const leadPool = events.filter((e) => e.actual !== "" && e.actual != null).slice(-12);
    let leads = typeof mergeLeads === "function" ? mergeLeads(leadPool, typeof CPI_LEADS !== "undefined" ? CPI_LEADS : []) : leadPool;
    if (typeof isPolicyLead === "function") leads = leads.filter((e) => isPolicyLead(e.title));
    const paConf = await readPriceAction();
    bias = signalFor(nextHigh, leads, paConf);
    out.deltas = (bias.steps || []).filter((st) => st.status !== "waiting").map((st) => ({
      title: st.title,
      status: st.status,
      points: st.points,
      text: st.text,
      color: st.status === "usd-up" ? "red" : st.status === "usd-down" ? "green" : "flat",
      // red = USD bullish / gold bearish; green = USD bearish / gold bullish
      sentiment: st.status === "usd-up" ? "USD-bullish / gold-bearish" : st.status === "usd-down" ? "USD-bearish / gold-bullish" : "neutral"
    }));
    out.score = bias.score;
    out.noTradeZone = bias.noTrade === true || bias.blockedByPrice === true || Math.abs(Number(bias.score) || 0) < 2 || bias.lockPreEvent === true;
    out.call = bias.call;
    out.gold = bias.gold;
    out.nextEvent = nextHigh ? { title: nextHigh.title, date: nextHigh.date, forecast: nextHigh.forecast, previous: nextHigh.previous } : null;

    // Event weight for sizing
    const title = (nextHigh && nextHigh.title) || "";
    let eventWeight = 1;
    if (/core\s*cpi|cpi\b|pce|fomc|payroll|nonfarm|nfp/i.test(title)) eventWeight = 2.2;
    else if (/ppi|claims|ism|retail/i.test(title)) eventWeight = 1.4;
    out.eventWeight = eventWeight;

    // ORB: conceptual pre-news box using ATR fraction (true 15m box needs live bars at event time)
    if (nextHigh) {
      const t = new Date(nextHigh.date).getTime();
      out.orb = {
        event: nextHigh.title,
        eventTime: nextHigh.date,
        preBoxStart: new Date(t - 15 * 60 * 1000).toISOString(),
        preBoxEnd: nextHigh.date,
        rule: "Track high/low of the 15 minutes before the print. Break of box + macro direction = primary path. Target 0.75× to 1.25× event ATR."
      };
    }
  } catch (err) {
    out.deskError = String(err.message || err);
  }

  try {
    const g = await yahooChart("GC=F", "1d", "3mo");
    const q = g.chart.result[0].indicators.quote[0];
    const closes = q.close || [];
    const highs = q.high || [];
    const lows = q.low || [];
    goldPx = closes.filter((x) => x != null).slice(-1)[0];
    atr = atr14(highs, lows, closes);
  } catch (err) {}
  try {
    const d = await yahooChart("DX-Y.NYB", "1d", "5d");
    dxy = Number(d.chart.result[0].meta.regularMarketPrice);
  } catch (err) {}
  try {
    const y = await yahooChart("^TNX", "1d", "5d");
    us10y = Number(y.chart.result[0].meta.regularMarketPrice);
    realYield = us10y != null ? Number((us10y - 2.4).toFixed(2)) : null;
  } catch (err) {}

  // Intraday proxy change for divergence (last vs prior close from daily)
  let goldChg = null, dxyChg = null, yieldChg = null;
  try {
    const g = await yahooChart("GC=F", "1d", "5d");
    const meta = g.chart.result[0].meta;
    goldChg = meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice);
  } catch (err) {}
  try {
    const d = await yahooChart("DX-Y.NYB", "1d", "5d");
    const meta = d.chart.result[0].meta;
    dxyChg = meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice);
  } catch (err) {}
  try {
    const y = await yahooChart("^TNX", "1d", "5d");
    const meta = y.chart.result[0].meta;
    yieldChg = meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice);
  } catch (err) {}

  if (goldPx != null && atr != null) {
    const a = atr;
    out.levels = {
      spot: Number(goldPx.toFixed(2)),
      atr: Number(a.toFixed(2)),
      // expected move boundaries around event
      upper1: Number((goldPx + a * 0.75).toFixed(2)),
      upper2: Number((goldPx + a * 1.25).toFixed(2)),
      lower1: Number((goldPx - a * 0.75).toFixed(2)),
      lower2: Number((goldPx - a * 1.25).toFixed(2)),
      // liquidity pool zones (stop clusters beyond 1× ATR)
      liquidityHigh: Number((goldPx + a * 1.5).toFixed(2)),
      liquidityLow: Number((goldPx - a * 1.5).toFixed(2)),
      note: "Boundaries use 14-day ATR. Institutional stops often sit beyond 1×–1.5× ATR from pre-news mid."
    };
    if (out.orb) {
      out.orb.targetUp = out.levels.upper1;
      out.orb.targetDown = out.levels.lower1;
      out.orb.stretchUp = out.levels.upper2;
      out.orb.stretchDown = out.levels.lower2;
    }
  }

  // Cross-asset divergence
  // Rising real yields + rising DXY should pressure gold. Gold up while yields up = fakeout risk.
  if (goldChg != null && yieldChg != null) {
    const goldUp = goldChg > 5;
    const goldDown = goldChg < -5;
    const yieldsUp = yieldChg > 0.02;
    const yieldsDown = yieldChg < -0.02;
    const dxyUp = dxyChg != null && dxyChg > 0.05;
    const dxyDown = dxyChg != null && dxyChg < -0.05;
    if (goldUp && yieldsUp) {
      out.fakeout = {
        level: "warning",
        title: "Fakeout warning",
        text: "Gold is up while yields are rising. Breakout may fail if real yields keep climbing. Wait for yield fade or gold rejection."
      };
    } else if (goldUp && dxyUp) {
      out.fakeout = {
        level: "warning",
        title: "Fakeout warning",
        text: "Gold rising with DXY firm is cross-asset divergence. Prefer confirmation after the dollar stalls."
      };
    } else if (goldDown && yieldsDown && dxyDown) {
      out.fakeout = {
        level: "info",
        title: "Aligned risk-on for gold",
        text: "Gold, yields and dollar soft together — move is supported by cross-asset flow."
      };
    } else {
      out.fakeout = {
        level: "clear",
        title: "No major divergence",
        text: "Gold, yields and DXY are not in a hard conflict right now."
      };
    }
    out.divergence = {
      goldChg: goldChg != null ? Number(goldChg.toFixed(2)) : null,
      dxyChg: dxyChg != null ? Number(dxyChg.toFixed(3)) : null,
      yieldChg: yieldChg != null ? Number(yieldChg.toFixed(3)) : null,
      us10y, realYield, dxy
    };
  }

  // Dynamic sizing
  const bal = 1000; // client overrides
  const baseRiskPct = 1;
  const weight = out.eventWeight || 1;
  const volMult = atr && out.levels ? Math.min(2.5, Math.max(1, atr / 40)) : 1;
  const riskPct = Number((baseRiskPct / weight / volMult).toFixed(2));
  const stopPts = atr ? Math.max(10, Math.round(atr * (0.4 + 0.2 * weight))) : 25;
  out.sizing = {
    eventWeight: weight,
    volMult: Number(volMult.toFixed(2)),
    suggestedRiskPct: riskPct,
    suggestedStopPts: stopPts,
    note: "High-impact prints cut suggested risk % and widen stop buffer for slippage."
  };

  // Lockout
  if (bias && bias.lockPreEvent) {
    out.lockout = {
      active: true,
      reason: "PRE-EVENT LOCKOUT · Tier-1 within 2 hours. No lean on forecasts or soft labor. Trade Core actual only after the print."
    };
  } else if (out.noTradeZone) {
    out.lockout = {
      active: true,
      reason: "NO-TRADE ZONE · Score ambiguous or system forbids pre-print leans. Wait for the Tier-1 actual + price confirmation."
    };
  } else if (bias && bias.blockedByPrice) {
    out.lockout = {
      active: true,
      reason: "PRICE-ACTION BLOCK · Macro lean exists but gold/DXY/yields do not agree. " + ((bias.priceAction && bias.priceAction.text) || "")
    };
  } else if (out.fakeout && out.fakeout.level === "warning") {
    out.lockout = {
      active: true,
      reason: "Fakeout warning active. Size down or wait — cross-asset flow fights the gold direction."
    };
  } else {
    out.lockout = { active: false, reason: "Path open. Still use event-sized risk." };
  }

  confCache = { at: Date.now(), body: out };
  res.json(out);
});


app.get("/api/fomc", (_req, res) => {
  // October 2026 FOMC: 27–28 Oct, statement 28 Oct 14:00 ET = 18:00 UTC = 20:00 CAT
  const statementAt = new Date("2026-10-28T18:00:00Z");
  const hoursToStatement = (statementAt.getTime() - Date.now()) / 3600000;
  let status = "Upcoming";
  if (hoursToStatement <= 2 && hoursToStatement > -1) status = "LOCKOUT";
  else if (hoursToStatement <= 0) status = "Post-statement";
  res.json({
    title: "FOMC · 27–28 Oct 2026",
    whenText: "Statement <strong>28 Oct 20:00 CAT</strong> (14:00 ET) · Chair presser ~20:30 CAT · <strong>No SEP / dots</strong>",
    statementIso: statementAt.toISOString(),
    hoursToStatement: Number(hoursToStatement.toFixed(2)),
    status,
    currentRange: "3.75%–4.00%",
    priorDecision: "Sep 2026 +25 bp to 3.75%–4.00%",
    hasSep: false,
    whatMatters: "Statement wording + Chair presser — not only the rate decision",
    scenarios: [
      { outcome: "Hike +25", gold: "sell", usd: "firm" },
      { outcome: "Hold hawkish", gold: "sell_lean", usd: "firm" },
      { outcome: "Hold neutral", gold: "fade", usd: "mixed" },
      { outcome: "Hold dovish", gold: "buy_lean", usd: "soft" }
    ],
    rules: [
      "FLAT in the last 2 hours before statement",
      "Trade statement surprise, not the priced hold alone",
      "Press conference can reverse the first move",
      "Price gate required (gold + DXY + yields)",
      "Hot Core CPI 0.3% already leans sell gold into this meeting"
    ]
  });
});

app.listen(PORT, () => console.log("forex-desk on " + PORT));

