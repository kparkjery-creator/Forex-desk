(function () {
  const $ = (id) => document.getElementById(id);

  function loadTrades() {
    try { return JSON.parse(localStorage.getItem("deskTrades") || "[]"); } catch { return []; }
  }
  function saveTrades(rows) {
    localStorage.setItem("deskTrades", JSON.stringify(rows.slice(0, 200)));
  }
  function renderTrades() {
    const rows = loadTrades();
    const wins = rows.filter((r) => r.result === "Win").length;
    const losses = rows.filter((r) => r.result === "Loss").length;
    const done = wins + losses;
    const hit = done ? Math.round((wins / done) * 100) : 0;
    const avgR = rows.filter((r) => r.rr != null && !Number.isNaN(r.rr));
    const meanR = avgR.length ? (avgR.reduce((a, b) => a + b.rr, 0) / avgR.length).toFixed(2) : "—";
    const by = {};
    rows.forEach((r) => {
      by[r.event] = by[r.event] || { w: 0, l: 0 };
      if (r.result === "Win") by[r.event].w++;
      if (r.result === "Loss") by[r.event].l++;
    });
    const per = Object.entries(by).map(([k, v]) => {
      const n = v.w + v.l;
      return k + " " + (n ? Math.round((v.w / n) * 100) : 0) + "%";
    }).join(" · ") || "No events yet";
    if ($("trade-stats")) $("trade-stats").textContent = "Hit rate " + hit + "% (" + wins + "W/" + losses + "L) · avg R " + meanR + " · " + per;
    if ($("trade-rows")) {
      $("trade-rows").innerHTML = rows.slice(0, 12).map((r) =>
        `<div class="event"><strong>${r.event}</strong><span>${r.side}</span><span class="${r.result === "Win" ? "pos" : r.result === "Loss" ? "neg" : "flat"}">${r.result}${r.rr != null ? " · " + r.rr + "R" : ""}</span></div>`
      ).join("") || "<div class='event'>No trades logged</div>";
    }
  }

  function atrSize(atr) {
    const bal = Number($("inst-bal")?.value) || 1000;
    const pct = Number($("inst-risk")?.value) || 1;
    const risk = bal * pct / 100;
    if (!atr || atr <= 0) {
      if ($("atr-size")) $("atr-size").textContent = "ATR not ready.";
      return;
    }
    const stop = Math.max(8, Math.round(atr * 0.5)); // half ATR stop in $ for gold ~ pips-ish
    const lots = (risk / (stop * 1)).toFixed(2); // $1 per $ move approx per 0.01 lot scaled simply
    if ($("atr-size")) {
      $("atr-size").textContent = "ATR " + atr.toFixed(1) + " · stop ~" + stop + " · risk $" + risk.toFixed(0) + " · size guide " + lots + " (scale to your broker contract). High ATR → smaller size.";
    }
  }

  async function loadInst() {
    try {
      const d = await (await fetch("/api/institutional")).json();
      if ($("fed-meeting")) $("fed-meeting").textContent = "FOMC " + (d.meeting || "—");
      const setBar = (id, probId, v) => {
        const n = Number(v) || 0;
        if ($(id)) $(id).style.width = n + "%";
        if ($(probId)) $(probId).textContent = n + "%";
      };
      setBar("bar-cut", "prob-cut", d.cutProb);
      setBar("bar-hold", "prob-hold", d.holdProb);
      setBar("bar-hike", "prob-hike", d.hikeProb);
      if ($("fed-implied")) {
        $("fed-implied").textContent = d.impliedRate != null
          ? ("Implied funds " + d.impliedRate + "% · ZQ " + (d.fedFunds ?? "—") + " · regime " + (d.regime || "—"))
          : ("Fed path unavailable · regime " + (d.regime || "—"));
      }
      if ($("curve-box")) {
        const c = d.curve || {};
        $("curve-box").innerHTML = [
          c.us3m != null ? "3M " + c.us3m.toFixed(2) + "%" : null,
          c.us5y != null ? "5Y " + c.us5y.toFixed(2) + "%" : null,
          c.us10y != null ? "10Y " + c.us10y.toFixed(2) + "%" : null,
          c.spread10_5 != null ? "10Y–5Y " + c.spread10_5 + "pp" : null,
          c.spread10_3m != null ? "10Y–3M " + c.spread10_3m + "pp" : null,
          c.realYield != null ? "Real ~ " + c.realYield + "%" : null
        ].filter(Boolean).join("<br>") || "Curve feed not ready";
      }
      if ($("tech-box")) {
        const g = d.tech?.gold || {};
        const x = d.tech?.dxy || {};
        const gLine = g.last != null ? ("Gold " + Number(g.last).toFixed(1) + " · 20SMA " + (g.sma20 ?? "—") + " · <b class='" + (g.vsSma === "above" ? "pos" : "neg") + "'>" + (g.vsSma || "—") + "</b>") : "Gold tech —";
        const dLine = x.last != null ? ("DXY " + Number(x.last).toFixed(2) + " · 20SMA " + (x.sma20 ?? "—") + " · <b class='" + (x.vsSma === "above" ? "pos" : "neg") + "'>" + (x.vsSma || "—") + "</b>") : "DXY tech —";
        $("tech-box").innerHTML = gLine + "<br>" + dLine + "<br><small>Macro signal is weaker if it fights the 20SMA wall.</small>";
      }
      if ($("atr-box")) {
        $("atr-box").textContent = d.atr?.gold != null ? ("14-day ATR " + d.atr.gold + " (about " + d.atr.goldPips + " points)") : "ATR not ready";
        atrSize(d.atr?.gold);
      }
      if ($("speakers")) {
        $("speakers").innerHTML = (d.speakers || []).map((s) =>
          `<div class="event"><strong>${s.title}</strong><span>${s.date ? new Date(s.date).toLocaleString() : ""}</span><span class="tone-${s.tone}">${s.tone}</span></div>`
        ).join("") || "<div class='event'>No Fed speak in the calendar window</div>";
      }
      // header countdown from desk bias focus if available
      window.__inst = d;
    } catch (err) {
      if ($("curve-box")) $("curve-box").textContent = "Institutional feed failed — redeploy server.js";
    }
  }

  $("inst-bal")?.addEventListener("change", () => atrSize(window.__inst?.atr?.gold));
  $("inst-risk")?.addEventListener("change", () => atrSize(window.__inst?.atr?.gold));

  $("trade-log-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const row = {
      event: $("tl-event").value,
      side: $("tl-side").value,
      result: $("tl-result").value,
      rr: Number($("tl-rr").value),
      at: new Date().toISOString()
    };
    if (Number.isNaN(row.rr)) row.rr = null;
    const rows = loadTrades();
    rows.unshift(row);
    saveTrades(rows);
    renderTrades();
    $("tl-rr").value = "";
  });

  // Alerts
  let lastScore = null;
  let lastActualKey = null;
  async function watchAlerts() {
    try {
      const data = await (await fetch("/api/desk")).json();
      const score = data.bias?.score;
      const on = $("alert-on")?.checked || localStorage.getItem("deskAlertOn") === "1";
      if ($("alert-on") && localStorage.getItem("deskAlertOn") === "1") $("alert-on").checked = true;
      if (on && lastScore != null && score != null && Math.sign(score) !== Math.sign(lastScore) && Math.abs(score) >= 2) {
        if (Notification.permission === "granted") {
          new Notification("Desk score flipped", { body: "Score " + lastScore + " → " + score + " · " + (data.bias.gold || "") });
        }
      }
      lastScore = score;
      const actuals = (data.bias?.steps || []).filter((s) => s.status !== "waiting").map((s) => s.title + s.text).join("|");
      if (lastActualKey && actuals && actuals !== lastActualKey) {
        const url = $("webhook-url")?.value || localStorage.getItem("deskWebhook") || "";
        if (url) {
          try {
            fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "Desk print update: " + (data.bias?.call || "") + " | " + (data.bias?.gold || "") }) }).catch(() => {});
          } catch (err) {}
        }
      }
      lastActualKey = actuals;
      // countdown
      const when = data.bias?.focusWhen;
      const title = data.bias?.focusTitle || "Event";
      const el = $("event-cd");
      if (el && when) {
        const ms = new Date(when) - Date.now();
        if (ms > 0) {
          const d = Math.floor(ms / 86400000);
          const h = Math.floor((ms % 86400000) / 3600000);
          const m = Math.floor((ms % 3600000) / 60000);
          el.textContent = title + " · " + d + "d " + h + "h " + m + "m";
        } else el.textContent = title + " · live window";
      }
    } catch (err) {}
  }

  $("alert-on")?.addEventListener("change", (ev) => {
    localStorage.setItem("deskAlertOn", ev.target.checked ? "1" : "0");
    if (ev.target.checked && Notification.permission === "default") Notification.requestPermission();
  });
  $("webhook-url")?.addEventListener("change", (ev) => localStorage.setItem("deskWebhook", ev.target.value || ""));
  if ($("webhook-url")) $("webhook-url").value = localStorage.getItem("deskWebhook") || "";

  // tab wiring if app only binds once at start
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.tab === "inst") loadInst();
    });
  });

  renderTrades();
  loadInst();
  setInterval(loadInst, 90000);
  watchAlerts();
  setInterval(watchAlerts, 30000);
})();
