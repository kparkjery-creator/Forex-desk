// Forex Desk headlines: Trump posts, official releases, market news and gold news in one feed.
// Mounted from server.js with: require("./newsmodule")(app);
// Each source is fetched on its own. A source that is down shows ok:false and never breaks the others.
// Add or replace feeds with the FEEDS_EXTRA environment variable: a JSON array like
//   [{"id":"x","name":"My feed","group":"markets","url":"https://example.com/rss"}]
// Groups: trump | official | markets | gold | oil

const gnews = (q, loc) => "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + (loc || "&hl=en-US&gl=US&ceid=US:en");

const SOURCES = [
  { id: "truth", name: "Truth Social posts (public mirror)", group: "trump", url: "https://www.trumpstruth.org/feed", posts: true },
  { id: "trump-news", name: "Trump coverage: Google News", group: "trump", url: gnews("Trump (Truth Social OR tariffs OR dollar OR Fed OR sanctions) when:1d") },
  { id: "fed", name: "Federal Reserve press releases", group: "official", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { id: "bls", name: "BLS latest releases", group: "official", url: "https://www.bls.gov/feed/bls_latest.rss" },
  { id: "whitehouse", name: "White House", group: "official", url: "https://www.whitehouse.gov/feed/" },
  { id: "treasury", name: "Treasury and Fed news: Google News", group: "official", url: gnews("(Treasury Secretary OR Federal Reserve OR Fed chair) when:1d") },
  { id: "fxstreet", name: "FXStreet news", group: "markets", url: "https://www.fxstreet.com/rss/news" },
  { id: "cnbc", name: "CNBC finance", group: "markets", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html" },
  { id: "marketwatch", name: "MarketWatch top stories", group: "markets", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { id: "bbg-mkts", name: "Bloomberg Markets", group: "markets", url: "https://feeds.bloomberg.com/markets/news.rss" },
  { id: "bbg-econ", name: "Bloomberg Economics", group: "markets", url: "https://feeds.bloomberg.com/economics/news.rss" },
  { id: "bbg-pol", name: "Bloomberg Politics", group: "official", url: "https://feeds.bloomberg.com/politics/news.rss" },
  { id: "oil-news", name: "Oil news: Google News", group: "oil", url: gnews("(oil prices OR crude OR Brent OR WTI OR OPEC) when:1d") },
  { id: "oilprice", name: "OilPrice.com", group: "oil", url: "https://oilprice.com/rss/main" },
  { id: "dollar", name: "Dollar and yields: Google News", group: "markets", url: gnews("(US dollar OR Treasury yields OR DXY) when:1d") },
  { id: "gold", name: "Gold news: Google News", group: "gold", url: gnews("(gold price OR XAUUSD) when:1d") }
];

// Topic tags by keyword. A tag means "a topic that often moves the dollar", not a direction call.
const TAGS = [
  ["Tariffs", /tariff|trade war|import dut|trade deal/i],
  ["Fed", /\bfed\b|federal reserve|powell|fomc|rate cut|rate hike|interest rate|balance sheet/i],
  ["Fed chair", /fed chair|chair of the fed|next fed|powell (successor|replacement)/i],
  ["Inflation", /inflation|\bcpi\b|\bpce\b|\bppi\b|prices rose|price pressures/i],
  ["Jobs", /payroll|nonfarm|non-farm|jobless|unemployment|jobs report|\bjolts\b/i],
  ["Dollar", /dollar|\bdxy\b|greenback|usd\b/i],
  ["Yields", /treasury yield|10-year|bond yield|yields/i],
  ["Sanctions / war", /sanction|war\b|missile|ceasefire|strike on|invasion|tension/i],
  ["Oil", /\boil\b|crude|opec|\bbrent\b|\bwti\b|barrel|refiner|oil inventor|\beia\b/i],
  ["Middle East", /hormuz|iran|israel|saudi|red sea|gaza|houthi|strait of/i],
  ["Gold", /\bgold\b|xauusd|bullion/i],
  ["Shutdown / debt", /shutdown|debt ceiling|credit rating|downgrade/i]
];
const HIGH = /tariff|rate cut|rate hike|fed chair|sanction|shutdown|emergency|executive order|ceasefire|default|downgrade/i;

const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ""; } })
  .replace(/&amp;/g, "&");
const strip = (s) => decode(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const tag = (block, name) => { const m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i")); return m ? m[1] : ""; };

function parseFeed(xml, max) {
  const out = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.split(isAtom ? /<entry[\s>]/i : /<item[\s>]/i).slice(1, max + 1);
  for (const b of blocks) {
    const title = strip(tag(b, "title"));
    let link = strip(tag(b, "link"));
    if (!link || isAtom) { const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); if (m) link = decode(m[1]); }
    if (!link) link = strip(tag(b, "guid"));
    const dateRaw = strip(tag(b, isAtom ? "updated" : "pubDate")) || strip(tag(b, "published")) || strip(tag(b, "dc:date"));
    const t = Date.parse(dateRaw);
    const desc = strip(tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content"));
    if (title || desc) out.push({ title, link, date: isNaN(t) ? null : new Date(t).toISOString(), desc });
  }
  return out;
}

function tagsFor(text) { return TAGS.filter(([, rx]) => rx.test(text)).map(([n]) => n); }

module.exports = function mount(app) {
  let extra = [];
  try { extra = JSON.parse(process.env.FEEDS_EXTRA || "[]").filter((s) => s && s.url && s.id); } catch {}
  const sources = SOURCES.concat(extra.map((s) => ({ id: String(s.id).slice(0, 30), name: String(s.name || s.id).slice(0, 60), group: ["trump", "official", "markets", "gold", "oil"].includes(s.group) ? s.group : "markets", url: String(s.url) })));
  let cache = { at: 0, body: null };
  let inflight = null;

  async function pull(src) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(src.url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; forex-desk)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const xml = await r.text();
      const items = parseFeed(xml, src.posts ? 20 : 12);
      if (!items.length) throw new Error("no items in feed");
      return { src, ok: true, items };
    } catch (e) {
      return { src, ok: false, error: e.name === "AbortError" ? "timed out" : String(e.message || e).slice(0, 80), items: [] };
    } finally { clearTimeout(to); }
  }

  async function build() {
    const results = await Promise.all(sources.map(pull));
    const seen = new Set();
    const items = [];
    for (const r of results) {
      for (const it of r.items) {
        let title = it.title;
        if (r.src.posts && (!title || /^\[?no title\]?(\s*[-:]\s*post)?$/i.test(title) || /^post$/i.test(title))) title = (it.desc || "").slice(0, 160);
        if (!title) title = (it.desc || "").slice(0, 140);
        const key = title.toLowerCase().replace(/\W+/g, " ").trim().slice(0, 160);
        if (!title || seen.has(key)) continue;
        seen.add(key);
        const text = title + " " + (it.desc || "");
        items.push({ source: r.src.id, sourceName: r.src.name, group: r.src.group, title, snippet: r.src.posts ? (it.desc || "").slice(0, 600) : "", link: it.link || "", date: it.date, tags: tagsFor(text), high: HIGH.test(text) });
      }
    }
    items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return {
      updated: new Date().toISOString(),
      sources: results.map((r) => ({ id: r.src.id, name: r.src.name, group: r.src.group, ok: r.ok, count: r.items.length, error: r.error || null })),
      items: items.slice(0, 300),
      note: "Tags mark topics that often move the dollar. They are not buy or sell calls."
    };
  }

  // ---- live prices with a correct daily change (vs previous daily close) ----
  const SYMS = [["GOLD", "Gold", "GC=F", 2], ["WTI", "WTI oil", "CL=F", 2], ["BRENT", "Brent oil", "BZ=F", 2], ["DXY", "Dollar index", "DX-Y.NYB", 3], ["US10Y", "US 10Y yield", "^TNX", 3], ["VIX", "VIX", "^VIX", 2]];
  let mcache = { at: 0, body: null };
  async function quote([key, name, sym, dp]) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?interval=1d&range=10d", { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 forex-desk" } });
      const text = await r.text();
      if (!r.ok || text.startsWith("Too Many")) throw new Error("HTTP " + r.status);
      const res = JSON.parse(text).chart.result[0];
      const price = Number(res.meta.regularMarketPrice);
      const ts = res.timestamp || [], cl = res.indicators.quote[0].close || [];
      const rows = []; for (let i = 0; i < ts.length; i++) if (cl[i] != null) rows.push([ts[i], cl[i]]);
      const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
      const mt = res.meta.regularMarketTime;
      let prev = null;
      if (rows.length >= 2) prev = mt && day(rows[rows.length - 1][0]) === day(mt) ? rows[rows.length - 2][1] : rows[rows.length - 1][1];
      const chg = prev ? price - prev : null;
      return { key, name, symbol: sym, price: Number(price.toFixed(dp)), change: chg == null ? null : Number(chg.toFixed(dp)), changePct: prev ? Number(((chg / prev) * 100).toFixed(2)) : null, time: mt ? new Date(mt * 1000).toISOString() : null, ok: true };
    } catch (e) { return { key, name, symbol: sym, ok: false, error: e.name === "AbortError" ? "timed out" : String(e.message || e).slice(0, 60) }; }
    finally { clearTimeout(to); }
  }
  app.get("/api/markets", async (req, res) => {
    if (mcache.body && Date.now() - mcache.at < 20000) return res.json(mcache.body);
    const quotes = await Promise.all(SYMS.map(quote));
    const body = { updated: new Date().toISOString(), quotes, source: "Yahoo Finance (delayed; futures: GC=F, CL=F, BZ=F)" };
    if (quotes.some((q) => q.ok)) mcache = { at: Date.now(), body };
    res.json(body);
  });

  app.get("/api/headlines", async (req, res) => {
    try {
      const force = req.query.refresh === "1";
      if (!force && cache.body && Date.now() - cache.at < 90000) return res.json(cache.body);
      if (!inflight) inflight = build().finally(() => { inflight = null; });
      const body = await inflight;
      cache = { at: Date.now(), body };
      res.json(body);
    } catch (e) {
      if (cache.body) return res.json({ ...cache.body, stale: true });
      res.status(502).json({ error: "Headlines unavailable: " + String(e.message || e) });
    }
  });
};
module.exports.parseFeed = parseFeed;
