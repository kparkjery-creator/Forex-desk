(function () {
  const $ = (id) => document.getElementById(id);
  let lastInst = null;
  let lastAtr = null;

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
    const avgR = rows.filter((r) => r.rr != null && !Number.isNaN(Number(r.rr)));
    const meanR = avgR.length ? (avgR.reduce((a, b) => a + Number(b.rr), 0) / avgR.length).toFixed(2) : "—";
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
    if ($("trade-stats")) {
      $("trade-stats").textContent = "Hit rate " + hit + "% (" + wins + "W/" + losses + "L) · avg R " + meanR + " · " + per + " · " + rows.length + " logs (localStorage)";
    }
    if ($("trade-rows")) {
      $("trade-rows").innerHTML = rows.slice(0, 15).map((r, i) =>
        `<div class="event"><strong>${r.event}</strong><span>${r.side}</span><span class="${r.result === "Win" ? "pos" : r.result === "Loss" ? "neg" : "flat"}">${r.result}${r.rr != null ? " · " + r.rr + "R" : ""}</span><button type="button" class="tl-del" data-i="${i}" title="Delete">×</button></div>`
      ).join("") || "<div class='event'>No trades logged — entries save in this browser</div>";
      $("trade-rows").querySelectorAll(".tl-del").forEach((btn) => {
        btn.onclick = () => {
          const rows2 = loadTrades();
          rows2.splice(Number(btn.getAttribute("data-i")), 1);
          saveTrades(rows2);
          renderTrades();
        };
      });
    }
  }

  function atrSize(atr) {
    const bal = Number($("inst-bal")?.value) || 1000;
    const pct = Number($("inst-risk")?.value) || 1;
    let stop = Number($("inst-stop")?.value);
    const pipval = Number($("inst-pipval")?.value) || 1;
    const risk = bal * pct / 100;
    if (atr && atr > 0 && (!stop || stop <= 0)) {
      stop = Math.max(8, Math.round(atr * 0.5));
      if ($("inst-stop")) $("inst-stop").value = stop;
    }
    if (!stop || stop <= 0) {
      if ($("atr-size")) $("atr-size").textContent = "Set a stop distance (pts).";
      return;
    }
    const lots = risk / (stop * pipval);
    const atrLine = atr ? ("ATR " + Number(atr).toFixed(1) + " · ") : "";
    if ($("atr-size")) {
      $("atr-size").innerHTML =
        atrLine + "stop <b>" + stop + "</b> pts · risk <b>$" + risk.toFixed(2) +
        "</b> · size <b>" + lots.toFixed(2) + "</b> lots" +
        "<br><small>Uses your $/point/lot. High ATR → system suggests wider stop → smaller size.</small>";
    }
  }

  function setBar(barId, probId, v) {
    const n = v == null || Number.isNaN(Number(v)) ? 0 : Math.max(0, Math.min(100, Number(v)));
    const bar = $(barId);
    const lab = $(probId);
    if (bar) bar.style.width = n + "%";
    if (lab) lab.textContent = n ? n + "%" : "—";
  }

  function cardError(boxId, msg) {
    const el = $(boxId);
    if (!el) return;
    el.classList.remove("skeleton");
    el.innerHTML = `<span class="inst-err">${msg}</span>`;
  }

  function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  async function loadFedHeadlines() {
    const box = $("fed-headlines");
    if (!box) return;
    try {
      const r = await fetchWithTimeout("/api/news", 8000);
      if (!r.ok) throw new Error("news " + r.status);
      const d = await r.json();
      const items = (d.items || d.stories || d || []).filter((s) => {
        const t = ((s.title || s.headline || "") + " " + (s.source || "")).toLowerCase();
        return /fed|fomc|powell|waller|williams|hike|cut|rates|treasury|yield/.test(t);
      }).slice(0, 6);
      if (!items.length) {
        box.innerHTML = "<div class='event'>No Fed/yield headlines in the current news pull</div>";
        return;
      }
      box.innerHTML = items.map((s) =>
        `<div class="event"><strong>${s.title || s.headline}</strong><span>${s.source || ""}</span></div>`
      ).join("");
    } catch (e) {
      box.innerHTML = "<div class='event inst-err'>Headlines unavailable — Retry Fed Speak</div>";
    }
  }

  async function loadInst() {
    ["curve-box", "tech-box", "atr-box", "speakers"].forEach((id) => {
      const el = $(id);
      if (el && !el.dataset.ok) {
        el.classList.add("skeleton");
        if (id === "curve-box") el.textContent = "Loading curve…";
        if (id === "tech-box") el.textContent = "Loading tech…";
        if (id === "atr-box") el.textContent = "Loading ATR…";
        if (id === "speakers") el.textContent = "Loading speakers…";
      }
    });

    try {
      const r = await fetchWithTimeout("/api/institutional", 12000);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      lastInst = d;
      paintInst(d);
      loadFedHeadlines();
    } catch (err) {
      const msg = (err && err.name === "AbortError") ? "Timed out (Render cold start?). Tap Retry." : ("Feed failed: " + (err.message || err));
      cardError("curve-box", msg);
      cardError("tech-box", msg);
      cardError("atr-box", msg);
      cardError("speakers", msg);
      // Still allow risk calc with manual stop
      atrSize(lastAtr);
    }
  }

  function paintInst(d) {
    if ($("fed-meeting")) $("fed-meeting").textContent = "FOMC " + (d.meeting || "28 Oct");
    setBar("bar-cut", "prob-cut", d.cutProb);
    setBar("bar-hold", "prob-hold", d.holdProb);
    setBar("bar-hike", "prob-hike", d.hikeProb);
    if ($("fed-implied")) {
      $("fed-implied").textContent = d.impliedRate != null
        ? ("Implied funds ~" + d.impliedRate + "% · ZQ " + (d.fedFunds ?? "—") + " · regime " + (d.regime || "—"))
        : ("Fed path model · regime " + (d.regime || "—") + (d.fedFundsError ? " · ZQ error" : ""));
    }

    if ($("curve-box")) {
      const c = d.curve || {};
      const lines = [
        c.us3m != null ? "3M " + Number(c.us3m).toFixed(2) + "%" : null,
        c.us5y != null ? "5Y " + Number(c.us5y).toFixed(2) + "%" : null,
        c.us10y != null ? "10Y " + Number(c.us10y).toFixed(2) + "%" : null,
        c.spread10_5 != null ? "10Y–5Y " + c.spread10_5 + " pp" : null,
        c.spread10_3m != null ? "10Y–3M " + c.spread10_3m + " pp" : null,
        c.realYield != null ? "Real ~ " + c.realYield + "%" : null
      ].filter(Boolean);
      $("curve-box").classList.remove("skeleton");
      $("curve-box").dataset.ok = lines.length ? "1" : "";
      $("curve-box").innerHTML = lines.length ? lines.join("<br>") : "<span class='inst-err'>Curve empty — Retry</span>";
    }

    if ($("tech-box")) {
      const g = (d.tech && d.tech.gold) || {};
      const x = (d.tech && d.tech.dxy) || {};
      $("tech-box").classList.remove("skeleton");
      if (g.last == null && x.last == null) {
        $("tech-box").innerHTML = "<span class='inst-err'>Tech feed empty — Retry</span>";
      } else {
        $("tech-box").dataset.ok = "1";
        const gLine = g.last != null
          ? ("Gold " + Number(g.last).toFixed(1) + " · 20SMA " + (g.sma20 ?? "—") + " · <b class='" + (g.vsSma === "above" ? "pos" : "neg") + "'>" + (g.vsSma || "—") + "</b>")
          : "Gold tech —";
        const dLine = x.last != null
          ? ("DXY " + Number(x.last).toFixed(2) + " · 20SMA " + (x.sma20 ?? "—") + " · <b class='" + (x.vsSma === "above" ? "pos" : "neg") + "'>" + (x.vsSma || "—") + "</b>")
          : "DXY tech —";
        $("tech-box").innerHTML = gLine + "<br>" + dLine + "<br><small>Macro signal is weaker if it fights the 20SMA wall.</small>";
      }
    }

    if ($("atr-box")) {
      $("atr-box").classList.remove("skeleton");
      if (d.atr && d.atr.gold != null) {
        lastAtr = d.atr.gold;
        $("atr-box").dataset.ok = "1";
        $("atr-box").textContent = "14-day ATR " + d.atr.gold + " (≈ " + (d.atr.goldPips || d.atr.gold) + " pts)";
        atrSize(d.atr.gold);
      } else {
        $("atr-box").innerHTML = "<span class='inst-err'>ATR not ready — Retry or set stop manually</span>";
        atrSize(null);
      }
    }

    if ($("speakers")) {
      $("speakers").classList.remove("skeleton");
      const list = d.speakers || [];
      if (!list.length) {
        $("speakers").innerHTML = "<div class='event'>No Fed speak in calendar window</div>";
      } else {
        $("speakers").dataset.ok = "1";
        $("speakers").innerHTML = list.map((s) =>
          `<div class="event"><strong>${s.title}</strong><span>${s.date ? new Date(s.date).toLocaleString() : ""}</span><span class="tone-${s.tone || "neutral"}">${s.tone || "neutral"}</span></div>`
        ).join("");
      }
    }

    window.__inst = d;
  }

  // Trade log form
  $("trade-log-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const event = $("tl-event")?.value || "Other";
    const side = $("tl-side")?.value || "—";
    const result = $("tl-result")?.value || "BE";
    const rrRaw = $("tl-rr")?.value;
    const rr = rrRaw === "" || rrRaw == null ? null : Number(rrRaw);
    const rows = loadTrades();
    rows.unshift({ event, side, result, rr: Number.isFinite(rr) ? rr : null, at: new Date().toISOString() });
    saveTrades(rows);
    renderTrades();
    if ($("tl-rr")) $("tl-rr").value = "";
  });

  // Risk inputs live
  ["inst-bal", "inst-risk", "inst-stop", "inst-pipval"].forEach((id) => {
    $(id)?.addEventListener("input", () => atrSize(lastAtr));
  });

  // Per-card retry
  document.querySelectorAll(".inst-retry").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const kind = btn.getAttribute("data-retry");
      if (kind === "speak") {
        loadFedHeadlines();
        loadInst();
      } else {
        // clear ok flags so skeletons show
        ["curve-box", "tech-box", "atr-box", "speakers"].forEach((id) => {
          const el = $(id);
          if (el) delete el.dataset.ok;
        });
        loadInst();
      }
    });
  });

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.tab === "inst") loadInst();
    });
  });

  // Alerts (kept)
  let lastScore = null;
  let lastActualKey = "";
  async function watchAlerts() {
    try {
      const data = await (await fetchWithTimeout("/api/desk", 10000)).json();
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
    } catch (err) {}
  }

  $("alert-on")?.addEventListener("change", (ev) => {
    localStorage.setItem("deskAlertOn", ev.target.checked ? "1" : "0");
    if (ev.target.checked && Notification.permission === "default") Notification.requestPermission();
  });
  $("webhook-url")?.addEventListener("change", (ev) => localStorage.setItem("deskWebhook", ev.target.value || ""));
  if ($("webhook-url")) $("webhook-url").value = localStorage.getItem("deskWebhook") || "";

  renderTrades();
  atrSize(null);
  loadInst();
  setInterval(loadInst, 90000);
  watchAlerts();
  setInterval(watchAlerts, 30000);
})();
