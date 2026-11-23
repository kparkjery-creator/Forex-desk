const majorsEl = document.getElementById("majors");
const monthsEl = document.getElementById("months");

function when(iso) {
  if (!iso) return "Stand-by";
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

  if (bias.lockPreEvent) {
    actionEl.textContent = "Signal State: PRE-EVENT LOCKOUT — FLAT · wait for release & price confirmation";
    actionEl.className = "signal-action neutral";
    return;
  }
  if (bias.blockedByPrice) {
    actionEl.textContent = "Signal State: PRICE-ACTION BLOCK — gold/DXY/yields disagree";
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

let lastDeskData = null;
let activeFilter = "all";

function atrLevels(price, side) {
  const atr = 35;
  const p = (price != null && Number.isFinite(Number(price))) ? Number(price) : null;
  if (side === "BUY") {
    if (p == null) return { entry: "Trigger", stop: "20 pts", tp1: "40 pts (2R)", tp2: "60 pts (3R)" };
    return {
      entry: p.toFixed(1),
      stop: (p - atr * 0.5).toFixed(1),
      tp1: (p + atr * 0.75).toFixed(1),
      tp2: (p + atr * 1.25).toFixed(1)
    };
  }
  if (side === "SELL") {
    if (p == null) return { entry: "Trigger", stop: "20 pts", tp1: "40 pts (2R)", tp2: "60 pts (3R)" };
    return {
      entry: p.toFixed(1),
      stop: (p + atr * 0.5).toFixed(1),
      tp1: (p - atr * 0.75).toFixed(1),
      tp2: (p - atr * 1.25).toFixed(1)
    };
  }
  return {
    entry: p != null ? "Wait (" + p.toFixed(1) + ")" : "Wait",
    stop: "20 pts",
    tp1: "40 pts (2R)",
    tp2: "60 pts (3R)"
  };
}

function updateSignalCard(data, filterKey) {
  const b = (data && data.bias) || {};
  const majors = (data && data.majors) || [];
  const card = document.getElementById("signal-card");
  if (!card) return;

  let focusKey = filterKey && filterKey !== "all" ? filterKey : (b.focusKey || "all");
  let major = majors.find((m) => m.key === focusKey) || majors.find((m) => m.key === b.focusKey);
  if (!major || !major.next) {
    major = majors.filter((m) => m.next).sort((a, b2) => new Date(a.next.date) - new Date(b2.next.date))[0];
  }

  const eventTitle = (major && major.next && major.next.title) || b.focusTitle || "Next Tier-1 release";
  const eventWhen = (major && major.next && major.next.date) || b.focusWhen;
  const sig = (major && major.signal) || b;
  const pa = b.priceAction || {};
  const goldPx = pa.goldLast != null ? pa.goldLast : (lastGold != null ? lastGold : parseFloat(document.getElementById("gold-px")?.textContent));

  let side = "FLAT";
  let reason = "";
  let conf = 0;

  if (b.lockPreEvent || (sig && sig.lockPreEvent)) {
    side = "FLAT";
    reason = "PRE-EVENT LOCKOUT (" + eventTitle + ") · Stand down ahead of release. Trade only after actual print + price gate agree.";
    conf = 15;
  } else if (b.noTrade || (sig && sig.noTrade)) {
    side = "FLAT";
    const rawReason = (sig && sig.gold) || b.gold || "";
    reason = rawReason || ("FLAT until " + eventTitle + " prints and leads, yields/DXY, and XAU price structure align.");
    conf = 25;
  } else if (b.macroLean === "sell_gold" || /sell gold/i.test((sig && sig.gold) || b.gold || "")) {
    side = "SELL";
    reason = (sig && sig.gold) || b.gold || "Sell gold path (" + eventTitle + ").";
    conf = Math.min(95, 55 + Math.abs(Number(b.score) || 0) * 4);
  } else if (b.macroLean === "buy_gold" || /buy gold/i.test((sig && sig.gold) || b.gold || "")) {
    side = "BUY";
    reason = (sig && sig.gold) || b.gold || "Buy gold path (" + eventTitle + ").";
    conf = Math.min(95, 55 + Math.abs(Number(b.score) || 0) * 4);
  } else {
    side = "FLAT";
    reason = (sig && sig.call) || b.call || ("Stand-by for " + eventTitle + " · Desk shows BUY / SELL only when leads + price action agree.");
    conf = 0;
  }

  if (/FOMC|fed interest|interest rate decision/i.test(eventTitle) || focusKey === "FOMC") {
    if (side === "FLAT") {
      reason = "FOMC window (" + eventTitle + ") · FLAT into the decision. Trade statement/presser surprise only after price gate confirms.";
    }
  }

  const levels = atrLevels(goldPx, side);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("sig-time", eventWhen ? when(eventWhen) : "Stand-by");
  set("sig-event", eventTitle.length > 42 ? eventTitle.slice(0, 40) + "…" : eventTitle);
  set("sig-side", side);
  set("sig-side-sm", side === "FLAT" ? "FLAT · No confirmed setup" : side);
  set("sig-conf", conf + "%");
  set("sig-reason", reason);
  set("sig-entry", levels.entry);
  set("sig-stop", levels.stop);
  set("sig-tp1", levels.tp1);
  set("sig-tp2", levels.tp2);

  const bar = document.getElementById("sig-bar");
  const barPct = document.getElementById("sig-bar-pct");
  if (bar) {
    bar.style.width = conf + "%";
    bar.className = "sig-bar " + (side === "BUY" ? "buy" : side === "SELL" ? "sell" : "flat");
  }
  if (barPct) barPct.textContent = conf + "%";

  card.classList.remove("side-buy", "side-sell", "side-flat");
  card.classList.add(side === "BUY" ? "side-buy" : side === "SELL" ? "side-sell" : "side-flat");

  const sideEl = document.getElementById("sig-side");
  if (sideEl) {
    sideEl.className = "sig-side " + (side === "BUY" ? "pos" : side === "SELL" ? "neg" : "flat");
  }
  if (typeof paintPriceGate === "function") paintPriceGate(b);
  if (typeof syncRiskFromSignal === "function") syncRiskFromSignal();
}

function paintPriceGate(b) {
  const pa = (b && b.priceAction) || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const badge = (id, state, label) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = label;
    el.className = "pa-badge " + state;
  };
  if (pa.goldLast != null) {
    const chg = pa.goldChg != null ? ((pa.goldChg >= 0 ? "+" : "") + pa.goldChg.toFixed(1)) : "";
    set("pa-gold", pa.goldLast.toFixed(1) + " " + chg);
    set("pa-gold-sma", "SMA " + (pa.goldVsSma || "—"));
    badge("pa-badge-gold", pa.goldVsSma === "above" || (pa.goldChg != null && pa.goldChg >= 0) ? "green" : "red",
      pa.goldChg != null && pa.goldChg >= 0 ? "FIRM" : "SOFT");
  }
  if (pa.dxyLast != null) {
    const chg = pa.dxyChg != null ? ((pa.dxyChg >= 0 ? "+" : "") + pa.dxyChg.toFixed(3)) : "";
    set("pa-dxy", pa.dxyLast.toFixed(2) + " " + chg);
    set("pa-dxy-sma", "SMA " + (pa.dxyVsSma || "—"));
    badge("pa-badge-dxy", (pa.dxyChg != null && pa.dxyChg > 0.05) ? "red" : "green",
      (pa.dxyChg != null && pa.dxyChg > 0.05) ? "FIRM USD" : "SOFT USD");
  }
  if (pa.y10 != null) {
    set("pa-y10", pa.y10.toFixed(2));
    const yc = pa.yChg != null ? ((pa.yChg >= 0 ? "+" : "") + pa.yChg.toFixed(3)) : "—";
    set("pa-y-chg", "Δ " + yc);
    badge("pa-badge-y10", (pa.yChg != null && pa.yChg > 0.02) ? "red" : "green",
      (pa.yChg != null && pa.yChg > 0.02) ? "YIELDS UP" : "YIELDS OK");
  }
  const gateEl = document.getElementById("pa-gate");
  const gateNote = document.getElementById("pa-gate-note");
  if (b && b.lockPreEvent) {
    if (gateEl) { gateEl.textContent = "LOCKOUT"; gateEl.className = "flat"; }
    badge("pa-badge-gate", "neutral", "FLAT");
    if (gateNote) gateNote.textContent = "Pre-event";
  } else if (b && b.blockedByPrice) {
    if (gateEl) { gateEl.textContent = "BLOCKED"; gateEl.className = "block"; }
    badge("pa-badge-gate", "red", "NO");
    if (gateNote) gateNote.textContent = "Macro ≠ price";
  } else if (b && b.macroLean === "sell_gold" && pa.agreesSellGold) {
    if (gateEl) { gateEl.textContent = "SELL OK"; gateEl.className = "agree"; }
    badge("pa-badge-gate", "green", "YES");
    if (gateNote) gateNote.textContent = "Aligned";
  } else if (b && b.macroLean === "buy_gold" && pa.agreesBuyGold) {
    if (gateEl) { gateEl.textContent = "BUY OK"; gateEl.className = "agree"; }
    badge("pa-badge-gate", "green", "YES");
    if (gateNote) gateNote.textContent = "Aligned";
  } else if (b && b.noTrade) {
    if (gateEl) { gateEl.textContent = "FLAT"; gateEl.className = "flat"; }
    badge("pa-badge-gate", "neutral", "WAIT");
    if (gateNote) gateNote.textContent = "No-trade zone";
  } else {
    if (gateEl) { gateEl.textContent = "OPEN"; gateEl.className = "agree"; }
    badge("pa-badge-gate", "green", "OPEN");
    if (gateNote) gateNote.textContent = pa.text || "Path clear";
  }
}

function calcRisk() {
  const bal = Number(document.getElementById("risk-balance")?.value) || 1000;
  const pct = Number(document.getElementById("risk-pct")?.value) || 1;
  const stop = Number(document.getElementById("risk-stop")?.value) || 20;
  const pipval = Number(document.getElementById("risk-pipval")?.value) || 1;
  const riskDollars = bal * (pct / 100);
  const lots = stop > 0 && pipval > 0 ? riskDollars / (stop * pipval) : 0;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("risk-dollars", "$" + riskDollars.toFixed(2));
  set("risk-lots", lots.toFixed(2));
  const from = document.getElementById("risk-from-sig");
  if (from) from.textContent = "$" + riskDollars.toFixed(2) + " / " + lots.toFixed(2) + " lot";
}

function syncRiskFromSignal() {
  const entry = parseFloat(document.getElementById("sig-entry")?.textContent);
  const stop = parseFloat(document.getElementById("sig-stop")?.textContent);
  if (Number.isFinite(entry) && Number.isFinite(stop)) {
    const pts = Math.max(1, Math.round(Math.abs(entry - stop)));
    const inp = document.getElementById("risk-stop");
    if (inp) inp.value = pts;
  }
  calcRisk();
}

function paintSessionOverlap() {
  const h = (new Date().getUTCHours() + 2) % 24;
  const ids = ["ov-asia", "ov-london", "ov-overlap", "ov-ny"];
  ids.forEach((id) => document.getElementById(id)?.classList.remove("on"));
  let note = "";
  if (h >= 0 && h < 8) {
    document.getElementById("ov-asia")?.classList.add("on");
    note = "Asia session · quieter gold ranges. Size carefully and wait for London/NY liquidity.";
  } else if (h >= 8 && h < 14) {
    document.getElementById("ov-london")?.classList.add("on");
    note = "London · liquidity builds. Prepare ORB into 14:30–16:30 CAT overlap and US data.";
  } else if (h >= 14 && h < 17) {
    document.getElementById("ov-overlap")?.classList.add("on");
    note = "London–NY overlap · highest impact window. Watch US releases and price confirmation.";
  } else if (h >= 17 && h < 22) {
    document.getElementById("ov-ny")?.classList.add("on");
    note = "New York · active US session. Size down into releases; trade confirmed follow-through.";
  } else {
    note = "Off-hours / thin liquidity. Avoid chasing wide spreads; wait for clean structure.";
  }
  const n = document.getElementById("ov-note");
  if (n) n.textContent = note;
}

function applyFomcScenario(side, label) {
  const pa = (lastDeskData && lastDeskData.bias && lastDeskData.bias.priceAction) || {};
  const px = pa.goldLast != null ? pa.goldLast : (lastGold != null ? lastGold : parseFloat(document.getElementById("gold-px")?.textContent));
  const L = atrLevels(px, side === "FLAT" ? "FLAT" : side);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("sig-side", side);
  set("sig-side-sm", label + " · Preview");
  set("sig-event", "Policy scenario: " + label);
  set("sig-reason", "Scenario preview only — wait for actual release + price gate before size. " + label + " → " + side + " gold path.");
  set("sig-entry", L.entry);
  set("sig-stop", L.stop);
  set("sig-tp1", L.tp1);
  set("sig-tp2", L.tp2);
  set("sig-conf", side === "FLAT" ? "20%" : "50%");
  syncRiskFromSignal();
  document.querySelectorAll(".fomc-row").forEach((r) => r.classList.toggle("on", r.getAttribute("data-label") === label));
}

function applyEventFilter(key) {
  activeFilter = key || "all";
  document.querySelectorAll(".sig-filter").forEach((btn) => {
    btn.classList.toggle("on", btn.getAttribute("data-filter") === activeFilter);
  });
  document.querySelectorAll("#majors .card").forEach((card) => {
    const k = card.getAttribute("data-key") || "";
    card.style.display = (activeFilter === "all" || k === activeFilter) ? "" : "none";
  });
  if (lastDeskData) updateSignalCard(lastDeskData, activeFilter);
}

document.querySelectorAll(".sig-filter").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyEventFilter(btn.getAttribute("data-filter") || "all");
  });
});

function render(data) {
  lastDeskData = data;
  document.getElementById("updated").textContent =
    "Calendar " + new Date(data.fetchedAt).toLocaleString() + " · next pull " + new Date(data.nextRefresh).toLocaleString() + " · focus " + ((data.bias && data.bias.focusKey) || "CORE");

  document.getElementById("usd").textContent = data.bias.call || "FLAT";
  document.getElementById("gold").textContent = data.bias.gold || "Stand-by";
  document.getElementById("score").textContent = data.bias.score !== undefined ? data.bias.score : "0";
  document.getElementById("score").className = Number(data.bias.score) > 0 ? "pos" : Number(data.bias.score) < 0 ? "neg" : "flat";
  document.getElementById("gold").className = /sell/i.test(data.bias.gold || "") ? "neg" : /buy/i.test(data.bias.gold || "") ? "pos" : "";

  calculateConfluenceScore(data.bias);

  const orderedMajors = (data.majors || []).filter((m) => m.next).sort((a, b) => new Date(a.next.date) - new Date(b.next.date));
  const focus = orderedMajors.find((m) => m.key === "CORE") || orderedMajors.find((m) => m.key === "CPI") || orderedMajors[0] || (data.majors && data.majors[0]);
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
  majorsEl.innerHTML = (data.majors || []).map((m) => `
    <article class="card" data-key="${m.key}">
      <p>${m.key}</p>
      <h4>${m.next ? m.next.title : "No date in the next 6 months"}</h4>
      <p class="primer">${primers[m.key] || ""}</p>
      <div>${m.next ? when(m.next.date) + " · " + nums(m.next) : ""}</div>
      <div class="lead"><div><span class="tag">signal</span> ${m.signal.call} ${m.signal.gold}</div>
        <div><span class="tag">later</span> ${m.later.length ? m.later.map((e) => when(e.date)).join(" · ") : "Stand-by"}</div>
        ${(m.leads.length ? m.leads : [{ title: "Leads show once they enter the window" }]).map((e) => `<div><span class="tag">lead</span> ${e.title}${e.actual ? " · actual " + e.actual + " vs " + e.forecast : ""}</div>`).join("")}
      </div>
    </article>
  `).join("");

  monthsEl.innerHTML = Object.entries(data.months || {}).map(([month, rows]) => `
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

  updateSignalCard(data, activeFilter);
  paintSessionOverlap();
  loadEdgeMetrics();
  document.querySelectorAll("#majors .card").forEach((card) => {
    const k = card.getAttribute("data-key") || "";
    card.style.display = (activeFilter === "all" || k === activeFilter) ? "" : "none";
  });

  const cd = document.getElementById("event-cd");
  if (cd && data.bias && data.bias.focusWhen) {
    const ms = new Date(data.bias.focusWhen).getTime() - Date.now();
    if (ms > 0) {
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      cd.textContent = "Next: " + (data.bias.focusKey || "event") + " in " + h + "h " + m + "m";
    } else {
      cd.textContent = "Next: " + (data.bias.focusTitle || data.bias.focusKey || "event");
    }
  }
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
      return `<article class="quote ${dir}"><strong>${q.name}</strong><b>${q.bid ?? "Stand-by"}</b><small>bid ${q.bid ?? "—"} · ask ${q.ask ?? "—"}</small><small class="${chg}">${q.change > 0 ? "+" : ""}${q.change ?? "0.00"} vs prior close</small></article>`;
    }).join("");
  } catch (err) {
    box.textContent = "Bid/ask feed offline — check live quote stream.";
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
    if (box) {
      box.innerHTML = data.quotes.map((q) => `<span><strong>${q.name}</strong> ${q.bid ?? "—"} / ${q.ask ?? "—"}</span>`).join("");
    }
    const dxyQuote = data.quotes.find((q) => q.name.includes("DXY") || q.name.includes("USD"));
    if (dxyQuote && document.getElementById("dxy-ticker") && dxyQuote.bid != null) {
      document.getElementById("dxy-ticker").textContent = `DXY: ${dxyQuote.bid}`;
    }
  } catch (err) {
    if (box) box.textContent = "Tick feed offline";
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
    box.textContent = "News feed offline — check live news endpoint.";
  }
}
news();
setInterval(news, 300000);

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

const titles = { board: "Market overview", charts: "Market charts", sessions: "Session drivers", setup: "Gold Daily Setup", calendar: "Market calendar", inst: "Institutional desk", confluence: "Macro–technical confluence", vol100: "Volatility 100 desk", goldstudy: "Gold study desk", headlines: "Headlines" };
document.querySelectorAll(".tab").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("on"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("on"));
    btn.classList.add("on");
    document.getElementById(btn.dataset.tab).classList.add("on");
    document.getElementById("title").textContent = titles[btn.dataset.tab] || btn.textContent;
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
    return "Soft core is the gold-friendly print. Buy gold only after price holds and confirms, not on the first spike.";
  }
  if (cpi && core && hot) {
    return "Hot core flips the lean toward firmer USD / sell gold pressure. Wait for price gate confirmation.";
  }
  if (cpi && /headline/.test(text) && hot) {
    return "Headline can look hot from energy while core stays calm. Check core and price structure before acting.";
  }
  if (nfp) {
    return "Jobs/NFP prints move rate and growth expectations. Check job additions, wage growth, and whether XAU holds or rejects.";
  }
  if (claims && /higher claims.*strong|claims up.*usd up/.test(text)) {
    return "Correction: higher jobless claims point to softer labor momentum rather than automatic USD strength.";
  }
  if (wantsBuy) {
    return "Buy gold setups require soft inflation/yield pressure or a confirmed breakout/retest with risk defined.";
  }
  if (wantsSell) {
    return "Sell gold setups require firm inflation/yields or a confirmed breakdown/rejection with risk defined.";
  }
  return "State buy or sell and check core vs. headline data, yields/DXY, and price structure before entering.";
}

const log = document.getElementById("log");
const askForm = document.getElementById("ask");
if (log && askForm) {
  askForm.onsubmit = (e) => {
    e.preventDefault();
    const q = document.getElementById("q").value.trim();
    if (!q) return;
    log.innerHTML += `<div class="msg me">${q}</div><div class="msg">${reply(q)}</div>`;
    document.getElementById("q").value = "";
    log.scrollTop = log.scrollHeight;
  };
}

async function loadFomcStatus() {
  try {
    const r = await fetch("/api/fomc");
    if (!r.ok) return;
    const d = await r.json();
    const st = document.getElementById("fomc-status");
    const title = document.getElementById("fomc-title");
    const whenEl = document.getElementById("fomc-when");
    if (title && d.title) title.textContent = d.title;
    if (whenEl && d.whenText) whenEl.