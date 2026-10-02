/* Expanded desk tabs: cross, rates, sessions clocks, surprise, heat, corr, journal, risk, alerts, news, settings */
(function () {
  const zone = () => localStorage.getItem("deskZone") || "Africa/Lusaka";
  const hist = { dxy: [], xau: [], y10: [], eurusd: [] };

  function fmt(n, d) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return Number(n).toFixed(d ?? 2);
  }

  function tile(a) {
    if (a.error) return `<div class="asset-tile"><div class="name">${a.name}</div><div class="px">—</div><div class="chg flat">${a.error}</div></div>`;
    const up = a.change > 0, down = a.change < 0;
    const cls = up ? "up" : down ? "down" : "";
    const sign = up ? "+" : "";
    return `<div class="asset-tile ${cls}"><div class="name">${a.name}</div><div class="px">${fmt(a.last, a.name === "EURUSD" || a.name === "GBPUSD" ? 5 : 2)}</div><div class="chg ${up ? "pos" : down ? "neg" : "flat"}">${sign}${fmt(a.change, 3)} (${sign}${fmt(a.changePct, 2)}%)</div></div>`;
  }

  /* —— Cross assets —— */
  async function loadCross() {
    const box = document.getElementById("cross-grid");
    const flag = document.getElementById("risk-flag");
    if (!box) return;
    try {
      const data = await (await fetch("/api/cross")).json();
      box.innerHTML = (data.assets || []).map(tile).join("") || "No data";
      if (flag) flag.textContent = "Risk regime: " + (data.regime || "—");
      const dxy = data.assets?.find((a) => a.name === "DXY");
      const xau = data.assets?.find((a) => a.name === "XAU");
      const y10 = data.assets?.find((a) => a.name === "US10Y");
      if (dxy?.last != null) hist.dxy.push(dxy.last);
      if (xau?.last != null) hist.xau.push(xau.last);
      if (y10?.last != null) hist.y10.push(y10.last);
      Object.keys(hist).forEach((k) => { hist[k] = hist[k].slice(-40); });
      paintCorr();
      paintHeat(data.assets || []);
      checkAlerts({
        DXY: dxy?.last,
        XAU: xau?.last,
        US10Y: y10?.last,
        Real: y10?.last != null ? y10.last - 2.5 : null
      });
      if (dxy?.last != null && document.getElementById("dxy-ticker")) {
        document.getElementById("dxy-ticker").textContent = "DXY: " + fmt(dxy.last, 2);
      }
      if (y10?.last != null) {
        const el = document.getElementById("us10y-yield");
        if (el) el.textContent = "US10Y: " + fmt(y10.last, 2) + "%";
        const real = document.getElementById("real-yield");
        if (real) real.textContent = "Real Yield: " + fmt(y10.last - 2.5, 2) + "%";
      }
    } catch (e) {
      box.textContent = "Cross feed unavailable";
    }
  }

  /* —— Rates & Fed —— */
  async function loadRates() {
    const grid = document.getElementById("rates-grid");
    if (!grid) return;
    try {
      const data = await (await fetch("/api/rates")).json();
      grid.innerHTML = (data.yields || []).map(tile).join("");
      const slope = data.curve?.slope2s10s;
      const cl = document.getElementById("curve-label");
      const cn = document.getElementById("curve-note");
      if (cl) cl.textContent = "2s10s " + (slope == null ? "—" : slope + "%");
      if (cn) cn.textContent = data.curve?.note || "—";
      const rl = document.getElementById("real-label");
      const rn = document.getElementById("real-note");
      if (rl) rl.textContent = data.realYield?.value != null ? data.realYield.value + "%" : "—";
      if (rn) rn.textContent = data.realYield?.note || "—";
      const fed = data.fed || {};
      const fd = document.getElementById("fomc-date");
      if (fd) fd.textContent = fed.nextFomc || "—";
      const ff = document.getElementById("ff-rate");
      if (ff) ff.textContent = fed.fundsUpper != null ? fed.fundsUpper + "%" : "—";
      const fn = document.getElementById("ff-note");
      if (fn) fn.textContent = fed.tone || "—";
      const pl = document.getElementById("path-label");
      if (pl) pl.textContent = "Sketch path";
      const bars = document.getElementById("path-bars");
      if (bars && fed.path) {
        const max = Math.max(...fed.path.map((p) => p.rate));
        const min = Math.min(...fed.path.map((p) => p.rate)) - 0.25;
        bars.innerHTML = fed.path.map((p) => {
          const h = ((p.rate - min) / (max - min || 1)) * 100;
          return `<span style="height:${Math.max(12, h)}%"><small>${p.label}<br>${p.rate}</small></span>`;
        }).join("");
      }
      updateFomcCountdown(fed.nextFomc);
    } catch (e) {
      grid.textContent = "Rates feed unavailable";
    }
  }

  function updateFomcCountdown(isoDate) {
    const el = document.getElementById("fomc-countdown");
    if (!el || !isoDate) return;
    const target = new Date(isoDate + "T18:00:00Z");
    const tick = () => {
      const ms = target - Date.now();
      if (ms < 0) { el.textContent = "Meeting window / check calendar"; return; }
      const d = Math.floor(ms / 86400000);
      const h = Math.floor((ms % 86400000) / 3600000);
      el.textContent = d + "d " + h + "h to decision window";
    };
    tick();
  }

  /* —— Session clocks —— */
  function paintClocks() {
    const box = document.getElementById("session-clocks");
    if (!box) return;
    const z = zone();
    const now = new Date();
    const fmtT = (tz) => now.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    // CAT ≈ Africa/Lusaka; sessions in CAT hours
    const catHour = Number(now.toLocaleString("en-GB", { timeZone: "Africa/Lusaka", hour: "numeric", hour12: false }));
    const sessions = [
      { id: "asia", name: "Asia", tz: "Asia/Tokyo", start: 0, end: 8 },
      { id: "london", name: "London", tz: "Europe/London", start: 9, end: 15 },
      { id: "ny", name: "New York", tz: "America/New_York", start: 14, end: 22 }
    ];
    box.innerHTML = sessions.map((s) => {
      const active = catHour >= s.start && catHour < s.end;
      let liq = "Normal", liqCls = "";
      if (active && ((s.id === "london" && catHour >= 14 && catHour < 16) || (s.id === "ny" && catHour >= 14 && catHour < 17))) {
        liq = "Active · overlap"; liqCls = "hot";
      } else if (!active) {
        liq = "Closed / thin"; liqCls = "thin";
      } else if (s.id === "asia") {
        liq = "Asia open";
      }
      return `<div class="session-clock ${active ? "active" : ""}" data-session="${s.id}">
        <div class="name">${s.name}</div>
        <div class="t">${fmtT(s.tz)}</div>
        <div class="liq ${liqCls}">${liq}</div>
        <div class="liq">Desk TZ: ${fmtT(z)}</div>
      </div>`;
    }).join("");
  }

  /* —— Surprise index (from desk data if present) —— */
  window.deskPaintSurprise = function (data) {
    const scoreEl = document.getElementById("surprise-score");
    if (!scoreEl || !data) return;
    const steps = [];
    (data.majors || []).forEach((m) => {
      (m.signal?.steps || []).forEach((s) => {
        if (s.status && s.status !== "waiting") steps.push(s);
      });
    });
    if (!steps.length && data.bias?.steps) steps.push(...data.bias.steps.filter((s) => s.status !== "waiting"));
    const score = steps.reduce((n, s) => n + (s.points || 0), 0);
    scoreEl.textContent = score;
    scoreEl.className = score > 0 ? "pos" : score < 0 ? "neg" : "flat";
    const nEl = document.getElementById("surprise-n");
    if (nEl) nEl.textContent = String(steps.length);
    const read = document.getElementById("surprise-read");
    if (read) {
      read.textContent = score >= 2 ? "Hot lean (USD)" : score <= -2 ? "Soft lean (gold)" : "Mixed / flat";
      read.className = score >= 2 ? "pos" : score <= -2 ? "neg" : "flat";
    }
    const list = document.getElementById("surprise-list");
    if (list) {
      list.innerHTML = steps.map((s) => {
        const tone = s.status === "usd-up" ? "pos" : s.status === "usd-down" ? "neg" : "flat";
        return `<div class="row"><strong>${s.title}</strong><span class="${tone}">${s.text}</span></div>`;
      }).join("") || "<div class='event'>No printed leads yet</div>";
    }
  };

  /* —— Heat map —— */
  function paintHeat(assets) {
    const box = document.getElementById("heat-map");
    if (!box) return;
    const pairs = [
      { name: "DXY", a: assets.find((x) => x.name === "DXY") },
      { name: "EURUSD", a: assets.find((x) => x.name === "EURUSD") },
      { name: "USDJPY", a: assets.find((x) => x.name === "USDJPY") },
      { name: "GBPUSD", a: assets.find((x) => x.name === "GBPUSD") },
      { name: "XAU", a: assets.find((x) => x.name === "XAU") },
      { name: "Oil", a: assets.find((x) => x.name === "Oil") },
      { name: "US10Y", a: assets.find((x) => x.name === "US10Y") },
      { name: "SPX", a: assets.find((x) => x.name === "SPX") }
    ];
    box.innerHTML = pairs.map((p) => {
      const pct = p.a && !p.a.error ? p.a.changePct : 0;
      const mag = Math.min(1, Math.abs(pct) / 1.5);
      const up = pct >= 0;
      const bg = up
        ? `rgba(26, 122, 76, ${0.25 + mag * 0.75})`
        : `rgba(192, 57, 43, ${0.25 + mag * 0.75})`;
      const sign = pct > 0 ? "+" : "";
      return `<div class="heat-cell" style="background:${bg}">${p.name}<small>${p.a && !p.a.error ? sign + fmt(pct, 2) + "%" : "—"}</small></div>`;
    }).join("");
  }

  /* —— Correlations —— */
  function corr(a, b) {
    if (!a || !b || a.length < 5 || b.length < 5) return null;
    const n = Math.min(a.length, b.length);
    const xa = a.slice(-n), xb = b.slice(-n);
    const ma = xa.reduce((s, v) => s + v, 0) / n;
    const mb = xb.reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      const xa_ = xa[i] - ma, xb_ = xb[i] - mb;
      num += xa_ * xb_;
      da += xa_ * xa_;
      db += xb_ * xb_;
    }
    const den = Math.sqrt(da * db);
    return den ? num / den : null;
  }

  function paintCorr() {
    const box = document.getElementById("corr-grid");
    if (!box) return;
    const pairs = [
      { label: "Gold vs DXY", v: corr(hist.xau, hist.dxy), expect: "Usually negative" },
      { label: "Gold vs US10Y", v: corr(hist.xau, hist.y10), expect: "Usually negative" },
      { label: "DXY vs US10Y", v: corr(hist.dxy, hist.y10), expect: "Often positive" }
    ];
    box.innerHTML = pairs.map((p) => {
      const val = p.v == null ? "…" : p.v.toFixed(2);
      const cls = p.v == null ? "flat" : p.v > 0.2 ? "pos" : p.v < -0.2 ? "neg" : "flat";
      return `<div class="corr-card"><div class="pair">${p.label}</div><div class="val ${cls}">${val}</div><p class="primer">${p.expect}. Need ~5+ ticks.</p></div>`;
    }).join("");
    const note = document.getElementById("corr-note");
    if (note) note.textContent = "Samples — DXY:" + hist.dxy.length + " Gold:" + hist.xau.length + " 10Y:" + hist.y10.length;
  }

  /* —— Journal —— */
  function journalRows() {
    return JSON.parse(localStorage.getItem("deskJournal") || localStorage.getItem("deskHits") || "[]");
  }

  function saveJournal(rows) {
    localStorage.setItem("deskJournal", JSON.stringify(rows));
  }

  function paintJournal() {
    const list = document.getElementById("journal-list");
    if (!list) return;
    const rows = journalRows();
    document.getElementById("j-count").textContent = String(rows.length);
    const wins = rows.filter((r) => /win|✓|ok|held|worked/i.test(r.result || "")).length;
    const rated = rows.filter((r) => /win|loss|✓|✗|fail|worked|miss/i.test(r.result || ""));
    document.getElementById("j-wins").textContent = rated.length ? String(wins) : "—";
    document.getElementById("j-rate").textContent = rated.length ? Math.round((wins / rated.length) * 100) + "%" : "—";
    list.innerHTML = rows.map((r, i) => `
      <div class="j-row">
        <strong>${r.event || r.call || "—"}</strong>
        <span>${r.call || r.side || ""}</span>
        <span>${r.result || ""}</span>
        <button type="button" data-del="${i}">Delete</button>
      </div>
      ${r.notes ? `<div class="section-desc" style="margin:-4px 0 8px 12px">${r.notes}</div>` : ""}
    `).join("") || "<div class='event'>No entries yet</div>";
    list.querySelectorAll("[data-del]").forEach((btn) => {
      btn.onclick = () => {
        const rows2 = journalRows();
        rows2.splice(Number(btn.dataset.del), 1);
        saveJournal(rows2);
        paintJournal();
      };
    });
  }

  document.getElementById("journal-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const rows = journalRows();
    rows.unshift({
      event: document.getElementById("j-event").value.trim(),
      call: document.getElementById("j-side").value,
      result: document.getElementById("j-result").value.trim(),
      notes: document.getElementById("j-notes").value.trim(),
      at: new Date().toISOString()
    });
    saveJournal(rows);
    e.target.reset();
    paintJournal();
  });

  /* —— Risk calculator —— */
  function calcRisk() {
    const bal = Number(document.getElementById("r-bal")?.value) || 0;
    const pct = Number(document.getElementById("r-pct")?.value) || 1;
    const stop = Number(document.getElementById("r-stop")?.value) || 30;
    const pip = Number(document.getElementById("r-pip")?.value) || 10;
    const rr = Number(document.getElementById("r-rr")?.value) || 2;
    const risk = bal * pct / 100;
    const lots = stop && pip ? risk / (stop * pip) : 0;
    const tp = stop * rr;
    const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    set("r-risk", "$" + risk.toFixed(2));
    set("r-lots", lots ? lots.toFixed(2) + " lots" : "—");
    set("r-tp", tp + " pips");
    const sum = document.getElementById("r-summary");
    if (sum) sum.textContent = `Risking $${risk.toFixed(0)} (${pct}% of $${bal}). Stop ${stop} pips → ~${lots.toFixed(2)} lots at $${pip}/pip. TP at ${tp} pips for ${rr}R.`;
  }
  ["r-bal", "r-pct", "r-stop", "r-pip", "r-rr"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", calcRisk);
  });

  /* —— Alerts —— */
  function alertRows() {
    return JSON.parse(localStorage.getItem("deskAlerts") || "[]");
  }

  function paintAlerts() {
    const list = document.getElementById("alert-list");
    if (!list) return;
    const rows = alertRows();
    list.innerHTML = rows.map((a, i) => `
      <div class="j-row">
        <strong>${a.metric}</strong>
        <span>${a.op === "gt" ? "above" : "below"} ${a.level}</span>
        <span class="${a.fired ? "pos" : "flat"}">${a.fired ? "Triggered " + (a.firedAt || "") : "Armed"}</span>
        <button type="button" data-adel="${i}">Delete</button>
      </div>
    `).join("") || "<div class='event'>No alerts</div>";
    list.querySelectorAll("[data-adel]").forEach((btn) => {
      btn.onclick = () => {
        const rows2 = alertRows();
        rows2.splice(Number(btn.dataset.adel), 1);
        localStorage.setItem("deskAlerts", JSON.stringify(rows2));
        paintAlerts();
      };
    });
  }

  document.getElementById("alert-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const rows = alertRows();
    rows.push({
      metric: document.getElementById("a-metric").value,
      op: document.getElementById("a-op").value,
      level: Number(document.getElementById("a-level").value),
      fired: false
    });
    localStorage.setItem("deskAlerts", JSON.stringify(rows));
    e.target.reset();
    paintAlerts();
  });

  document.getElementById("a-permission")?.addEventListener("click", () => {
    if (window.Notification) Notification.requestPermission();
  });

  function checkAlerts(vals) {
    const rows = alertRows();
    let changed = false;
    const banner = document.getElementById("alert-banner");
    rows.forEach((a) => {
      const v = vals[a.metric];
      if (v == null || a.fired) return;
      const hit = a.op === "gt" ? v > a.level : v < a.level;
      if (hit) {
        a.fired = true;
        a.firedAt = new Date().toLocaleTimeString();
        changed = true;
        if (banner) {
          banner.hidden = false;
          banner.textContent = `Alert: ${a.metric} ${a.op === "gt" ? ">" : "<"} ${a.level} (now ${fmt(v, 3)})`;
        }
        if (window.Notification && Notification.permission === "granted") {
          new Notification("Forex Desk", { body: `${a.metric} ${a.op === "gt" ? "above" : "below"} ${a.level}` });
        }
      }
    });
    if (changed) {
      localStorage.setItem("deskAlerts", JSON.stringify(rows));
      paintAlerts();
    }
  }

  /* —— News —— */
  async function loadNews() {
    const main = document.getElementById("news-main");
    const sess = document.getElementById("news-sessions");
    try {
      const data = await (await fetch("/api/news")).json();
      const html = (data.items || []).map((n) => {
        const session = (n.session || "Desk").replace(/\s/g, "");
        return `<article class="story ${session}"><div class="pic">${n.session}</div><p>${n.title}</p>${n.link ? `<a href="${n.link}" target="_blank" rel="noopener">Read</a>` : ""}</article>`;
      }).join("") || "<div class='event'>No headlines</div>";
      if (main) main.innerHTML = html;
      if (sess) sess.innerHTML = html;
    } catch (e) {
      if (main) main.textContent = "News feed not ready";
    }
  }

  /* —— Next event countdown (header) —— */
  window.deskNextEvent = function (data) {
    const el = document.getElementById("next-event");
    if (!el || !data) return;
    let next = null;
    (data.majors || []).forEach((m) => {
      if (m.next?.date) {
        const t = new Date(m.next.date);
        if (t > new Date() && (!next || t < new Date(next.date))) next = m.next;
      }
    });
    if (!next) {
      el.textContent = "Next: —";
      return;
    }
    const tick = () => {
      const ms = new Date(next.date) - Date.now();
      if (ms < 0) { el.textContent = "Next: " + (next.title || "event") + " (due)"; return; }
      const d = Math.floor(ms / 86400000);
      const h = Math.floor((ms % 86400000) / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      el.textContent = "Next: " + (next.title || "print").slice(0, 28) + " · " + (d ? d + "d " : "") + h + "h " + m + "m";
    };
    tick();
    clearInterval(window.__nextEvTimer);
    window.__nextEvTimer = setInterval(tick, 30000);
  };

  /* —— Settings —— */
  function loadSettingsUI() {
    const z = document.getElementById("s-zone");
    if (z) z.value = zone();
    const w = JSON.parse(localStorage.getItem("deskWeights") || '{"nfp":1.2,"cpi":1.4}');
    const wn = document.getElementById("s-w-nfp");
    const wc = document.getElementById("s-w-cpi");
    if (wn) wn.value = w.nfp;
    if (wc) wc.value = w.cpi;
    const th = document.getElementById("s-theme");
    if (th) th.value = document.documentElement.getAttribute("data-theme") || "dark";
    const ch = document.getElementById("s-chart");
    if (ch) ch.value = localStorage.getItem("deskChart") || "OANDA:XAUUSD";
  }

  document.getElementById("s-save")?.addEventListener("click", () => {
    localStorage.setItem("deskZone", document.getElementById("s-zone").value);
    localStorage.setItem("deskWeights", JSON.stringify({
      nfp: Number(document.getElementById("s-w-nfp").value),
      cpi: Number(document.getElementById("s-w-cpi").value),
      claims: 1
    }));
    localStorage.setItem("deskChart", document.getElementById("s-chart").value);
    const theme = document.getElementById("s-theme").value;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("deskTheme", theme);
    const tb = document.getElementById("theme-toggle");
    if (tb) tb.textContent = theme === "light" ? "Light" : "Dark";
    const st = document.getElementById("s-status");
    if (st) st.textContent = "Saved. Timezone applies to clocks on next tick.";
    if (typeof currentSym !== "undefined") {
      try { currentSym = document.getElementById("s-chart").value; } catch (e) {}
    }
  });

  document.getElementById("s-clear-journal")?.addEventListener("click", () => {
    if (confirm("Clear all journal entries?")) {
      saveJournal([]);
      paintJournal();
    }
  });

  document.getElementById("s-clear-alerts")?.addEventListener("click", () => {
    localStorage.setItem("deskAlerts", "[]");
    paintAlerts();
    const b = document.getElementById("alert-banner");
    if (b) b.hidden = true;
  });

  /* —— Hook desk render —— */
  const _render = window.render;
  // app.js defines render in outer scope; we patch after load via Mutation on majors

  /* —— Init —— */
  paintClocks();
  paintJournal();
  paintAlerts();
  calcRisk();
  loadSettingsUI();
  loadCross();
  loadRates();
  loadNews();
  paintCorr();

  setInterval(paintClocks, 1000);
  setInterval(loadCross, 20000);
  setInterval(loadRates, 60000);
  setInterval(loadNews, 300000);

  // When app.js finishes load(), data is on page — poll score from #score text for surprise if needed
  setInterval(() => {
    if (window.__lastDeskData) {
      window.deskPaintSurprise(window.__lastDeskData);
      window.deskNextEvent(window.__lastDeskData);
    }
  }, 2000);
})();
