const majorsEl = document.getElementById("majors");
const monthsEl = document.getElementById("months");

function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function isTier1(title) {
  return /non-?farm|payroll|fomc|fed interest|federal funds|interest rate decision|core\s*(cpi|pce)|consumer price|\bcpi\b|\bpce\b|producer price|\bppi\b/i.test(title || "");
}

function nums(e) {
  const parts = [];
  if (e.actual !== "" && e.actual != null) {
    parts.push(`<span class="pill act">act ${e.actual}</span>`);
  } else {
    parts.push(`<span class="pill upcoming">upcoming</span>`);
  }
  if (e.forecast !== "" && e.forecast != null) {
    parts.push(`<span class="pill fcst">fcst ${e.forecast}</span>`);
  }
  if (e.previous !== "" && e.previous != null) {
    parts.push(`<span class="pill prev">prev ${e.previous}</span>`);
  }
  return parts.join(" ");
}

/**
 * Calculates Delta (Surprise Factor) and Confluence Score based on Fed weights
 */
function calculateConfluenceScore(bias) {
  if (!bias) return;
  let score = 0;
  if (typeof bias.score === "number") score = bias.score;
  else if (typeof bias.score === "string") {
    const parsed = parseFloat(bias.score);
    score = isNaN(parsed) ? 0 : parsed;
  }
  score = Math.max(-10, Math.min(10, score));

  const pointerPercent = ((score + 10) / 20) * 100;
  const pointerEl = document.getElementById("confluence-pointer");
  if (pointerEl) pointerEl.style.left = pointerPercent + "%";

  const actionEl = document.getElementById("signal-action");
  if (!actionEl) return;

  // FIX: honor system lockouts — never show strong buy/sell into Tier-1 on forecasts
  if (bias.lockPreEvent) {
    actionEl.textContent = "Signal State: PRE-EVENT LOCKOUT — FLAT · every Tier-1 · trade decision print only after release";
    actionEl.className = "signal-action neutral";
    return;
  }
  if (bias.blockedByPrice) {
    actionEl.textContent = "Signal State: PRICE-ACTION BLOCK — macro lean exists but gold/DXY/yields disagree";
    actionEl.className = "signal-action neutral";
    return;
  }
  if (bias.noTrade) {
    actionEl.textContent = "Signal State: NO-TRADE ZONE — wait for decision print + price confirmation";
    actionEl.className = "signal-action neutral";
    return;
  }
  if (bias.postPrintCore != null && bias.postPrintCore >= 0.3) {
    actionEl.textContent = "Signal State: CORE HOT " + bias.postPrintCore + "% — SELL GOLD / USD FIRM";
    actionEl.className = "signal-action strong-buy";
    return;
  }
  if (bias.postPrintCore != null && bias.postPrintCore <= 0.2) {
    actionEl.textContent = "Signal State: CORE SOFT " + bias.postPrintCore + "% — BUY GOLD PATH IF PRICE HOLDS";
    actionEl.className = "signal-action strong-sell";
    return;
  }
  if (score >= 7) {
    actionEl.textContent = "Signal State: HIGH CONFLUENCE - STRONG BUY USD / STRONG SELL GOLD";
    actionEl.className = "signal-action strong-buy";
  } else if (score <= -7) {
    actionEl.textContent = "Signal State: HIGH CONFLUENCE - STRONG SELL USD / STRONG BUY GOLD";
    actionEl.className = "signal-action strong-sell";
  } else if (score >= 3) {
    actionEl.textContent = "Signal State: MODERATE USD BUY — confirm with price";
    actionEl.className = "signal-action mod-buy";
  } else if (score <= -3) {
    actionEl.textContent = "Signal State: MODERATE USD SELL — confirm with price";
    actionEl.className = "signal-action mod-sell";
  } else {
    actionEl.textContent = "Signal State: NO TRADE ZONE - Low Confluence / Conflicting Prints";
    actionEl.className = "signal-action neutral";
  }
}

function render(data) {
  document.getElementById("updated").textContent =
    "Calendar " + new Date(data.fetchedAt).toLocaleString() + " · next pull " + new Date(data.nextRefresh).toLocaleString() + " · focus " + ((data.bias && data.bias.focusKey) || "—");
  
  document.getElementById("usd").textContent = data.bias.call || "—";
  document.getElementById("gold").textContent = data.bias.gold || "—";
  document.getElementById("score").textContent = data.bias.score !== undefined ? data.bias.score : "—";
  document.getElementById("score").className = Number(data.bias.score) > 0 ? "pos" : Number(data.bias.score) < 0 ? "neg" : "flat";
  document.getElementById("gold").className = /sell/i.test(data.bias.gold || "") ? "neg" : /buy/i.test(data.bias.gold || "") ? "pos" : "";

  // Calculate and update confluence meter
  calculateConfluenceScore(data.bias);

  const orderedMajors = (data.majors || []).filter((m) => m.next).sort((a, b) => new Date(a.next.date) - new Date(b.next.date));
  const focus = orderedMajors.find((m) => m.key === "CORE") || orderedMajors.find((m) => m.key === "CPI") || orderedMajors[0] || data.majors[0];
  const stepRows = (data.bias && data.bias.steps && data.bias.steps.length) ? data.bias.steps : (focus?.signal?.steps || []);
  document.getElementById("steps").innerHTML = stepRows.map((s, i) => {
    const tone = s.status === "usd-up" ? "pos" : s.status === "usd-down" ? "neg" : "flat";
    const label = s.status === "usd-up" ? "USD UP" : s.status === "usd-down" ? "USD DOWN" : "WAITING";
    return `<div class="row"><strong>Step ${i + 1}. ${s.title}</strong><span class="${tone}">${label} · ${s.text}</span></div>`;
  }).join("") || "<div class='row'>No leading prints in the window yet.</div>";
  const narr = document.getElementById("narrative");
  if (narr) {
    const b = data.bias || {};
    const bits = [];
    if (b.focusTitle) bits.push("Next: " + b.focusTitle + (b.focusWhen ? " (" + when(b.focusWhen) + ")" : ""));
    if (b.lastDecision) bits.push("Last decision: " + b.lastDecision.title + " " + b.lastDecision.actual + " → " + (b.lastDecision.lean || "").replace("_", " "));
    if (b.narrative) bits.push(b.narrative);
    if (b.whatMatters) bits.push("What matters: " + b.whatMatters);
    if (b.priceAction && b.priceAction.text) bits.push("Price: " + b.priceAction.text);
    if (b.rule) bits.push("RULE: " + b.rule);
    narr.textContent = bits.filter(Boolean).join(" · ");
  }
  const pulse = document.getElementById("pulse");
  if (pulse) pulse.textContent = "Pulse " + new Date((data.bias && data.bias.pulse) || Date.now()).toLocaleTimeString();

  // Price action strip
  const pa = (data.bias && data.bias.priceAction) || {};
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  if (pa.goldLast != null) {
    const chg = pa.goldChg != null ? (pa.goldChg >= 0 ? "+" : "") + pa.goldChg.toFixed(1) : "";
    setTxt("pa-gold", pa.goldLast.toFixed(1) + " " + chg);
    setTxt("pa-gold-sma", "SMA " + (pa.goldVsSma || "—"));
  }
  if (pa.dxyLast != null) {
    const chg = pa.dxyChg != null ? (pa.dxyChg >= 0 ? "+" : "") + pa.dxyChg.toFixed(3) : "";
    setTxt("pa-dxy", pa.dxyLast.toFixed(2) + " " + chg);
    setTxt("pa-dxy-sma", "SMA " + (pa.dxyVsSma || "—"));
  }
  if (pa.y10 != null) {
    setTxt("pa-y10", pa.y10.toFixed(2));
    const yc = pa.yChg != null ? ((pa.yChg >= 0 ? "+" : "") + pa.yChg.toFixed(3)) : "—";
    setTxt("pa-y-chg", "Δ " + yc);
  }
  const gateEl = document.getElementById("pa-gate");
  const gateNote = document.getElementById("pa-gate-note");
  if (gateEl) {
    if (data.bias && data.bias.lockPreEvent) {
      gateEl.textContent = "LOCKOUT";
      gateEl.className = "flat";
      if (gateNote) gateNote.textContent = "Pre-event flat";
    } else if (data.bias && data.bias.blockedByPrice) {
      gateEl.textContent = "BLOCKED";
      gateEl.className = "block";
      if (gateNote) gateNote.textContent = "Macro ≠ price";
    } else if (data.bias && data.bias.macroLean === "sell_gold" && pa.agreesSellGold) {
      gateEl.textContent = "SELL OK";
      gateEl.className = "agree";
      if (gateNote) gateNote.textContent = "Macro + price agree";
    } else if (data.bias && data.bias.macroLean === "buy_gold" && pa.agreesBuyGold) {
      gateEl.textContent = "BUY OK";
      gateEl.className = "agree";
      if (gateNote) gateNote.textContent = "Macro + price agree";
    } else if (data.bias && data.bias.noTrade) {
      gateEl.textContent = "FLAT";
      gateEl.className = "flat";
      if (gateNote) gateNote.textContent = "No trade zone";
    } else {
      gateEl.textContent = "OPEN";
      gateEl.className = "agree";
      if (gateNote) gateNote.textContent = pa.text || "Path clear";
    }
  }

    const primers = {
    NFP: "Jobs report. It counts how many jobs the US added. More jobs than forecast, and wages at 0.3% or higher, means the dollar is bid and gold is offered. A buy in gold needs wages soft and a jobs miss. Both.",
    CORE: "Core CPI strips out food and energy. This is the print the Fed watches. Hot core (0.3%+) = dollar up, sell gold. Soft core (0.1% or under) = dollar soft, buy gold. Headline alone does not decide the trade.",
    CPI: "Headline CPI includes food and oil. Energy can make the headline look hot while core stays calm. Trade the core number first. Headline noise from gasoline is secondary.",
    PPI: "Factory prices. This prints before CPI and often leads it. Hot PPI means costs are still rising, so do not fade the dollar into CPI.",
    FOMC: "The Fed rate decision. Higher for longer supports the dollar and weighs on gold. The statement and dots matter more than a hold that was already priced.",
    PCE: "The Fed's own inflation gauge. Core PCE is the real target. Soft core PCE eases hike pressure and can bounce gold. Hot core PCE puts the sell back on."
  };
  majorsEl.innerHTML = data.majors.map((m) => `
    <article class="card">
      <p>${m.key}</p>
      <h4>${m.next ? m.next.title : "No date in the next 6 months"}</h4>
      <p class="primer">${primers[m.key] || ""}</p>
      <div>${m.next ? when(m.next.date) + " · " + nums(m.next) : ""}</div>
      <div class="lead"><div><span class="tag">signal</span> ${m.signal.call} ${m.signal.gold}</div>
        <div><span class="tag">later</span> ${m.later.length ? m.later.map((e) => when(e.date)).join(" · ") : "—"}</div>
        ${(m.leads.length ? m.leads : [{ title: "Leads show once they enter the window" }]).map((e) => `<div><span class="tag">lead</span> ${e.title}${e.actual ? " · actual " + e.actual + " vs " + e.forecast : ""}</div>`).join("")}
      </div>
    </article>
  `).join("");

  monthsEl.innerHTML = Object.entries(data.months).map(([month, rows]) => `
    <article class="card month">
      <p class="month-label">${month}</p>
      ${rows.map((e) => {
        const tier = isTier1(e.title);
        return `<div class="cal-event${tier ? " tier1" : ""}">
          <div class="cal-event-top">
            ${tier ? '<span class="tier1-tag">TIER 1</span>' : ""}
            <strong>${e.title}</strong>
          </div>
          <div class="cal-event-meta">
            <span class="cal-when">${when(e.date)}</span>
            <span class="cal-nums">${nums(e)}</span>
          </div>
        </div>`;
      }).join("")}
    </article>
  `).join("") || "<p>No high-impact events returned.</p>";
}

async function load(force) {
  const res = await fetch("/api/desk" + (force ? "?refresh=1" : ""));
  const data = await res.json();
  if (!res.ok) {
    document.getElementById("updated").textContent = data.error || "Feed failed";
    return;
  }
  render(data);
}


let lastBook = {};
async function book() {
  const box = document.getElementById("book");
  if (!box) return;
  try {
    const data = await (await fetch("/api/book")).json();
    box.innerHTML = (data.quotes || []).map((q) => {
      const prev = lastBook[q.name];
      const dir = prev == null || q.last == null ? "" : q.last > prev ? "up" : q.last < prev ? "down" : "";
      if (q.last != null) lastBook[q.name] = q.last;
      const chg = q.change > 0 ? "pos" : q.change < 0 ? "neg" : "flat";
      return `<article class="quote ${dir}"><strong>${q.name}</strong><b>${q.bid ?? "—"}</b><small>bid ${q.bid ?? "—"} · ask ${q.ask ?? "—"}</small><small class="${chg}">${q.change > 0 ? "+" : ""}${q.change ?? "—"} vs prior close</small></article>`;
    }).join("");
  } catch (err) {
    box.textContent = "Bid/ask feed not ready. Upload server.js.";
  }
}
book();
setInterval(book, 2000);

const goldHist = [];
let lastGold = null;
function paintGold(q) {
  const tape = document.getElementById("gold-tape");
  const box = document.getElementById("gold-live");
  if (!q || q.error || (q.price == null && q.bid == null)) {
    if (tape) document.getElementById("gold-src").textContent = (q && q.error) || "feed down";
    return;
  }
  const price = Number(q.price != null ? q.price : q.bid);
  const dir = lastGold == null ? 0 : price - lastGold;
  lastGold = price;
  goldHist.push(price);
  if (goldHist.length > 40) goldHist.shift();
  if (tape) {
    tape.classList.remove("up", "down");
    if (dir > 0) tape.classList.add("up");
    if (dir < 0) tape.classList.add("down");
    document.getElementById("gold-px").textContent = price.toFixed(2);
    const tag = document.querySelector("#gold-tape strong");
    if (tag) tag.textContent = q.weekend247 || /247/.test(q.source || "") ? "XAU247" : "XAU";
    const chg = q.change == null ? "" : (q.change >= 0 ? "+" : "") + Number(q.change).toFixed(2) + (q.changePct == null ? "" : " (" + (q.changePct >= 0 ? "+" : "") + Number(q.changePct).toFixed(2) + "%)");
    document.getElementById("gold-chg").textContent = chg || (q.bid && q.ask ? q.bid + " / " + q.ask : "");
    document.getElementById("gold-src").textContent = (q.source || "live") + (q.weekend247 ? " · 24/7" : "");
  }
  if (box) {
    const min = Math.min(...goldHist), max = Math.max(...goldHist);
    const pts = goldHist.map((v, i) => (i / Math.max(goldHist.length - 1, 1)) * 80 + "," + (20 - ((v - min) / (max - min || 1)) * 20)).join(" ");
    box.innerHTML = `<span><strong>Gold</strong> ${price.toFixed(2)}</span><span>${q.source || ""}</span><svg class="spark" viewBox="0 0 80 20"><polyline fill="none" stroke="#e2b656" stroke-width="1.5" points="${pts}"/></svg>`;
  }
}
function startGold() {
  if (window.EventSource) {
    try {
      const es = new EventSource("/api/gold/stream");
      es.onmessage = (ev) => { try { paintGold(JSON.parse(ev.data)); } catch (err) {} };
      es.onerror = () => {};
    } catch (err) {}
  }
  const poll = async () => {
    try {
      const q = await (await fetch("/api/gold")).json();
      if (q && (q.price || q.bid)) paintGold(q);
    } catch (err) {}
  };
  poll();
  setInterval(poll, 2500);
}
startGold();

async function macro() {
  try {
    const m = await (await fetch("/api/macro")).json();
    const y = document.getElementById("us10y-yield");
    const r = document.getElementById("real-yield");
    const d = document.getElementById("dxy-ticker");
    if (y && m.us10y != null) y.textContent = "US10Y: " + Number(m.us10y).toFixed(2) + "%";
    if (r && m.realYield != null) r.textContent = "Real Yield: " + m.realYield + "%";
    if (d && m.dxy != null) d.textContent = "DXY: " + Number(m.dxy).toFixed(2);
  } catch (err) {}
}
macro();
setInterval(macro, 60000);
async function ticks() {
  const box = document.getElementById("ticks");
  try {
    const data = await (await fetch("/api/ticks")).json();
    if (data.error) { if (box) box.textContent = data.error; return; }
    
    // Update live ticks block
    if (box) {
      box.innerHTML = data.quotes.map((q) => `<span><strong>${q.name}</strong> ${q.bid ?? "—"} / ${q.ask ?? "—"}</span>`).join("");
    }

    // Update Macro Dynamics Ticker in header
    const dxyQuote = data.quotes.find(q => q.name.includes("DXY") || q.name.includes("USD"));
    if (dxyQuote && document.getElementById("dxy-ticker")) {
      document.getElementById("dxy-ticker").textContent = `DXY: ${dxyQuote.bid ?? "--"}`;
    }
  } catch (err) {
    if (box) box.textContent = "Exness feed not ready";
  }
}

ticks();
setInterval(ticks, 2000);
load(false);
setInterval(() => load(false), 45000);

async function news() {
  const box = document.getElementById("news");
  if (!box) return;
  try {
    const data = await (await fetch("/api/news")).json();
    box.innerHTML = (data.items || []).map((n) => {
      const session = (n.session || "Desk").replace(/\s/g, "");
      return `<article class="story ${session}"><div class="pic">${n.session}</div><p>${n.title}</p>${n.link ? `<a href="${n.link}" target="_blank" rel="noopener">Read</a>` : ""}</article>`;
    }).join("") || "<div class='event'>No headlines</div>";
  } catch (err) {
    box.textContent = "News feed not ready. Upload server.js.";
  }
}
news();
setInterval(news, 300000);

// News filter buttons (Sessions tab)
document.querySelectorAll(".news-filter").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".news-filter").forEach((b) => b.classList.remove("on"));
    btn.classList.add("on");
    const filter = btn.dataset.filter;
    document.querySelectorAll("#news .story").forEach((story) => {
      if (filter === "all") {
        story.style.display = "";
        return;
      }
      const text = (story.textContent || "").toLowerCase();
      const match =
        (filter === "yields" && /yield|10y|treasury|bond/i.test(text)) ||
        (filter === "fed" && /fed|fomc|central bank|powell|rate/i.test(text)) ||
        (filter === "oil" && /oil|brent|wti|crude|dollar|dxy|usd/i.test(text));
      story.style.display = match ? "" : "none";
    });
  };
});

const titles = { board: "Market overview", charts: "Market charts", sessions: "Session drivers", setup: "Gold Daily Setup", calendar: "Market calendar", inst: "Institutional desk", confluence: "Macro–technical confluence" };
document.querySelectorAll(".tab").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("on"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("on"));
    btn.classList.add("on");
    document.getElementById(btn.dataset.tab).classList.add("on");
    document.getElementById("title").textContent = titles[btn.dataset.tab];
    if (btn.dataset.tab === "charts") showChart(currentSym);
  };
});

let currentSym = "OANDA:XAUUSD";
let chartTheme = "dark";
function showChart(sym) {
  currentSym = sym;
  const open = document.getElementById("tv-open");
  if (open) open.href = "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent(sym);
  const src = "https://s.tradingview.com/widgetembed/?symbol=" + encodeURIComponent(sym) +
    "&interval=15&hidesidetoolbar=0&hidetoptoolbar=0&symboledit=1&saveimage=1&withdateranges=1&details=1&hotlist=1&calendar=1&theme=" +
    chartTheme + "&style=1&timezone=Africa%2FJohannesburg&hideideas=1";
  document.getElementById("tv").innerHTML =
    `<iframe title="chart" src="${src}" style="width:100%;height:100%;border:0" allowfullscreen></iframe>`;
}
document.getElementById("theme").onclick = () => {
  chartTheme = chartTheme === "dark" ? "light" : "dark";
  document.getElementById("theme").textContent = chartTheme === "light" ? "Dark chart" : "White chart";
  showChart(currentSym);
};
document.getElementById("full").onclick = () => {
  const box = document.getElementById("tv");
  if (document.fullscreenElement) document.exitFullscreen();
  else box.requestFullscreen();
};
document.querySelectorAll(".sym").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".sym").forEach((b) => b.classList.remove("on"));
    btn.classList.add("on");
    showChart(btn.dataset.sym);
  };
});

function reply(q) {
  const text = q.toLowerCase();
  const wantsBuy = /buy gold|long gold|gold buy|buy xau/.test(text);
  const wantsSell = /sell gold|short gold|gold sell/.test(text);
  const nfp = /nfp|payroll|jobs/.test(text);
  const cpi = /cpi|inflation|core/.test(text);
  const soft = /miss|soft|weak|0\.1|0\.2|lower|below/.test(text);
  const hot = /beat|hot|0\.3|0\.4|strong|higher|above|firm/.test(text);
  const claims = /claims|jobless/.test(text);
  const core = /core/.test(text);

  if (cpi && wantsBuy && hot && !soft) {
    return "Correction: do not buy gold into a hot core. Core 0.3%+ is dollar up, gold down. Headline from oil is noise. Sell the gold spike if core is hot.";
  }
  if (cpi && wantsSell && soft) {
    return "Correction: soft core is not a sell. Core 0.1% or under eases hike pressure. Lean buy gold after the print holds. Headline alone does not make the sell.";
  }
  if (cpi && core && soft) {
    return "Soft core is the gold-friendly print. Jobs already missed and wages printed 0.1%. Soft core confirms. Buy gold after it holds, not on the first tick.";
  }
  if (cpi && core && hot) {
    return "Hot core flips the lean. Core 0.3%+ means the Fed stays tight. Dollar up, sell gold. Ignore a soft headline if core is hot.";
  }
  if (cpi && /headline/.test(text) && hot) {
    return "Headline can look hot from gasoline and still leave gold supported if core stays 0.2% or under. Trade core first.";
  }
  if (nfp) {
    return "NFP already printed: jobs +29k vs 90k, wages +0.1% vs 0.3%. That was the soft miss. Focus is now Core CPI on 14 Oct. Soft core keeps the gold lean. Hot core (0.3%+) sells gold.";
  }
  if (claims && /higher claims.*strong|claims up.*usd up/.test(text)) {
    return "Correction: higher claims are not dollar-positive. More claims mean more layoffs, so that print is red for the dollar and green for gold.";
  }
  if (wantsBuy) {
    return "Lean buy gold into Core CPI only while core is expected near 0.2% or softer. Flip to sell if core prints 0.3%+. Do not trade headline oil noise alone.";
  }
  if (wantsSell) {
    return "Sell gold is the call only if Core CPI hits 0.3% or higher. Soft NFP already cut the old red stack. Wait for core.";
  }
  return "Argue the call. Say buy or sell, and name core or headline. Core decides. Soft NFP (29k, wages 0.1%) is already in. Hot core = sell gold. Soft core = buy gold.";
}

const log = document.getElementById("log");
document.getElementById("ask").onsubmit = (e) => {
  e.preventDefault();
  const q = document.getElementById("q").value.trim();
  if (!q) return;
  log.innerHTML += `<div class="msg me">${q}</div><div class="msg">${reply(q)}</div>`;
  document.getElementById("q").value = "";
  log.scrollTop = log.scrollHeight;
};

/* === FOMC status + decision scorecard === */
async function loadFomcStatus() {
  try {
    const r = await fetch("/api/fomc");
    if (!r.ok) return;
    const d = await r.json();
    const st = document.getElementById("fomc-status");
    const title = document.getElementById("fomc-title");
    const when = document.getElementById("fomc-when");
    if (title && d.title) title.textContent = d.title;
    if (when && d.whenText) when.innerHTML = d.whenText;
    if (st) {
      const hrs = d.hoursToStatement;
      if (hrs == null) st.textContent = d.status || "—";
      else if (hrs > 48) st.textContent = "Status: " + Math.ceil(hrs / 24) + " days to statement · FLAT rules apply in last 2h";
      else if (hrs > 2) st.textContent = "Status: " + hrs.toFixed(1) + "h to statement · scenario board only";
      else if (hrs > -1) st.textContent = "Status: PRE-EVENT LOCKOUT · do not lean · trade statement surprise only";
      else st.textContent = "Status: statement window passed · use presser + price action";
    }
  } catch (e) {}
}

const SC_KEY = "desk_scorecard_v1";
function loadScorecard() {
  try { return JSON.parse(localStorage.getItem(SC_KEY) || "[]"); } catch { return []; }
}
function saveScorecard(rows) {
  localStorage.setItem(SC_KEY, JSON.stringify(rows.slice(0, 40)));
}
function renderScorecard() {
  const rows = loadScorecard();
  const list = document.getElementById("scorecard-list");
  const stats = document.getElementById("scorecard-stats");
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = "<p class='section-desc'>No decisions logged yet. After each Tier-1, log actual + call + result.</p>";
    if (stats) stats.textContent = "Hit rate —";
    return;
  }
  list.innerHTML = rows.map((r, i) =>
    `<div class="sc-row">
      <span>${r.event}</span>
      <span>${r.actual}</span>
      <span>${r.call.replace("_", " ")}</span>
      <span class="sc-${r.result}">${r.result}</span>
      <button type="button" data-sc-del="${i}" style="background:none;border:none;color:#9a8a78;cursor:pointer">×</button>
    </div>`
  ).join("");
  const hits = rows.filter(r => r.result === "hit").length;
  const misses = rows.filter(r => r.result === "miss").length;
  const n = hits + misses;
  if (stats) stats.textContent = n ? `Hit rate ${hits}/${n} (${Math.round(100 * hits / n)}%) · ${rows.length} logs` : "Only scratches logged";
  list.querySelectorAll("[data-sc-del]").forEach(btn => {
    btn.onclick = () => {
      const rows2 = loadScorecard();
      rows2.splice(Number(btn.getAttribute("data-sc-del")), 1);
      saveScorecard(rows2);
      renderScorecard();
    };
  });
}
document.getElementById("sc-add")?.addEventListener("click", () => {
  const event = document.getElementById("sc-event")?.value || "Core CPI";
  const actual = document.getElementById("sc-actual")?.value || "—";
  const call = document.getElementById("sc-call")?.value || "flat";
  const result = document.getElementById("sc-result")?.value || "scratch";
  const rows = loadScorecard();
  rows.unshift({ event, actual, call, result, at: new Date().toISOString() });
  saveScorecard(rows);
  renderScorecard();
  const inp = document.getElementById("sc-actual");
  if (inp) inp.value = "";
});

// Seed Oct 14 Core CPI hot as first log if empty
(function seedScorecard() {
  const rows = loadScorecard();
  if (!rows.length) {
    saveScorecard([{
      event: "Core CPI",
      actual: "0.3 vs 0.2",
      call: "sell_gold",
      result: "hit",
      at: "2026-10-14T12:30:00Z",
      note: "Hot core — gold sold"
    }]);
  }
})();
renderScorecard();
loadFomcStatus();
setInterval(loadFomcStatus, 60000);

// Keep desk data fresh — stale cache was the main "stuck" issue
let deskPoll = setInterval(() => {
  load(false).catch(() => {});
}, 90000);
setInterval(() => {
  fetch("/api/desk?refresh=1").then(r => r.json()).then(render).catch(() => {});
  loadFomcStatus();
}, 20 * 60 * 1000);

// Highlight active session on Overview (CAT = UTC+2)
function highlightSession() {
  const matrix = document.getElementById("session-matrix");
  if (!matrix) return;
  const now = new Date();
  // CAT = Africa/Johannesburg (UTC+2, no DST)
  const catHour = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Johannesburg" })).getHours();
  let active = "asia";
  if (catHour >= 8 && catHour < 14) active = "london";
  else if (catHour >= 14 && catHour < 22) active = "ny";
  matrix.querySelectorAll(".sm-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.session === active);
  });
}
highlightSession();
setInterval(highlightSession, 60000);
