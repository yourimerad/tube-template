// SimAds report page: projection calculator (asks /simads/projection, the same rate table as the auction).
(() => {
  'use strict';
  const form = document.getElementById('sa-proj');
  const out = document.getElementById('sa-proj-out');
  if (!form || !out) return;
  const usd = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  async function compute() {
    const qs = new URLSearchParams(new FormData(form));
    let r;
    try { r = await (await fetch(`/simads/projection?${qs}`, { cache: 'no-store' })).json(); } catch (_) { out.textContent = 'projection failed'; return; }
    const head = el('p');
    head.append(el('span', 'sa-big', `${usd(r.revenue_day)} / day`), document.createTextNode(` · ${usd(r.revenue_month)} / month · RPM ${usd(r.rpm_pageviews)} per 1,000 pageviews (${r.pageviews.toLocaleString('en-US')} pageviews / day)`));
    const table = el('table', 'sa-table');
    const thead = el('tr');
    ['format', 'impressions / day', 'eCPM', 'revenue / day'].forEach(h => thead.append(el('th', '', h)));
    table.append(thead);
    for (const [f, v] of Object.entries(r.formats)) {
      const tr = el('tr');
      tr.append(el('th', '', f), el('td', '', v.impressions.toLocaleString('en-US')), el('td', '', usd(v.ecpm)), el('td', '', usd(v.revenue_day)));
      table.append(tr);
    }
    out.replaceChildren(head, table);
    out.dataset.day = String(r.revenue_day);
  }
  form.addEventListener('submit', e => { e.preventDefault(); compute(); });
  form.addEventListener('change', compute);
  compute();
})();
