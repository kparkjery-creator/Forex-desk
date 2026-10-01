const majorsEl = document.getElementById("majors");
const monthsEl = document.getElementById("months");

function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function nums(e) {
  return [e.actual !== "" && e.actual != null ? "act " + e.actual : "upcoming", e.forecast !== "" && e.forecast != null ? "fcst " + e.forecast : "", e.previous !== "" && e.previous != null ? "prev " + e.previous : ""].filter(Boolean).join(" · ");
}

function render(data) {
  document.getElementById("updated").textContent =
    "Calendar pulled " + new Date(data.fetchedAt).toLocaleString() + " · next weekly refresh " + new Date(data.nextRefresh).toLocaleDateString();
  document.getElementById("usd").textContent = data.bias.call;
  document.getElementById("gold").textContent = data.bias.gold;
  document.getElementById("score").textContent = data.bias.score;

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
      ${rows.map((e) => `<div class="lead"><div><strong>${e.title}</strong><br>${when(e.date)} · ${nums(e)}</div></div>`).join("")}
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

document.getElementById("refresh").onclick = () => load(true);
load(false);
