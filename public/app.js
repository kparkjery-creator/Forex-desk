const majorsEl = document.getElementById("majors");
const monthsEl = document.getElementById("months");

function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function nums(e) {
  return [
    e.actual !== "" && e.actual != null ? "act " + e.actual : "upcoming",
    e.forecast !== "" && e.forecast != null ? "fcst " + e.forecast : "",
    e.previous !== "" && e.previous != null ? "prev " + e.previous : ""
  ].filter(Boolean).join(" · ");
}

/**
 * Calculates Delta (Surprise Factor) and Confluence Score based on Fed weights
 */
function calculateConfluenceScore(bias) {
  let score = 0;
  if (typeof bias.score === 'number') {
    score = bias.score;
  } else if (typeof bias.score === 'string') {
    const parsed = parseInt(bias.score, 10);
    score = isNaN(parsed) ? 0 : parsed;
  }
  
  // Clamp score between -10 and +10
  score = Math.max(-10, Math.min(10, score));
  
  // Position pointer on meter (0% at -10, 50% at 0, 100% at +10)
  const pointerPercent = ((score + 10) / 20) * 100;
  const pointerEl = document.getElementById("confluence-pointer");
  if (pointerEl) {
    pointerEl.style.left = `${pointerPercent}%`;
  }

  // Update Signal Action text based on score threshold
  const actionEl = document.getElementById("signal-action");
  if (actionEl) {
    if (score >= 7) {
      actionEl.textContent = "Signal State: HIGH CONFLUENCE - STRONG BUY USD / STRONG SELL GOLD";
      actionEl.className = "signal-action strong-buy";
    } else if (score <= -7) {
      actionEl.textContent = "Signal State: HIGH CONFLUENCE - STRONG SELL USD / STRONG BUY GOLD";
      actionEl.className = "signal-action strong-sell";
    } else if (score >= 3) {
      actionEl.textContent = "Signal State: MODERATE USD BUY / NO TRADE GOLD";
      actionEl.className = "signal-action mod-buy";
    } else if (score <= -3) {
      actionEl.textContent = "Signal State: MODERATE USD SELL / NO TRADE GOLD";
      actionEl.className = "signal-action mod-sell";
    } else {
      actionEl.textContent = "Signal State: NO TRADE ZONE - Low Confluence / Conflicting Prints";
      actionEl.className = "signal-action neutral";
    }
  }
}

function render(data) {
  document.getElementById("updated").textContent =
    "Calendar pulled " + new Date(data.fetchedAt).toLocaleString() + " · next weekly refresh " + new Date(data.nextRefresh).toLocaleDateString();
  
  document.getElementById("usd").textContent = data.bias.call || "—";
  document.getElementById("gold").textContent = data.bias.gold || "—";
  document.getElementById("score").textContent = data.bias.score !== undefined ? data.bias.score : "—";
  document.getElementById("score").className = Number(data.bias.score) > 0 ? "pos" : Number(data.bias.score) < 0 ? "neg" : "flat";
  document.getElementById("gold").className = /sell/i.test(data.bias.gold || "") ? "neg" : /buy/i.test(data.bias.gold || "") ? "pos" : "";

  // Calculate and update confluence meter
  calculateConfluenceScore(data.bias);

  const focus = data.majors.find((m) => m.next) || data.majors[0];
  document.getElementById("steps").innerHTML = (focus?.signal.steps || []).map((s, i) => {
    const tone = s.status === "usd-up" ? "pos" : s.status === "usd-down" ? "neg" : "flat";
    const label = s.status === "usd-up" ? "POSITIVE" : s.status === "usd-down" ? "NEGATIVE" : "WAITING";
    return `<div class="row"><strong>Step ${i + 1}. ${s.title}</strong><span class="${tone}">${label} · ${s.text}</span></div>`;
  }).join("") || "<div class='row'>No leading prints in the window yet.</div>";

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
      <p>${month}</p>
      ${rows.map((e) => `<div class="event"><strong>${e.title}</strong><span>${when(e.date)}</span><span>${nums(e)}</span></div>`).join("")}
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
  if (!q || q.error || !q.price) {
    if (tape) document.getElementById("gold-src").textContent = (q && q.error) || "feed down";
    return;
  }
  const price = Number(q.price);
  const dir = lastGold == null ? 0 : price - lastGold;
  lastGold = price;
  goldHist.push(price);
  if (goldHist.length > 40) goldHist.shift();
  if (tape) {
    tape.classList.remove("up", "down");
    if (dir > 0) tape.classList.add("up");
    if (dir < 0) tape.classList.add("down");
    document.getElementById("gold-px").textContent = price.toFixed(2);
    const chg = q.change == null ? "" : (q.change >= 0 ? "+" : "") + Number(q.change).toFixed(2) + (q.changePct == null ? "" : " (" + (q.changePct >= 0 ? "+" : "") + Number(q.changePct).toFixed(2) + "%)");
    document.getElementById("gold-chg").textContent = chg || (q.bid && q.ask ? q.bid + " / " + q.ask : "");
    document.getElementById("gold-src").textContent = q.source || "live";
  }
  if (box) {
    const min = Math.min(...goldHist), max = Math.max(...goldHist);
    const pts = goldHist.map((v, i) => (i / Math.max(goldHist.length - 1, 1)) * 80 + "," + (20 - ((v - min) / (max - min || 1)) * 20)).join(" ");
    box.innerHTML = `<span><strong>Gold</strong> ${price.toFixed(2)}</span><span>${q.source || ""}</span><svg class="spark" viewBox="0 0 80 20"><polyline fill="none" stroke="#e2b656" stroke-width="1.5" points="${pts}"/></svg>`;
  }
}
function startGold() {
  if (window.EventSource) {
    const es = new EventSource("/api/gold/stream");
    es.onmessage = (ev) => { try { paintGold(JSON.parse(ev.data)); } catch (err) {} };
    es.onerror = () => { document.getElementById("gold-src") && (document.getElementById("gold-src").textContent = "reconnecting"); };
    return;
  }
  const poll = async () => { try { paintGold(await (await fetch("/api/gold")).json()); } catch (err) { paintGold({ error: "feed down" }); } };
  poll();
  setInterval(poll, 2000);
}
startGold();
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

const titles = { board: "Event bias board", charts: "Market charts", sessions: "Session dollar drivers", calendar: "Market calendar", chat: "Event chat" };
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
  const src = "https://s.tradingview.com/widgetembed/?symbol=" + encodeURIComponent(sym) +
    "&interval=1&hidesidetoolbar=0&hidetoptoolbar=0&symboledit=1&saveimage=1&withdateranges=1&details=1&hotlist=1&calendar=1&theme=" +
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