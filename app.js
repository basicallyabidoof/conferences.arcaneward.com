/* Conference Tracker: joins my submissions with the Chicago Speakers Guild list. */
(() => {
  'use strict';

  const UPSTREAM = 'https://raw.githubusercontent.com/also-here/Conferences/main/README.md';
  const DAY = 864e5;
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MON_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ?today=2026-11-18 overrides the clock (handy for checking the rankings).
  const qsToday = new URLSearchParams(location.search).get('today');
  const TODAY = startOfDay(qsToday ? new Date(qsToday + 'T00:00:00') : new Date());

  // Spreadsheet names and guild-list names that refer to the same event.
  const ALIAS = {
    secretcon4: 'secretcon', hackcon26: 'hackcon', uybhys25: 'uybhys', uybhys26: 'uybhys',
    cyphercon9: 'cyphercon', blackhatusa: 'blackhat', theozcon: 'ozcon', avtoyko: 'avtokyo',
    nullconberlin: 'nullcon', romhackcamp: 'romhack', bsidestallin: 'bsidestallinn',
  };

  const OUTCOMES = [
    { key: 'Accepted', label: 'Accepted', cls: 'acc' },
    { key: 'Submitted', label: 'Pending', cls: 'pend' },
    { key: 'No Response', label: 'No response', cls: 'none' },
    { key: 'Denied', label: 'Denied', cls: 'den' },
  ];
  const outcomeOf = s => (s === 'Retracted' ? 'No Response' : OUTCOMES.some(o => o.key === s) ? s : 'Denied');

  /* ---------- small utils ---------- */
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  const iso = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  const parseISO = s => (s ? new Date(s + 'T00:00:00') : null);
  const days = (a, b) => Math.round((b - a) / DAY);
  const addYears = (d, n) => { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; };
  const fmt = (d, withYear = true) => d ? `${d.getDate()} ${MON_LABEL[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}` : '—';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = sel => document.querySelector(sel);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  function confKey(name) {
    let s = String(name || '').toLowerCase().replace(/[’']/g, '');
    s = s.replace(/\b20\d\d\b/g, '').trim().replace(/\s+\d{1,2}$/, '');
    s = s.replace(/[^a-z0-9]/g, '');
    return ALIAS[s] || s;
  }

  /* ---------- parsing the guild README ---------- */
  function monthIn(s) {
    const m = s.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/);
    return m ? MON.indexOf(m[1]) : null;
  }
  function yearIn(s) { const m = s.match(/\b(20\d\d)\b/g); return m ? +m[m.length - 1] : null; }
  const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();

  // "6-7 Feb, 2027" | "30 Sep - 1 Oct 2026" | "Feb, 2027" | "2027"
  function parseConDate(raw) {
    const s = raw.replace(/[*?]/g, ' ');
    const y = yearIn(s);
    if (!y) return null;
    const noYear = s.replace(/\b20\d\d\b/g, ' ');
    const months = [...noYear.toLowerCase().matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/g)].map(m => MON.indexOf(m[1]));
    const nums = [...noYear.matchAll(/\b(\d{1,2})\b/g)].map(m => +m[1]);
    if (!months.length) return { start: new Date(y, 0, 1), end: new Date(y, 11, 31), vague: true };
    const sm = months[0], em = months[months.length - 1];
    const start = new Date(y, sm, nums[0] || 1);
    const end = new Date(y, em, nums.length ? nums[nums.length - 1] : lastDay(y, em));
    return { start, end, vague: !nums.length };
  }

  function parseSide(t) {
    t = t.trim();
    if (!t || /^\?+$|tba/i.test(t)) return null;
    const month = monthIn(t);
    const year = yearIn(t);
    const dm = t.replace(/\b20\d\d\b/g, '').match(/\b(\d{1,2})\b/);
    if (month === null && !dm) return null;
    return { day: dm ? +dm[1] : null, month, year };
  }

  // Latest date with that month/day on or before `anchor` (and within a year of it).
  function placeBefore(side, anchor, isEnd) {
    const day = d => side.day || (isEnd ? lastDay(d, side.month) : 1);
    let y = anchor.getFullYear();
    let d = new Date(y, side.month, Math.min(day(y), lastDay(y, side.month)));
    if (d > anchor) { y -= 1; d = new Date(y, side.month, Math.min(day(y), lastDay(y, side.month))); }
    return d;
  }

  // "14 Oct - 13 Nov, 2026" | "- 15 Dec, 2026" | "Oct - Dec" | "Sep, 2026 - ?" | "1-30 Apr"
  function parseCfp(raw, con) {
    const s = raw.replace(/[*]/g, '').replace(/\?(?=\s*[a-z0-9])/gi, '').trim();
    const parts = s.split('-');
    let a = parseSide(parts.length > 1 ? parts[0] : '');
    let b = parseSide(parts.length > 1 ? parts.slice(1).join('-') : parts[0]);
    if (a && a.month === null && b && b.month !== null) { a.month = b.month; a.year = a.year || b.year; }
    if (b && b.month === null) b = null;
    if (a && a.month === null) a = null;
    const anchor = con ? con.start : TODAY;
    let end = null, start = null;
    if (b) {
      end = b.year ? new Date(b.year, b.month, b.day || lastDay(b.year, b.month)) : placeBefore(b, anchor, true);
    }
    if (a) {
      if (a.year) start = new Date(a.year, a.month, a.day || 1);
      else start = placeBefore(a, end || anchor, false);
    }
    if (!start && !end) return null;
    return { start, end };
  }

  function parseGuild(md) {
    const confs = [];
    let section = '';
    for (const line of md.split('\n')) {
      const h = line.match(/^###\s+(.*)/);
      if (h) { section = /retired/i.test(h[1]) ? 'retired' : /midwest/i.test(h[1]) ? 'midwest' : 'travel'; continue; }
      if (!line.startsWith('|') || /^\|\s*-+/.test(line) || /^\|\s*Name\s*\|/i.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length < 5) continue;
      const [nameCell, dateCell, loc, cfpCell, travel, note = ''] = cells;
      const starred = nameCell.includes(':star:');
      const link = nameCell.match(/\[([^\]]+)\]\(([^)]+)\)/);
      const name = (link ? link[1] : nameCell).replace(/:star:/g, '').trim();
      const con = parseConDate(dateCell);
      confs.push({
        name, url: link ? link[2] : '', starred, section, location: loc,
        dateRaw: dateCell, cfpRaw: cfpCell, travel: travel.trim(),
        note: note.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'),
        con, cfp: parseCfp(cfpCell, con), key: confKey(name),
      });
    }
    return confs;
  }

  /* ---------- projecting forward & CFP status ---------- */
  // If the listed edition already happened, assume next year's lands at the same time.
  function project(c) {
    const out = { ...c, estimated: false, cfpEstimated: false };
    if (!c.con || c.section === 'retired') return out;
    let shift = 0;
    while (addYears(c.con.end, shift) < TODAY && shift < 3) shift++;
    if (shift) out.estimated = true;
    out.con = { ...c.con, start: addYears(c.con.start, shift), end: addYears(c.con.end, shift) };
    if (c.cfp) {
      // A CFP window more than a year before the edition is last cycle's: roll it forward too.
      let cs = 0;
      const ref = c.cfp.end || c.cfp.start;
      while (addYears(ref, cs) < addYears(out.con.start, -1) && cs < 4) cs++;
      out.cfp = { start: c.cfp.start && addYears(c.cfp.start, cs), end: c.cfp.end && addYears(c.cfp.end, cs) };
      out.cfpEstimated = cs > 0;
    }
    if (out.cfp && out.cfp.end) {
      // No listed start: assume a ~3 month window. Rolled-forward windows longer than
      // ~6 months are usually multi-cycle listings, so trim those the same way.
      const tooLong = out.cfpEstimated && out.cfp.start && days(out.cfp.start, out.cfp.end) > 180;
      if (!out.cfp.start || tooLong) out.cfp = { start: new Date(out.cfp.end - 90 * DAY), end: out.cfp.end, startGuessed: true };
    }
    return out;
  }

  function cfpStatus(c) {
    const w = c.cfp;
    if (!w) return { state: 'unknown', text: 'CFP dates unknown' };
    if (w.end && w.end < TODAY) return { state: 'closed', text: `Closed ${fmt(w.end)}` };
    if (w.start && w.start > TODAY) {
      const n = days(TODAY, w.start);
      return { state: 'upcoming', text: `Opens in ${n} day${n === 1 ? '' : 's'}`, opensIn: n };
    }
    if (w.end) {
      const n = days(TODAY, w.end);
      return { state: 'open', text: n === 0 ? 'Closes today' : `Closes in ${n} day${n === 1 ? '' : 's'}`, closesIn: n };
    }
    if (c.con && c.con.start > TODAY) return { state: 'open', text: 'Open, no close date listed', closesIn: null };
    return { state: 'unknown', text: 'CFP dates unknown' };
  }

  /* ---------- talk stats ---------- */
  function talkStats(subs) {
    const map = new Map();
    for (const s of subs) {
      const t = map.get(s.talk) || { talk: s.talk, n: 0, Accepted: 0, Denied: 0, 'No Response': 0, Submitted: 0, last: null };
      t.n++; t[outcomeOf(s.status)]++;
      const d = parseISO(s.submitted) || parseISO(s.con_date);
      if (d && (!t.last || d > t.last)) t.last = d;
      map.set(s.talk, t);
    }
    for (const t of map.values()) {
      const decided = t.Accepted + t.Denied;
      t.rate = decided ? t.Accepted / decided : null;
      t.smoothed = (t.Accepted + 1) / (decided + 4); // shrink small samples toward ~25%
    }
    return [...map.values()].sort((a, b) => b.n - a.n);
  }

  /* ---------- scoring ---------- */
  function buildRecs(confs, subsByKey, talks) {
    // Talks I'm actively shopping: sent 3+ times, most recently within the last year.
    const recentTalks = talks.filter(t => t.n >= 3 && t.last && days(t.last, TODAY) < 365 && t.talk !== '(untitled)');
    const recs = [];
    for (const c of confs) {
      if (c.section === 'retired' || !c.con) continue;
      const st = cfpStatus(c);
      if (st.state === 'closed' || st.state === 'unknown') continue;
      if (st.state === 'upcoming' && st.opensIn > 90) continue;
      const hist = subsByKey.get(c.key) || [];
      // Already have something in for this edition?
      const thisCycle = hist.filter(s => {
        const cd = parseISO(s.con_date);
        return s.status === 'Submitted' || (cd && Math.abs(days(cd, c.con.start)) < 75);
      });
      if (thisCycle.length) continue;

      let score = 0; const why = [];
      if (st.state === 'open') {
        score += 40;
        if (st.closesIn !== null && st.closesIn <= 21) { score += 15; why.push({ t: 'Closing soon', gold: true }); }
        else if (st.closesIn !== null && st.closesIn <= 45) score += 8;
      } else {
        score += Math.max(10, 28 - st.opensIn / 4);
      }
      const tv = c.travel.toLowerCase();
      if (/^yes$/.test(tv)) { score += 15; why.push({ t: 'Covers travel', gold: true }); }
      else if (/^yes/.test(tv)) { score += 10; why.push({ t: 'Some travel help' }); }
      else if (/^no\*/.test(tv)) { score += 4; why.push({ t: 'Speaker perks' }); }
      if (c.section === 'midwest') { score += 12; why.push({ t: 'Midwest' }); }
      if (c.starred) { score += 6; why.push({ t: 'Guild: active CFP' }); }
      const acc = hist.filter(s => s.status === 'Accepted').length;
      const den = hist.filter(s => s.status === 'Denied').length;
      if (acc) { score += 18; why.push({ t: `Accepted here before (${acc}×)`, gold: true }); }
      else if (den) { score -= Math.min(12, den * 3); why.push({ t: `${den} past denial${den > 1 ? 's' : ''}` }); }
      else if (!hist.length) { score += 4; why.push({ t: 'New to me' }); }
      if (c.cfpEstimated || c.estimated) { score -= 5; }

      const triedHere = new Set(hist.map(s => s.talk));
      const suggest = recentTalks
        .filter(t => !triedHere.has(t.talk))
        .sort((a, b) => b.smoothed - a.smoothed || b.last - a.last)
        .slice(0, 2);
      recs.push({ c, st, score: Math.round(score), why, hist, acc, den, suggest });
    }
    return recs.sort((a, b) => b.score - a.score);
  }

  /* ---------- tooltip ---------- */
  const tip = $('#tip');
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  function bindTips(root) {
    root.querySelectorAll('[data-tip]').forEach(el => {
      el.addEventListener('mousemove', e => showTip(el.dataset.tip, e));
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('focus', () => { const b = el.getBoundingClientRect(); showTip(el.dataset.tip, { clientX: b.right, clientY: b.top }); });
      el.addEventListener('blur', hideTip);
    });
  }
  const tipRows = (title, rows) => `<b>${esc(title)}</b>` + rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');

  /* ---------- renderers ---------- */
  function renderKpis(subs, recs) {
    const acc = subs.filter(s => s.status === 'Accepted').length;
    const decided = subs.filter(s => s.status === 'Accepted' || s.status === 'Denied').length;
    const pending = subs.filter(s => s.status === 'Submitted').length;
    const spoken = new Set(subs.filter(s => s.status === 'Accepted').map(s => confKey(s.conference))).size;
    const yr = TODAY.getFullYear();
    const thisYear = subs.filter(s => (s.submitted || '').startsWith(String(yr)));
    const openNow = recs.filter(r => r.st.state === 'open').length;
    const k = [
      ['Submissions', subs.length, `${thisYear.length} in ${yr}`],
      ['Accepted', acc, `${Math.round(acc / decided * 100)}% of decided`],
      ['Conferences spoken at', spoken, 'unique events'],
      ['Awaiting reply', pending, 'marked Submitted'],
      ['CFPs to hit now', openNow, 'open, not yet applied'],
    ];
    $('#kpis').innerHTML = k.map(([l, v, n]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="note">${n}</div></div>`).join('');
  }

  function renderGantt(recs) {
    const el = $('#gantt');
    const rows = recs.filter(r => r.c.cfp).slice(0, 14);
    if (!rows.length) { el.innerHTML = '<p class="empty">Nothing open or opening in the next 90 days.</p>'; return; }
    const x0 = new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 1);
    const x1 = new Date(TODAY.getFullYear(), TODAY.getMonth() + 6, 1);
    const W = Math.max(320, el.clientWidth || 800);
    const narrow = W < 560;
    const L = narrow ? 104 : 150, R = 8, T = 22, rowH = 26;
    const H = T + rows.length * rowH + 4;
    const sx = d => L + (Math.max(x0, Math.min(x1, d)) - x0) / (x1 - x0) * (W - L - R);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="CFP windows for recommended conferences"><defs>
      <pattern id="est" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
      <rect width="3" height="6" fill="var(--s-acc)"/></pattern></defs>`;
    for (let m = new Date(x0); m <= x1; m.setMonth(m.getMonth() + 1)) {
      const x = sx(m);
      svg += `<line class="grid" x1="${x}" x2="${x}" y1="${T - 6}" y2="${H}"/>`;
      if (m < x1) svg += `<text class="axis-label" x="${x + 4}" y="12">${MON_LABEL[m.getMonth()]}${m.getMonth() === 0 ? ' ' + m.getFullYear() : ''}</text>`;
    }
    rows.forEach((r, i) => {
      const y = T + i * rowH;
      const w = r.c.cfp;
      const s = w.start || x0, e = w.end || x1;
      const xa = sx(s), xb = Math.max(sx(e), xa + 4);
      const est = r.c.cfpEstimated;
      const name = narrow && r.c.name.length > 14 ? r.c.name.slice(0, 13) + '…' : r.c.name;
      const t = tipRows(r.c.name, [
        ['CFP', `${w.start ? fmt(w.start) : '?'} → ${w.end ? fmt(w.end) : '?'}`],
        ['Status', r.st.text], ['Conference', fmt(r.c.con.start)], ['Score', r.score],
      ].concat(est ? [['Dates', 'estimated from last year']] : []));
      svg += `<text class="row-label" x="${L - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(name)}</text>`;
      svg += `<g tabindex="0" data-tip="${esc(t)}"><rect class="hit" x="${L}" y="${y}" width="${W - L - R}" height="${rowH}"/>`;
      svg += `<rect class="mark" x="${xa}" y="${y + 6}" width="${xb - xa}" height="${rowH - 12}" rx="4" fill="${est ? 'url(#est)' : 'var(--s-acc)'}" ${est ? 'stroke="var(--s-acc)" stroke-width="1"' : ''}/></g>`;
    });
    const tx = sx(TODAY);
    svg += `<line x1="${tx}" x2="${tx}" y1="${T - 6}" y2="${H}" stroke="var(--today)" stroke-width="2"/>`;
    el.innerHTML = svg + '</svg>';
    bindTips(el);
  }

  function renderRecs(allRecs) {
    const onlyTravel = $('#fTravel').checked, onlyMw = $('#fMidwest').checked, onlyOpen = $('#fOpen').checked;
    const recs = allRecs.filter(r =>
      (!onlyTravel || /^yes/i.test(r.c.travel)) && (!onlyMw || r.c.section === 'midwest') && (!onlyOpen || r.st.state === 'open'));
    renderGantt(recs);
    if (!recs.length) { $('#recs').innerHTML = '<p class="empty">No conferences match these filters right now.</p>'; return; }
    const shown = showAllRecs ? recs : recs.slice(0, 12);
    $('#recs').innerHTML = shown.map(r => {
      const c = r.c;
      const soon = r.st.state === 'open' && r.st.closesIn !== null && r.st.closesIn <= 21;
      const hist = r.hist.length ? `${r.hist.length} past submission${r.hist.length > 1 ? 's' : ''}, ${r.acc} accepted` : 'Never submitted';
      return `<article class="card">
        <div class="card-top">
          <h3>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</h3>
          <span class="score" title="Recommendation score">${r.score}</span>
        </div>
        <div class="meta">${esc(c.location)} · ${fmt(c.con.start)}${c.estimated ? ' (est.)' : ''} · Travel: ${esc(c.travel || '?')}</div>
        <div class="deadline ${soon ? 'soon' : ''}">${esc(r.st.text)}${r.c.cfpEstimated ? ' (est.)' : ''}
          <span class="note">· CFP ${r.c.cfp.start ? (r.c.cfp.startGuessed ? '~' : '') + fmt(r.c.cfp.start, false) : '?'} – ${r.c.cfp.end ? fmt(r.c.cfp.end) : '?'}</span></div>
        <div class="chips">${r.why.map(w => `<span class="chip ${w.gold ? 'gold' : ''}">${esc(w.t)}</span>`).join('')}</div>
        ${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}
        <div class="suggest"><b>Pitch</b>
          <ul>${r.suggest.map(t => `<li>${esc(t.talk)} <span class="note">${t.Accepted}/${t.Accepted + t.Denied} accepted</span></li>`).join('') || '<li class="note">Every recent talk has been tried here</li>'}</ul>
          <div class="note">${hist}</div>
        </div>
      </article>`;
    }).join('') + (recs.length > 12
      ? `<button type="button" class="link-btn more" id="moreRecs">${showAllRecs ? 'Show top 12 only' : `Show all ${recs.length}`}</button>` : '');
    const more = $('#moreRecs');
    if (more) more.addEventListener('click', () => { showAllRecs = !showAllRecs; renderRecs(allRecs); });
  }
  let showAllRecs = false;

  function renderPending(subs) {
    const rows = subs.filter(s => {
      const cd = parseISO(s.con_date);
      return (s.status === 'Submitted' || s.status === 'No Response') && (!cd || cd >= TODAY);
    }).sort((a, b) => (a.expected_reply || '9') < (b.expected_reply || '9') ? -1 : 1);
    if (!rows.length) { $('#pendingList').innerHTML = '<p class="empty">Nothing outstanding.</p>'; return; }
    $('#pendingList').innerHTML = `<table><thead><tr><th>Conference</th><th>Talk</th><th>Submitted</th><th>Reply expected</th><th>Conference date</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${
      rows.map(s => {
        const er = parseISO(s.expected_reply);
        const d = er ? days(TODAY, er) : null;
        const when = er ? (d < 0 ? `<span class="overdue">${-d} days overdue</span>` : d === 0 ? 'Today' : `in ${d} days`) : '—';
        return `<tr><td>${esc(s.conference)}${entryBadge(s)}</td><td>${esc(s.talk_raw || s.talk)}</td><td class="nowrap">${fmt(parseISO(s.submitted))}</td>
          <td class="nowrap">${er ? fmt(er) + ' · ' : ''}${when}</td><td class="nowrap">${fmt(parseISO(s.con_date))}</td>
          <td class="nowrap">${updateBtn(s)}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  // Small markers for rows that came from the add form.
  function entryBadge(x) {
    if (x._draft) return ' <span class="badge draft" title="Saved in this browser. It goes live for everyone once you commit it on GitHub.">not committed</span>';
    if (x._edit) return ` <a class="badge" href="${esc(x._edit)}" target="_blank" rel="noopener" title="Edit this entry on GitHub">edit</a>`;
    return '';
  }
  const updateBtn = s => `<button type="button" class="mini-btn" data-update="${esc(s._id)}">Update</button>`;

  function sortableTable(container, cols, rows, initial) {
    let sortKey = initial.key, dir = initial.dir;
    function draw() {
      const col = cols.find(c => c.key === sortKey);
      const sorted = [...rows].sort((a, b) => {
        const va = col.sort ? col.sort(a) : a[sortKey], vb = col.sort ? col.sort(b) : b[sortKey];
        if (va == null || va === '') return 1; if (vb == null || vb === '') return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
      });
      container.innerHTML = `<div class="scroll-y"><table><thead><tr>${cols.map(c =>
        `<th ${c.sortable === false ? '' : `data-sort="${c.key}"`} class="${c.num ? 'num' : ''} ${c.key === sortKey ? (dir > 0 ? 'asc' : 'desc') : ''}" scope="col">${c.label}</th>`).join('')}</tr></thead>
        <tbody>${sorted.map(r => `<tr>${cols.map(c => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      container.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
        if (sortKey === th.dataset.sort) dir = -dir; else { sortKey = th.dataset.sort; dir = 1; }
        draw();
      }));
      if (initial.after) initial.after(container);
    }
    draw();
  }

  function renderFollowing(model) {
    const { confByKey, subsByKey, followed, view, query } = model;
    const keys = new Set([...subsByKey.keys(), ...confByKey.keys()]);
    const rows = [];
    for (const k of keys) {
      const c = confByKey.get(k);
      const hist = subsByKey.get(k) || [];
      const isFollowed = hist.length > 0 || followed.has(k) || !!(c && c.entry);
      if (view === 'following' && !isFollowed) continue;
      if (c && c.section === 'retired' && !hist.length) continue;
      const name = c ? c.name : mostCommon(hist.map(h => h.conference));
      const loc = c ? c.location : mostCommon(hist.map(h => h.location).filter(Boolean));
      if (query && !(name + ' ' + loc).toLowerCase().includes(query)) continue;
      let next = c && c.con ? c.con.start : null, est = c ? c.estimated : false;
      if (!c) {
        const last = hist.map(h => parseISO(h.con_date)).filter(Boolean).sort((a, b) => b - a)[0];
        if (last) { next = last; est = false; while (next < TODAY) { next = addYears(next, 1); est = true; } }
      }
      const st = c ? (c.section === 'retired' ? { state: 'closed', text: 'Retired' } : cfpStatus(c)) : { state: 'unknown', text: 'Not in guild list' };
      const months = hist.map(h => parseISO(h.submitted)).filter(Boolean).map(d => d.getMonth());
      rows.push({
        key: k, name, url: c ? c.url : '', loc, next, est, st, travel: c ? c.travel : '', entry: c && c.entry,
        n: hist.length, acc: hist.filter(h => h.status === 'Accepted').length,
        usual: months.length ? MON_LABEL[+mostCommon(months)] : '',
        auto: hist.length > 0 || !!(c && c.entry), star: followed.has(k),
      });
    }
    const order = { open: 0, upcoming: 1, unknown: 2, closed: 3 };
    sortableTable($('#followTable'), [
      { key: 'star', label: '<span class="sr">Follow</span>', sortable: false, render: r =>
        `<button class="star ${r.star || r.auto ? 'on' : ''}" data-k="${esc(r.key)}" ${r.auto ? 'disabled title="Followed because you have submitted here or added it"' : `aria-pressed="${r.star}" title="${r.star ? 'Unfollow' : 'Follow'}"`}>${r.star || r.auto ? '★' : '☆'}</button>` },
      { key: 'name', label: 'Conference', sort: r => r.name.toLowerCase(), render: r => (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)) + (r.entry ? entryBadge(r.entry) : '') },
      { key: 'loc', label: 'Location' },
      { key: 'next', label: 'Next edition', cls: 'nowrap', render: r => r.next ? fmt(r.next) + (r.est ? ' <span class="note">est.</span>' : '') : '—' },
      { key: 'st', label: 'CFP', sort: r => order[r.st.state] * 1000 + (r.st.closesIn ?? r.st.opensIn ?? 999), render: r => `<span class="cfp ${r.st.state}">${esc(r.st.text)}</span>` },
      { key: 'travel', label: 'Travel' },
      { key: 'n', label: 'Submitted', num: true },
      { key: 'acc', label: 'Accepted', num: true },
      { key: 'usual', label: 'I usually apply', sort: r => r.usual ? MON_LABEL.indexOf(r.usual) : null },
    ], rows, { key: 'st', dir: 1, after: el => el.querySelectorAll('.star:not([disabled])').forEach(b => b.addEventListener('click', () => model.toggle(b.dataset.k))) });
  }

  function mostCommon(arr) {
    const m = new Map(); let best = arr[0], bc = 0;
    for (const v of arr) { const n = (m.get(v) || 0) + 1; m.set(v, n); if (n > bc) { bc = n; best = v; } }
    return best ?? '';
  }

  function outcomeLegend() {
    document.querySelectorAll('.outcome-legend').forEach(l => {
      l.innerHTML = OUTCOMES.map(o => `<span class="lg"><i class="sw sw-${o.cls}"></i>${o.label}</span>`).join('');
    });
  }

  function renderQuarterChart(subs) {
    const el = $('#quarterChart');
    const q = new Map();
    for (const s of subs) {
      const d = parseISO(s.submitted) || parseISO(s.con_date);
      if (!d || d > TODAY) continue;
      const k = `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`;
      const b = q.get(k) || { k, Accepted: 0, Denied: 0, 'No Response': 0, Submitted: 0, n: 0 };
      b[outcomeOf(s.status)]++; b.n++; q.set(k, b);
    }
    const bins = [...q.values()].sort((a, b) => a.k < b.k ? -1 : 1);
    const W = Math.max(300, el.clientWidth || 520), H = 240, L = 30, R = 6, T = 10, B = 34;
    const max = Math.ceil(Math.max(...bins.map(b => b.n)) / 10) * 10 || 10;
    const bw = (W - L - R) / bins.length;
    const sy = v => T + (H - T - B) * (1 - v / max);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Submissions per quarter by outcome">`;
    const step = max <= 40 ? 10 : 20;
    for (let v = 0; v <= max; v += step) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="axis-label" x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`;
    bins.forEach((b, i) => {
      const x = L + i * bw + bw * 0.18, w = bw * 0.64;
      let acc = 0;
      const parts = OUTCOMES.filter(o => b[o.key]).map(o => {
        const y1 = sy(acc), y2 = sy(acc + b[o.key]); acc += b[o.key];
        return { o, y: y2, h: y1 - y2 };
      });
      svg += `<g tabindex="0" data-tip="${esc(tipRows(b.k, OUTCOMES.filter(o => b[o.key]).map(o => [o.label, b[o.key]]).concat([['Total', b.n]])))}">`;
      svg += `<rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}"/>`;
      parts.forEach((p, j) => {
        const top = j === parts.length - 1;
        const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked segments
        const h = Math.max(0, p.h - gap);
        svg += top
          ? `<path class="mark" fill="var(--s-${p.o.cls})" d="${roundTop(x, p.y, w, h, Math.min(4, h))}"/>`
          : `<rect class="mark" fill="var(--s-${p.o.cls})" x="${x}" y="${p.y}" width="${w}" height="${h}"/>`;
      });
      svg += '</g>';
      const [yy, qq] = b.k.split(' ');
      svg += `<text class="axis-label" x="${x + w / 2}" y="${H - B + 15}" text-anchor="middle">${qq}</text>`;
      if (qq === 'Q1' || i === 0) svg += `<text class="axis-label" x="${x + w / 2}" y="${H - B + 29}" text-anchor="middle">${yy}</text>`;
    });
    el.innerHTML = svg + '</svg>';
    bindTips(el);
  }

  function roundTop(x, y, w, h, r) {
    if (h <= 0) return '';
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function renderTalkChart(talks) {
    const el = $('#talkChart');
    const rows = talks.filter(t => t.n >= 2 && t.talk !== '(untitled)');
    const W = Math.max(300, el.clientWidth || 520);
    const narrow = W < 480;
    const L = narrow ? 120 : 200, R = 34, rowH = 22, T = 4;
    const H = T + rows.length * rowH + 4;
    const max = Math.max(...rows.map(t => t.n));
    const sx = v => (W - L - R) * v / max;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Outcome by talk">`;
    rows.forEach((t, i) => {
      const y = T + i * rowH;
      const label = shortTalk(t.talk);
      const short = label.length > (narrow ? 20 : 30) ? label.slice(0, narrow ? 19 : 29) + '…' : label;
      svg += `<text class="row-label" x="${L - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(short)}</text>`;
      svg += `<g tabindex="0" data-tip="${esc(tipRows(t.talk, OUTCOMES.filter(o => t[o.key]).map(o => [o.label, t[o.key]]).concat([['Acceptance', t.rate == null ? '—' : Math.round(t.rate * 100) + '%']])))}">`;
      svg += `<rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}"/>`;
      let x = L;
      const parts = OUTCOMES.filter(o => t[o.key]);
      parts.forEach((o, j) => {
        const w = Math.max(1, sx(t[o.key]) - (j < parts.length - 1 ? 2 : 0));
        const last = j === parts.length - 1;
        svg += last
          ? `<path class="mark" fill="var(--s-${o.cls})" d="${roundRight(x, y + 5, w, rowH - 10, Math.min(4, w))}"/>`
          : `<rect class="mark" fill="var(--s-${o.cls})" x="${x}" y="${y + 5}" width="${w}" height="${rowH - 10}"/>`;
        x += w + 2;
      });
      svg += `</g><text x="${L + sx(t.n) + 6}" y="${y + rowH / 2 + 4}">${t.Accepted}/${t.n}</text>`;
    });
    el.innerHTML = svg + '</svg>';
    bindTips(el);
  }
  function shortTalk(t) {
    return t.replace(/^The Risky Business of (\w+) Illiteracy.*/, '$1 Illiteracy (Risky Business)')
      .replace(/^Bridging the Gap:.*/, 'Bridging the Gap')
      .replace(/^When IaC Goes Wrong.*/, 'When IaC Goes Wrong')
      .replace(/^Going Beyond Box Checking.*/, 'Beyond Box Checking')
      .replace(/^Hacking Other Teams.*/, 'Hacking Other Teams')
      .replace(/^4 Steps, Repeat.*/, '4 Steps, Repeat')
      .replace(/^The Community of Language.*/, 'Community of Language');
  }
  function roundRight(x, y, w, h, r) {
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }

  function renderTalksTable(talks) {
    sortableTable($('#talksTable'), [
      { key: 'talk', label: 'Talk' },
      { key: 'n', label: 'Submitted', num: true },
      { key: 'Accepted', label: 'Accepted', num: true },
      { key: 'Denied', label: 'Denied', num: true },
      { key: 'No Response', label: 'No response', num: true },
      { key: 'Submitted', label: 'Pending', num: true },
      { key: 'rate', label: 'Acceptance', num: true, render: t => t.rate == null ? '—' : Math.round(t.rate * 100) + '%' },
      { key: 'last', label: 'Last sent', render: t => fmt(t.last) },
    ], talks, { key: 'n', dir: -1 });
  }

  function renderLog(subs) {
    const st = $('#logStatus').value, tk = $('#logTalk').value, q = $('#logSearch').value.trim().toLowerCase();
    const rows = subs.filter(s => (!st || s.status === st) && (!tk || s.talk === tk) &&
      (!q || `${s.conference} ${s.talk_raw} ${s.location}`.toLowerCase().includes(q)));
    $('#logCount').textContent = `${rows.length} of ${subs.length} submissions`;
    sortableTable($('#logTable'), [
      { key: 'submitted', label: 'Submitted', cls: 'nowrap', render: s => fmt(parseISO(s.submitted)) },
      { key: 'conference', label: 'Conference', sort: s => s.conference.toLowerCase(), render: s => esc(s.conference) + entryBadge(s) },
      { key: 'talk_raw', label: 'Talk', sort: s => s.talk.toLowerCase() },
      { key: 'length', label: 'Min', num: true, sort: s => parseFloat(s.length) || null },
      { key: 'status', label: 'Response', render: s => `<span class="status ${esc(s.status)}">${esc(s.status)}</span>` },
      { key: 'location', label: 'Location' },
      { key: 'con_date', label: 'Conference', cls: 'nowrap', render: s => fmt(parseISO(s.con_date)) || esc(s.con_date_raw) },
      { key: '_act', label: '<span class="sr">Actions</span>', sortable: false, render: updateBtn },
    ], rows, { key: 'submitted', dir: -1 });
  }

  /* ---------- entries added through the form ---------- */
  // New talks and tracked conferences live as one JSON file each in data/entries/.
  // The form opens GitHub's "new file" page pre-filled, so a commit is the save button
  // and nothing on this public page ever needs a token.
  const REPO = 'basicallyabidoof/conferences.arcaneward.com';
  const BRANCH = 'main';
  const ENTRY_DIR = 'data/entries';
  const STATUSES = ['Submitted', 'Accepted', 'Denied', 'No Response', 'Retracted'];

  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const subKey = s => `${confKey(s.conference)}|${norm(s.talk_raw || s.talk)}|${s.submitted || ''}`;
  const slug = t => String(t || 'entry').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'entry';

  async function loadEntries() {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${ENTRY_DIR}?ref=${BRANCH}`,
        { headers: { Accept: 'application/vnd.github+json' } });
      if (r.status === 404) return { files: [], ok: true };
      if (!r.ok) throw new Error(`GitHub API ${r.status}`);
      const list = (await r.json()).filter(f => f.type === 'file' && f.name.endsWith('.json'));
      const files = await Promise.all(list.map(async f => {
        try {
          const e = await (await fetch(f.download_url, { cache: 'no-cache' })).json();
          return { ...e, _file: f.name, _edit: `https://github.com/${REPO}/edit/${BRANCH}/${ENTRY_DIR}/${f.name}` };
        } catch (err) { console.warn('Skipping unreadable entry', f.name, err); return null; }
      }));
      return { files: files.filter(Boolean), ok: true };
    } catch (err) {
      console.warn('Could not list entries', err);
      return { files: [], ok: false };
    }
  }

  const drafts = {
    all: () => store.get('cf-drafts', []),
    add(e) { store.set('cf-drafts', [...this.all().filter(d => d._file !== e._file), e]); },
    remove(file) { store.set('cf-drafts', this.all().filter(d => d._file !== file)); },
    prune(committed) { const have = new Set(committed.map(f => f._file)); store.set('cf-drafts', this.all().filter(d => !have.has(d._file))); },
  };

  function githubNewFileUrl(file, entry, message) {
    const body = JSON.stringify(stripMeta(entry), null, 2) + '\n';
    return `https://github.com/${REPO}/new/${BRANCH}/${ENTRY_DIR}?filename=${encodeURIComponent(file)}` +
      `&value=${encodeURIComponent(body)}&message=${encodeURIComponent(message)}`;
  }
  const stripMeta = e => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith('_')));

  // Spreadsheet rows + entry rows. An entry with `replaces` supersedes the row it updates.
  function mergeSubmissions(base, entries) {
    const canon = new Map();
    for (const s of base) { canon.set(norm(s.talk_raw), s.talk); canon.set(norm(s.talk), s.talk); }
    const map = new Map();
    for (const s of base) map.set(subKey(s), { ...s, _id: subKey(s) });
    for (const e of entries.filter(x => x.type === 'submission')) {
      if (e.replaces) map.delete(e.replaces);
      const row = {
        conference: e.conference || '(unnamed)', talk: canon.get(norm(e.talk)) || e.talk || '(untitled)', talk_raw: e.talk || '',
        length: e.length || '', submitted: e.submitted || null, status: e.status || 'Submitted', location: e.location || '',
        con_date: e.con_date || null, con_date_raw: '', expected_reply: e.expected_reply || null,
        _edit: e._edit, _draft: e._draft, _file: e._file,
      };
      row._id = subKey(row);
      map.set(row._id, row);
    }
    return [...map.values()];
  }

  function entryToConf(e) {
    const d = parseISO;
    return {
      name: e.name, url: e.url || '', starred: false, section: e.midwest ? 'midwest' : 'custom',
      location: e.location || '', dateRaw: '', cfpRaw: '', travel: e.travel || '?', note: e.note || '',
      con: e.con_start ? { start: d(e.con_start), end: d(e.con_end || e.con_start) } : null,
      cfp: e.cfp_open || e.cfp_close ? { start: d(e.cfp_open), end: d(e.cfp_close) } : null,
      key: confKey(e.name), entry: e,
    };
  }

  // A tracked-conference entry fills in or overrides what the guild list says.
  function mergeConfs(guildConfs, entries) {
    const byKey = new Map();
    for (const c of guildConfs) if (!byKey.has(c.key) || c.section !== 'retired') byKey.set(c.key, c);
    for (const e of entries.filter(x => x.type === 'conference' && x.name)) {
      const mine = entryToConf(e);
      const g = byKey.get(mine.key);
      if (!g) { byKey.set(mine.key, mine); continue; }
      const m = { ...g, entry: e };
      for (const f of ['url', 'location', 'note', 'con', 'cfp']) if (mine[f]) m[f] = mine[f];
      if (e.travel) m.travel = e.travel;
      if (e.midwest) m.section = 'midwest';
      if (g.section === 'retired') m.section = 'custom';
      byKey.set(mine.key, m);
    }
    return byKey;
  }

  /* ---------- state & rendering ---------- */
  const state = { base: [], generated: '', guildMd: '', guildLive: false, committed: [], entriesOk: true, followFile: [], d: null };
  const model = {
    view: 'following', query: '',
    toggle(k) {
      const mine = new Set(store.get('cf-follow', []));
      if (mine.has(k)) mine.delete(k); else mine.add(k);
      store.set('cf-follow', [...mine]);
      renderAll();
    },
  };

  function renderAll() {
    const draftList = drafts.all().map(d => ({ ...d, _draft: true }));
    const entries = [...state.committed].sort((a, b) => a._file < b._file ? -1 : 1).concat(draftList);
    const subs = mergeSubmissions(state.base, entries);
    const confByKey = mergeConfs(parseGuild(state.guildMd), entries);
    for (const [k, c] of confByKey) confByKey.set(k, project(c));
    const subsByKey = new Map();
    for (const s of subs) {
      const k = confKey(s.conference);
      if (!k || k === 'unnamed') continue;
      if (!subsByKey.has(k)) subsByKey.set(k, []);
      subsByKey.get(k).push(s);
    }
    const talks = talkStats(subs);
    const recs = buildRecs([...confByKey.values()], subsByKey, talks);
    state.d = { subs, confByKey, subsByKey, talks, recs, byId: new Map(subs.map(s => [s._id, s])) };

    const added = state.committed.length;
    $('#sourceNote').textContent = (state.guildLive
      ? 'pulled live just now.'
      : 'using the saved snapshot because the live list was unreachable.') +
      ` Spreadsheet imported ${state.generated}` + (added ? `, plus ${added} added through the form.` : '.') +
      (state.entriesOk ? '' : ' (Couldn’t reach GitHub for entries added through the form, so they may be missing.)');
    const nd = draftList.length;
    $('#draftNote').hidden = !nd;
    $('#draftNote').innerHTML = nd ? `${nd} entr${nd === 1 ? 'y isn’t' : 'ies aren’t'} committed yet. <button type="button" class="link-btn" data-open-drafts>Review</button>` : '';

    renderKpis(subs, recs);
    renderRecs(recs);
    renderPending(subs);
    Object.assign(model, { confByKey, subsByKey, followed: new Set([...state.followFile.map(confKey), ...store.get('cf-follow', [])]) });
    renderFollowing(model);
    renderQuarterChart(subs); renderTalkChart(talks); renderTalksTable(talks);
    fillSelect('#logStatus', 'All responses', [...new Set(subs.map(s => s.status))].sort());
    fillSelect('#logTalk', 'All talks', talks.map(t => t.talk));
    renderLog(subs);
    fillDatalists();
  }

  function fillSelect(sel, allLabel, values) {
    const el = $(sel), cur = el.value;
    el.innerHTML = `<option value="">${allLabel}</option>` + values.map(v => `<option>${esc(v)}</option>`).join('');
    if (values.includes(cur)) el.value = cur;
  }

  function fillDatalists() {
    const { confByKey, talks, subs } = state.d;
    const names = new Set([...confByKey.values()].filter(c => c.section !== 'retired').map(c => c.name));
    for (const s of subs) if (!confByKey.has(confKey(s.conference))) names.add(s.conference);
    $('#dlConfs').innerHTML = [...names].sort((a, b) => a.localeCompare(b)).map(n => `<option value="${esc(n)}">`).join('');
    $('#dlTalks').innerHTML = talks.filter(t => t.talk !== '(untitled)').map(t => `<option value="${esc(t.talk)}">`).join('');
  }

  /* ---------- add / update form ---------- */
  const dlg = $('#addDialog');
  const forms = { submission: $('#subForm'), conference: $('#confForm') };

  function setTab(type) {
    dlg.querySelectorAll('[data-tab]').forEach(b => { const on = b.dataset.tab === type; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    for (const [t, f] of Object.entries(forms)) f.hidden = t !== type;
    $('#draftPanel').hidden = type !== 'drafts';
    if (type === 'drafts') renderDrafts();
  }

  function openForm(type, prefill = {}, replaces = '') {
    for (const f of Object.values(forms)) f.reset();
    const f = forms[type];
    if (f) {
      // querySelector, not f.elements[k]: a field named "length" collides with elements.length.
      for (const [k, v] of Object.entries(prefill)) {
        const el = f.querySelector(`[name="${k}"]`);
        if (!el || v == null) continue;
        if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
      }
      if (type === 'submission' && !prefill.submitted) f.elements.submitted.value = iso(TODAY);
      f.elements.replaces && (f.elements.replaces.value = replaces);
      $('#subTitle').textContent = replaces ? 'Update submission' : 'Log a submission';
    }
    setTab(type);
    if (!dlg.open) dlg.showModal();
    const first = f && f.querySelector('input:not([type=hidden]), select');
    if (first) first.focus();
  }

  function formEntry(f, type) {
    const e = { type };
    for (const el of f.elements) {
      if (!el.name) continue;
      const v = el.type === 'checkbox' ? el.checked : el.value.trim();
      if (v) e[el.name] = v;
    }
    e.added = iso(new Date());
    return e;
  }

  function saveEntry(type) {
    const f = forms[type];
    if (!f.reportValidity()) return;
    const e = formEntry(f, type);
    const now = new Date();
    const stamp = iso(now).replace(/-/g, '') + '-' + [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join('');
    const who = type === 'submission' ? `${e.conference}-${e.talk || ''}` : e.name;
    const file = `${stamp}-${type === 'submission' ? 'talk' : 'conf'}-${slug(who)}.json`;
    const msg = type === 'submission'
      ? `${e.replaces ? 'Update' : 'Log'} submission: ${e.talk || 'talk'} → ${e.conference} (${e.status || 'Submitted'})`
      : `Track conference: ${e.name}`;
    const draft = { ...e, _file: file, _msg: msg };
    drafts.add(draft);
    window.open(githubNewFileUrl(file, e, msg), '_blank', 'noopener');
    dlg.close();
    renderAll();
  }

  function renderDrafts() {
    const list = drafts.all();
    $('#draftPanel').innerHTML = list.length
      ? `<p class="hint">These are saved in this browser only. Open GitHub and click <b>Commit changes</b> to publish one, or discard it.</p><ul class="draft-list">${
        list.map(d => `<li><div><b>${esc(d.type === 'submission' ? `${d.talk || 'Talk'} → ${d.conference}` : d.name)}</b>
          <span class="note">${esc(d.type === 'submission' ? d.status || 'Submitted' : 'Tracked conference')} · ${esc(d._file)}</span></div>
          <div class="draft-actions"><a class="mini-btn" href="${esc(githubNewFileUrl(d._file, d, d._msg || 'Add entry'))}" target="_blank" rel="noopener">Commit on GitHub</a>
          <button type="button" class="mini-btn" data-discard="${esc(d._file)}">Discard</button></div></li>`).join('')}</ul>`
      : '<p class="empty">No uncommitted entries.</p>';
  }

  function bindForm() {
    $('#addBtn').addEventListener('click', () => openForm('submission'));
    dlg.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => b.dataset.tab === 'drafts' ? setTab('drafts') : openForm(b.dataset.tab)));
    dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    forms.submission.elements.status.innerHTML = STATUSES.map(s => `<option>${s}</option>`).join('');
    for (const [type, f] of Object.entries(forms)) f.addEventListener('submit', e => { e.preventDefault(); saveEntry(type); });

    // Picking a known conference pre-fills where and when it is.
    forms.submission.elements.conference.addEventListener('change', e => {
      const c = state.d && state.d.confByKey.get(confKey(e.target.value));
      const f = forms.submission.elements;
      if (!c) return;
      if (!f.location.value && c.location) f.location.value = c.location;
      if (!f.con_date.value && c.con) f.con_date.value = iso(c.con.start);
      if (!f.expected_reply.value && c.cfp && c.cfp.end) f.expected_reply.value = iso(new Date(+c.cfp.end + 30 * DAY));
    });
    forms.conference.elements.name.addEventListener('change', e => {
      const c = state.d && state.d.confByKey.get(confKey(e.target.value));
      const f = forms.conference.elements;
      if (!c) return;
      const fill = (k, v) => { if (!f[k].value && v) f[k].value = v; };
      fill('url', c.url); fill('location', c.location);
      if (c.con) { fill('con_start', iso(c.con.start)); fill('con_end', iso(c.con.end)); }
      if (c.cfp) { fill('cfp_open', c.cfp.start && iso(c.cfp.start)); fill('cfp_close', c.cfp.end && iso(c.cfp.end)); }
      if (!f.travel.value && /^yes$/i.test(c.travel)) f.travel.value = 'Yes';
      else if (!f.travel.value && /^yes/i.test(c.travel)) f.travel.value = 'Partial';
      else if (!f.travel.value && /^no/i.test(c.travel)) f.travel.value = 'No';
      f.midwest.checked = f.midwest.checked || c.section === 'midwest';
    });

    document.addEventListener('click', e => {
      const up = e.target.closest('[data-update]');
      if (up) {
        const s = state.d.byId.get(up.dataset.update);
        if (s) openForm('submission', { conference: s.conference, talk: s.talk_raw || s.talk, length: s.length, submitted: s.submitted,
          status: s.status, location: s.location, con_date: s.con_date, expected_reply: s.expected_reply }, s._id);
      }
      if (e.target.closest('[data-open-drafts]')) { if (!dlg.open) dlg.showModal(); setTab('drafts'); }
      const dis = e.target.closest('[data-discard]');
      if (dis) { drafts.remove(dis.dataset.discard); renderDrafts(); renderAll(); }
      if (e.target.closest('[data-track]')) openForm('conference');
    });
  }

  /* ---------- boot ---------- */
  async function loadGuild() {
    try {
      const r = await fetch(UPSTREAM, { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      return { md: await r.text(), live: true };
    } catch (e) {
      const r = await fetch('data/also-here-README.md');
      return { md: await r.text(), live: false };
    }
  }

  async function boot() {
    const [subsRes, guild, followRes, entries] = await Promise.all([
      fetch('data/submissions.json').then(r => r.json()),
      loadGuild(),
      fetch('data/following.json').then(r => r.ok ? r.json() : []).catch(() => []),
      loadEntries(),
    ]);
    Object.assign(state, {
      base: subsRes.submissions, generated: subsRes.generated, guildMd: guild.md, guildLive: guild.live,
      committed: entries.files, entriesOk: entries.ok, followFile: followRes,
    });
    if (entries.ok) drafts.prune(entries.files);

    ['#fTravel', '#fMidwest', '#fOpen'].forEach(id => $(id).addEventListener('change', () => renderRecs(state.d.recs)));
    document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.seg button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      model.view = b.dataset.view; renderFollowing(model);
    }));
    $('#followSearch').addEventListener('input', e => { model.query = e.target.value.trim().toLowerCase(); renderFollowing(model); });
    outcomeLegend();
    $('#talksTableBtn').addEventListener('click', e => {
      const t = $('#talksTable'); t.hidden = !t.hidden;
      e.target.setAttribute('aria-expanded', !t.hidden);
      e.target.textContent = t.hidden ? 'Show as table' : 'Hide table';
    });
    ['#logStatus', '#logTalk'].forEach(id => $(id).addEventListener('change', () => renderLog(state.d.subs)));
    $('#logSearch').addEventListener('input', () => renderLog(state.d.subs));
    bindForm();
    renderAll();

    let rt; addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { renderQuarterChart(state.d.subs); renderTalkChart(state.d.talks); renderRecs(state.d.recs); }, 150);
    });
  }

  $('#themeBtn').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('cf-theme', root.dataset.theme); } catch (e) { /* ignore */ }
  });

  boot().catch(err => {
    console.error(err);
    $('#kpis').innerHTML = `<p class="empty">Couldn't load data: ${esc(err.message)}</p>`;
  });
})();
