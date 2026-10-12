(function () {
  const $ = (id) => document.getElementById(id);

  function paintBanners(d) {
    const lockText = d.lockout && d.lockout.active
      ? "NO-TRADE LOCKOUT · " + d.lockout.reason
      : "Guardrails clear · " + (d.lockout && d.lockout.reason ? d.lockout.reason : "path open");
    ["lockout-banner", "board-lockout"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.hidden = false;
      el.textContent = lockText;
      el.classList.toggle("clear", !(d.lockout && d.lockout.active));
    });
    const f = d.fakeout;
    ["fakeout-banner", "board-fakeout"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      if (!f || f.level === "clear") {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.textContent = f.title + " · " + f.text;
      el.classList.toggle("info", f.level === "info");
    });
  }

  function sizeOut(d) {
    const bal = Number($("cf-bal") && $("cf-bal").value) || 1000;
    const base = Number($("cf-risk") && $("cf-risk").value) || 1;
    const w = (d.sizing && d.sizing.eventWeight) || 1;
    const vm = (d.sizing && d.sizing.volMult) || 1;
    const riskPct = Math.max(0.15, base / w / vm);
    const riskCash = bal * riskPct / 100;
    const stop = (d.sizing && d.sizing.suggestedStopPts) || 25;
    // rough $1 per point per 0.01 lot scale for display
    const lots = stop ? (riskCash / stop).toFixed(2) : "—";
    if ($("cf-size-out")) {
      $("cf-size-out").textContent =
        "Suggested risk " + riskPct.toFixed(2) + "% ($" + riskCash.toFixed(0) + ") · stop ~" + stop +
        " pts · size guide " + lots + " · weight " + w + "× · vol " + vm + "×";
    }
  }

  async function load() {
    try {
      const d = await (await fetch("/api/confluence")).json();
      window.__confluence = d;
      paintBanners(d);
      if ($("cf-session")) $("cf-session").textContent = d.session || "—";
      if ($("cf-session-note")) $("cf-session-note").textContent = d.sessionNote || "";
      if ($("cf-score")) {
        $("cf-score").textContent = "Score " + (d.score != null ? d.score : "—") +
          (d.noTradeZone ? " · NO-TRADE ZONE" : " · TRADEABLE");
        $("cf-score").className = d.noTradeZone ? "neg" : "pos";
      }
      if ($("cf-lock")) $("cf-lock").textContent = (d.lockout && d.lockout.reason) || "";

      if ($("cf-levels") && d.levels) {
        const L = d.levels;
        $("cf-levels").innerHTML =
          '<table class="level-table">' +
          "<tr><td>Spot</td><td>" + L.spot + "</td></tr>" +
          "<tr><td>ATR (14d)</td><td>" + L.atr + "</td></tr>" +
          "<tr><td>Upper 0.75×</td><td class='pos'>" + L.upper1 + "</td></tr>" +
          "<tr><td>Upper 1.25×</td><td class='pos'>" + L.upper2 + "</td></tr>" +
          "<tr><td>Lower 0.75×</td><td class='neg'>" + L.lower1 + "</td></tr>" +
          "<tr><td>Lower 1.25×</td><td class='neg'>" + L.lower2 + "</td></tr>" +
          "<tr><td>Liquidity high</td><td>" + L.liquidityHigh + "</td></tr>" +
          "<tr><td>Liquidity low</td><td>" + L.liquidityLow + "</td></tr>" +
          "</table><small>" + (L.note || "") + "</small>";
      } else if ($("cf-levels")) $("cf-levels").textContent = "Levels not ready";

      if ($("cf-size") && d.sizing) {
        $("cf-size").textContent = d.sizing.note + " Event weight " + d.sizing.eventWeight + ".";
        sizeOut(d);
      }

      if ($("cf-orb")) {
        if (d.orb) {
          const o = d.orb;
          $("cf-orb").innerHTML =
            "<strong>" + o.event + "</strong><br>" +
            "Pre-news box: " + new Date(o.preBoxStart).toLocaleString() + " → " + new Date(o.preBoxEnd).toLocaleString() + "<br>" +
            (o.targetUp != null ? ("Breakout targets: up " + o.targetUp + " / down " + o.targetDown +
              " · stretch " + o.stretchUp + " / " + o.stretchDown + "<br>") : "") +
            "<span class='section-desc'>" + o.rule + "</span>";
        } else $("cf-orb").textContent = "No upcoming Tier-1 event for ORB.";
      }

      if ($("cf-deltas")) {
        $("cf-deltas").innerHTML = (d.deltas || []).map((x) =>
          '<div class="delta-row ' + x.color + '"><strong>' + x.title + "</strong><span>" +
          x.sentiment + "</span><span>" + x.text + "</span></div>"
        ).join("") || "<div class='event'>No printed surprises yet</div>";
      }

      if ($("cf-div")) {
        const v = d.divergence || {};
        const f = d.fakeout || {};
        $("cf-div").innerHTML =
          (f.title ? ("<strong>" + f.title + "</strong><br>" + f.text + "<br><br>") : "") +
          "Gold day Δ " + (v.goldChg != null ? v.goldChg : "—") +
          " · DXY Δ " + (v.dxyChg != null ? v.dxyChg : "—") +
          " · 10Y Δ " + (v.yieldChg != null ? v.yieldChg : "—") +
          " · Real yield ~ " + (v.realYield != null ? v.realYield + "%" : "—");
      }
    } catch (err) {
      if ($("cf-session")) $("cf-session").textContent = "Feed failed — redeploy server.js";
    }
  }

  $("cf-bal") && $("cf-bal").addEventListener("change", () => window.__confluence && sizeOut(window.__confluence));
  $("cf-risk") && $("cf-risk").addEventListener("change", () => window.__confluence && sizeOut(window.__confluence));

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.tab === "confluence") load();
    });
  });

  // titles map if present
  try {
    // app.js owns tab switching; ensure panel toggles work via existing handlers
  } catch (err) {}

  load();
  setInterval(load, 60000);
})();
