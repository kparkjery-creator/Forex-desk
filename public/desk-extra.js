(function () {
  const zone = localStorage.getItem("deskZone") || "Africa/Lusaka";
  const weights = JSON.parse(localStorage.getItem("deskWeights") || '{"nfp":1.2,"cpi":1.4,"claims":1}');
  const hits = JSON.parse(localStorage.getItem("deskHits") || "[]");
  if (!hits.length) {
    localStorage.setItem("deskHits", JSON.stringify([
      { event: "ADP Sep", call: "USD up", result: "Gold -40 pips after the beat" },
      { event: "Claims Sep 26", call: "USD up", result: "DXY held the highs" },
      { event: "Core PCE", call: "soft", result: "Gold bounce faded, spend was hot" }
    ]));
  }

  function spark(values) {
    const w = 54, h = 16, min = Math.min(...values), max = Math.max(...values);
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / (max - min || 1)) * h;
      return x + "," + y;
    }).join(" ");
    return `<svg class="spark" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="#e2b656" stroke-width="1.5" points="${pts}"/></svg>`;
  }

  function mount() {
    const header = document.querySelector(".meta");
    if (header && !document.getElementById("zone")) {
      header.insertAdjacentHTML("afterbegin", `<select id="zone"><option value="Africa/Lusaka">CAT</option><option value="America/New_York">New York</option><option value="Europe/London">London</option><option value="UTC">UTC</option></select>`);
      document.getElementById("zone").value = zone;
      document.getElementById("zone").onchange = (e) => { localStorage.setItem("deskZone", e.target.value); location.reload(); };
    }
    const meter = document.querySelector(".signal-meter-container");
    if (meter && !document.getElementById("gauge")) {
      meter.insertAdjacentHTML("afterbegin", `<div class="gauge" id="gauge"><svg viewBox="0 0 220 120"><path d="M20 100 A90 90 0 0 1 200 100" fill="none" stroke="#2a3340" stroke-width="14"/><path d="M20 100 A90 90 0 0 1 110 12" fill="none" stroke="#e74c3c" stroke-width="14"/><path d="M110 12 A90 90 0 0 1 200 100" fill="none" stroke="#2ecc71" stroke-width="14"/><line class="needle" id="needle" x1="110" y1="100" x2="110" y2="28" stroke="#fff" stroke-width="3"/></svg></div>`);
    }
    const board = document.getElementById("board");
    if (board && !document.getElementById("desk-tools")) {
      board.insertAdjacentHTML("beforeend", `
        <section id="desk-tools">
          <div class="hit"><h3>Hit rate</h3><div id="hits"></div></div>
          <div class="risk">
            <h3>Weights and risk</h3>
            <label>NFP weight <input id="w-nfp" type="number" step="0.1" value="${weights.nfp}"></label>
            <label>CPI weight <input id="w-cpi" type="number" step="0.1" value="${weights.cpi}"></label>
            <label>Balance <input id="bal" type="number" value="1000"></label>
            <label>Risk % <input id="riskpct" type="number" value="1"></label>
            <p id="size">Lot size shows after you set a stop in pips.</p>
            <label>Stop pips <input id="stop" type="number" value="30"></label>
            <button id="alerts" type="button">Allow signal alert</button>
          </div>
        </section>`);
      document.getElementById("alerts").onclick = () => Notification.requestPermission();
      ["w-nfp", "w-cpi"].forEach((id) => document.getElementById(id).onchange = saveWeights);
      document.getElementById("stop").oninput = size;
      document.getElementById("bal").oninput = size;
      size();
    }
    const chat = document.getElementById("chat");
    if (chat && !document.getElementById("poll")) {
      chat.insertAdjacentHTML("afterbegin", `<div class="poll" id="poll"><strong>USD into NFP</strong><div><button type="button" id="bull">Bullish</button> <button type="button" id="bear">Bearish</button></div><p id="poll-out"></p></div>`);
      const poll = JSON.parse(localStorage.getItem("deskPoll") || '{"bull":0,"bear":0}');
      const draw = () => { document.getElementById("poll-out").textContent = `Bullish ${poll.bull} · Bearish ${poll.bear}`; };
      document.getElementById("bull").onclick = () => { poll.bull++; localStorage.setItem("deskPoll", JSON.stringify(poll)); draw(); };
      document.getElementById("bear").onclick = () => { poll.bear++; localStorage.setItem("deskPoll", JSON.stringify(poll)); draw(); };
      draw();
    }
    paintHits();
    tickMacro();
    setInterval(tickMacro, 15000);
    setInterval(clocks, 1000);
  }

  function saveWeights() {
    localStorage.setItem("deskWeights", JSON.stringify({
      nfp: Number(document.getElementById("w-nfp").value),
      cpi: Number(document.getElementById("w-cpi").value),
      claims: 1
    }));
  }
  function size() {
    const bal = Number(document.getElementById("bal").value) || 0;
    const pct = Number(document.getElementById("riskpct").value) || 1;
    const stop = Number(document.getElementById("stop").value) || 30;
    const risk = bal * pct / 100;
    const lots = stop ? (risk / (stop * 10)).toFixed(2) : "—";
    document.getElementById("size").textContent = `Risk $${risk.toFixed(0)} · about ${lots} lots if 1 lot is $10 a pip. Take profit 2R is ${stop * 2} pips.`;
  }
  function paintHits() {
    const box = document.getElementById("hits");
    if (!box) return;
    const rows = JSON.parse(localStorage.getItem("deskHits") || "[]");
    box.innerHTML = rows.map((r) => `<div>${r.event}: ${r.call} — ${r.result}</div>`).join("");
  }
  const hist = { dxy: [101.2, 101.4, 101.6, 101.8], y: [4.1, 4.15, 4.2, 4.18] };
  async function tickMacro() {
    try {
      const data = await (await fetch("/api/ticks")).json();
      const dxy = (data.quotes || []).find((q) => q.name === "DXY" && q.bid);
      if (dxy) hist.dxy.push(Number(dxy.bid));
    } catch (e) {}
    hist.dxy = hist.dxy.slice(-8);
    hist.y = hist.y.slice(-8);
    const dxy = hist.dxy[hist.dxy.length - 1];
    const y = hist.y[hist.y.length - 1];
    const real = (y - 3.4).toFixed(2);
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    set("dxy-ticker", `DXY ${dxy} ${spark(hist.dxy)}`);
    set("us10y-yield", `US10Y ${y.toFixed(2)}% ${spark(hist.y)}`);
    set("real-yield", `Real yield ${real}%`);
  }
  function clocks() {
    document.querySelectorAll(".card").forEach((card) => {
      if (card.dataset.armed) return;
      const text = card.innerText || "";
      if (!/Nonfarm|CPI|FOMC|PPI|PCE/i.test(text)) return;
      card.dataset.armed = "1";
      const line = document.createElement("div");
      line.className = "countdown";
      card.appendChild(line);
      card.onclick = () => openModal(card.innerText);
    });
    const nfp = new Date("2026-10-02T12:30:00Z");
    document.querySelectorAll(".countdown").forEach((el) => {
      const ms = nfp - Date.now();
      el.textContent = ms > 0 ? "NFP countdown " + new Date(ms).toISOString().substring(11, 19) : "NFP window open";
    });
    const score = Number(document.getElementById("score")?.textContent);
    if (Math.abs(score) >= 3 && Notification.permission === "granted" && !sessionStorage.getItem("alerted")) {
      new Notification("Desk left the no-trade zone", { body: "Score " + score });
      sessionStorage.setItem("alerted", "1");
    }
    const needle = document.getElementById("needle");
    if (needle && !Number.isNaN(score)) needle.style.transform = `rotate(${score * 9}deg)`;
  }
  function openModal(text) {
    let modal = document.getElementById("modal");
    if (!modal) {
      document.body.insertAdjacentHTML("beforeend", `<div class="modal" id="modal"><article><h3>Event</h3><p id="modal-body"></p><p>Replay: 1-minute spike, 5-minute fade, 15-minute trend. Wages decide if the first spike holds.</p><button type="button" id="close-modal">Close</button></article></div>`);
      modal = document.getElementById("modal");
      document.getElementById("close-modal").onclick = () => modal.classList.remove("on");
    }
    document.getElementById("modal-body").textContent = text.slice(0, 500);
    modal.classList.add("on");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
