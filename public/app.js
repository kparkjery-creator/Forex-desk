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

  // Calculate and update confluence meter
  calculateConfluenceScore(data.bias);

  const focus = data.majors.find((m) => m.next) || data.majors[0];
  document.getElementById("steps").innerHTML = (focus?.signal.steps || []).map((s, i) =>
    `<div class="row"><strong>Step ${i + 1}. ${s.title}</strong><span>${s.text}</span></div>`
  ).join("") || "<div class='row'>No leading prints in the window yet.</div>";

  majorsEl.innerHTML = data.majors.map((m) => `
    <article class="card">
      <p>${m.key}</p>
      <h4>${m.next ? m.next.title : "No date in the next 6 months"}</h4>
      <div>${m.next ? when(m.next.date) + " · " + nums(m.next) : ""}</div>
      <div class="lead"><div><span class="tag">signal</span> ${m.signal.call} ${m.signal.gold}</div>
        <div><span class="tag">later</span> ${m.later.length ? m.later.map((e) => when(e.date)).join(" · ") : "—"}</div>
        ${(m.leads.length ? m.leads : [{ title: "Leads show once they enter the window" }]).map((e) => `<div><span class="tag">lead</span> ${e.date ? when(e.date) + " · " + e.title : e.title}</div>`).join("")}
      </div>
    </article>
  `).join("");

  monthsEl.innerHTML = Object.entries(data.months).map(([month, rows]) => `
    <article class="card">
      <p>${month}</p>
      ${rows.map((e) => `<div class="lead"><div><strong>${e.title}</strong><br>${when(e.date)} ·${nums(e)}</div></div>`).join("")}
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

document.getElementById("refresh").onclick = () => load(true);

const titles = { board: "Event bias board", charts: "Market charts", calendar: "Market calendar", chat: "Event chat" };
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
  const soft = /miss|soft|weak|lower|below|cool|dip/.test(text);
  const hot = /beat|hot|strong|higher|above|firm/.test(text);
  const wages = /wage|ahe|hourly/.test(text);
  const nfp = /nfp|payroll|jobs/.test(text);
  const cpi = /cpi|inflation|pce|ppi/.test(text);
  const fomc = /fomc|fed|rate/.test(text);
  if (nfp && (soft || /0\.2/.test(text))) {
    return "If NFP misses and wages are 0.2% or lower, the dollar dip is the clean case. Gold can be bought after the print holds, not before. A jobs miss with wages still 0.3% is mixed: first spike fades, do not chase gold.";
  }
  if (nfp && hot) return "If NFP beats and wages hold 0.3% or higher, USD up and gold down. Sell gold rallies. DXY can test 102. EURUSD usually falls with a firm dollar.";
  if (cpi && hot) return "Hot CPI or core CPI is USD up, gold down, oil only helped if the beat is energy-driven. FOMC stays hawkish. Do not buy gold into a hot core print.";
  if (cpi && soft) return "Soft core CPI is the gold-buy case. USD down, EURUSD up. Headline-only soft with hot core does not count.";
  if (fomc && hot) return "A hawkish FOMC, or a hike held open, lifts DXY and hurts gold. A cut or soft guidance does the opposite.";
  if (soft) return "A softer-than-forecast print usually means USD down and gold up. Claims are the exception: lower claims are tighter labor, which is USD up.";
  if (hot) return "A hotter-than-forecast print usually means USD up and gold down. Oil follows only if the surprise is energy or growth, not wages.";
  return "Name the event and say if it beats or misses the forecast. Example: CPI core 0.2 vs 0.3 forecast. Wages decide NFP. Core decides CPI.";
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