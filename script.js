(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * 設定：兩位書架主人。改這裡就能換名字與簡介。
   * ------------------------------------------------------------------ */
  const PEOPLE = {
    queenie: { name: 'queenie', bio: '買了超多書，但很多其實都只看了一半。' },
    jnmin:   { name: 'Jnmin',   bio: '雞米花、雞蛋花' }
  };

  /* ------------------------------------------------------------------
   * 雲端資料庫（Supabase）。publishable key 本來就會公開在網頁上，
   * 真正擋住別人修改的是資料庫的權限規則（RLS）。
   * ------------------------------------------------------------------ */
  const SUPABASE_URL = 'https://nkbvquwhkvgdcpuozxek.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_LdeEccPiGPL99ZFiFO7vYg_3lzvvSdF';
  const sb = window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: 'pkce' } })
    : null;

  /* ------------------------------------------------------------------
   * 資料：存在 Supabase，瀏覽器另存一份快取，打開時先顯示快取再更新。
   * ------------------------------------------------------------------ */
  const CACHE_KEY = 'ourshelves.cache.v2';
  const LEGACY_KEY = 'ourshelves.entries.v1';  // 改用雲端前存在瀏覽器裡的資料，供匯入用
  const SAMPLE_REVIEW = '這是一則範例心得，請點「編輯」換成你自己的文字，或刪除這筆範例。';

  /* 資料庫的空值轉成畫面用的空字串 */
  const fromRow = (r) => ({
    id: r.id, owner: r.owner, type: r.type, title: r.title, creator: r.creator || '',
    date: r.date || '', rating: r.rating, cover: r.cover || '', review: r.review || '', quote: r.quote || ''
  });

  function readCache() {
    try {
      const data = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (Array.isArray(data)) return data;
    } catch (_) { /* 沒有快取就等資料庫 */ }
    return [];
  }

  function writeCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(entries)); } catch (_) { /* 隱私模式等情況略過 */ }
  }

  let entries = readCache();
  let loadState = entries.length ? 'ready' : 'loading';  // loading | ready | error

  async function refresh() {
    try {
      if (!sb) throw new Error('supabase-js 沒有載入');
      const { data, error } = await sb.from('entries').select('*').order('date', { ascending: false });
      if (error) throw error;
      const fresh = data.map(fromRow);
      const changed = loadState !== 'ready' || JSON.stringify(fresh) !== JSON.stringify(entries);
      entries = fresh;
      loadState = 'ready';
      writeCache();
      if (changed) { homeIndex = null; route(); }
    } catch (err) {
      console.error(err);
      if (loadState === 'loading') { loadState = 'error'; route(); }
    }
  }

  const statusHTML = () => (loadState === 'loading'
    ? '<p class="empty">載入中…</p>'
    : '<p class="empty">連不上資料庫，請稍後重新整理頁面。</p>');

  /* ------------------------------------------------------------------
   * 小工具
   * ------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const hash = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; };

  const PALETTES = [
    ['#FFE8E6', '#F7C3BD'], ['#FFF1C2', '#F3DC86'], ['#E3F0E4', '#BDD8C0'],
    ['#E4EAF6', '#C2CFE9'], ['#F3E6F4', '#D9BFDC'], ['#FCD3CF', '#F0A8A0']
  ];

  const stars = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
  const typeLabel = (t) => (t === 'movie' ? '電影' : '書');
  const byDateDesc = (list) => [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const todayStr = () => new Date().toLocaleDateString('sv-SE');

  /* 封面只接受兩種寫法：網址（https://...）或專案內 img 資料夾的相對路徑（img/檔名.jpg） */
  function normalizeCover(u) {
    const s = String(u || '').trim().replace(/\\/g, '/');
    if (/^https?:\/\//i.test(s)) return s;
    if (/^(\.\/)?img\/[^?#]+$/i.test(s) && !s.includes('..')) return s.replace(/^\.\//, '');
    return '';
  }

  function safeUrl(u) {
    return normalizeCover(u).replace(/["'()\s\\]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  }

  function coverHTML(e) {
    const url = safeUrl(e.cover);
    const badge = e.type === 'movie' ? '<span class="cover__badge">FILM</span>' : '';
    if (url) {
      return `<div class="cover cover--img" style="background-image:url('${url}')" role="img" aria-label="${esc(e.title)}">${badge}</div>`;
    }
    const [a, b] = PALETTES[hash(e.title) % PALETTES.length];
    return `<div class="cover" style="background:linear-gradient(160deg,${a},${b})">
      <span class="cover__title">${esc(e.title)}</span>
      <span class="cover__by">${esc(e.creator)}</span>${badge}</div>`;
  }

  /* ------------------------------------------------------------------
   * 版面狀態
   * ------------------------------------------------------------------ */
  const app = $('#app');
  const tabs = document.querySelectorAll('.tab');
  const navLinks = document.querySelectorAll('[data-nav-link]');
  const dialog = $('#entry-dialog');
  const form = $('#entry-form');

  let homeIndex = null;
  let homeList = [];
  const CF_FIRST_DELAY = 1600;  // 第一張停留時間（ms）
  const CF_INTERVAL    = 3000;  // 之後每張間隔（2500ms 停留 + 500ms 動畫）
  let autoTimer = null;
  let autoPaused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let filter = 'all';
  let currentOwner = null;
  let editingId = null;

  function setChrome(view, owner) {
    document.body.dataset.view = view;
    if (owner) document.body.dataset.owner = owner; else delete document.body.dataset.owner;
    tabs.forEach(t => {
      if (t.dataset.tab === owner) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    navLinks.forEach(a => {
      if (a.dataset.navLink === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.title = owner ? `${PEOPLE[owner].name}'s page · Our Shelves` : 'Our Shelves';
  }

  /* 計算 "Our Shelves" 文字從 CSS 置中位置的偏移量，呼叫必須在頁面渲染後 */
  function positionTitle(instant) {
    const a = document.querySelector('.site-title a');
    if (!a) return;
    const h1 = a.closest('.site-title');
    if (!h1) return;
    const pad = parseFloat(getComputedStyle(h1).paddingLeft) || 24;
    const innerW = h1.offsetWidth - pad * 2;
    const aW = a.offsetWidth;
    if (!innerW || !aW) return;
    const owner = document.body.dataset.owner;
    /* CSS text-align:center 為基準，往右（queenie）或往左（jnmin）偏移 half */
    const half = Math.round((innerW - aW) / 2);
    const x = owner === 'queenie' ? half : owner === 'jnmin' ? -half : 0;
    if (instant) {
      const prev = a.style.transition;
      a.style.transition = 'none';
      a.style.transform = x ? `translateX(${x}px)` : '';
      requestAnimationFrame(() => { a.style.transition = prev; });
    } else {
      a.style.transform = x ? `translateX(${x}px)` : '';
    }
  }

  /* ------------------------------------------------------------------
   * Home：Cover Flow 書架
   * ------------------------------------------------------------------ */

  /* 依視窗寬度決定卡片間距（行動版縮小） */
  function cfStep() { return window.innerWidth < 820 ? 160 : 225; }

  /* 由 offset 算出每張書的 CSS transform（平移 + 縮放） */
  function bookTransform(off) {
    const absOff = Math.abs(off);
    const scale = [1.0, 0.78, 0.63][Math.min(absOff, 2)];
    const tx = off * cfStep();
    return `translate(calc(-50% + ${tx}px), -50%) scale(${scale})`;
  }

  function renderHome() {
    setChrome('home');
    homeList = byDateDesc(entries);
    if (!homeList.length) {
      app.innerHTML = loadState === 'ready'
        ? '<p class="empty">書架還是空的。登入後到自己的頁面新增第一筆吧。</p>'
        : statusHTML();
      return;
    }
    if (homeIndex === null || homeIndex >= homeList.length) homeIndex = Math.floor(homeList.length / 2);

    app.innerHTML = `
      <section class="home" aria-label="書架">
        <div class="shelf">
          ${homeList.map((e, i) => `<button class="book" type="button" data-i="${i}">${coverHTML(e)}</button>`).join('')}
        </div>
        <div class="shelf-controls">
          <button class="arrow" type="button" data-nav="-1" aria-label="上一本">‹</button>
          <button class="autoplay" type="button" data-autoplay></button>
          <button class="arrow" type="button" data-nav="1" aria-label="下一本">›</button>
        </div>
        <div class="danmaku" aria-hidden="true"></div>
      </section>`;
    /* 初始定位不跑動畫，待下一幀才開啟 transition */
    app.querySelectorAll('.book').forEach(b => { b.style.transition = 'none'; });
    setHome(homeIndex);
    updateAutoplayButton();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      app.querySelectorAll('.book').forEach(b => { b.style.transition = ''; });
      startAuto();
      startDanmaku();
    }));
  }

  /* 自動輪播：滑鼠停在書架上、用鍵盤操作、開著對話框或切到別的分頁時暫停 */
  function stopAuto() {
    clearTimeout(autoTimer);
    clearInterval(autoTimer);
    autoTimer = null;
  }

  function startAuto() {
    stopAuto();
    if (autoPaused || document.body.dataset.view !== 'home' || homeList.length < 2) return;
    const advance = () => {
      const sec = app.querySelector('.home');
      if (!sec || dialog.open || document.hidden) return;
      if (sec.matches(':hover') || sec.querySelector(':focus-visible')) return;
      setHome(homeIndex + 1);
    };
    /* 第一張停留 CF_FIRST_DELAY，之後每隔 CF_INTERVAL 切換一張 */
    autoTimer = setTimeout(() => {
      advance();
      autoTimer = setInterval(advance, CF_INTERVAL);
    }, CF_FIRST_DELAY);
  }

  function updateAutoplayButton() {
    const btn = app.querySelector('[data-autoplay]');
    if (!btn) return;
    btn.textContent = autoPaused ? '▶ 自動輪播' : '❚❚ 暫停輪播';
    btn.setAttribute('aria-pressed', String(!autoPaused));
  }

  function startDanmaku() {
    const danmaku = app.querySelector(".danmaku");
    if (!danmaku) return;
    const quotes = entries.filter(e => e.quote && e.quote.trim());
    if (!quotes.length) { danmaku.hidden = true; return; }
    const pool = [...quotes].sort(() => Math.random() - 0.5).slice(0, 6);
    const h = danmaku.offsetHeight;
    const lineH = 22;
    pool.forEach(q => {
      const el = document.createElement("span");
      el.className = "danmaku-item";
      el.textContent = q.quote.trim().replace(/\s+/g, " ");
      const dur = 30 + Math.random() * 20;
      const delay = -(Math.random() * dur);
      const y = lineH / 2 + Math.random() * (h - lineH * 2);
      el.style.cssText = `--dur:${dur.toFixed(1)}s;--delay:${delay.toFixed(1)}s;top:${y.toFixed(1)}px`;
      danmaku.appendChild(el);
    });
  }

  function setHome(i) {
    const n = homeList.length;
    homeIndex = ((i % n) + n) % n;
    app.querySelectorAll('.book').forEach((b, k) => {
      let off = (k - homeIndex + n) % n;
      if (off > n / 2) off -= n;
      const e = homeList[k];
      const absOff = Math.abs(off);
      b.dataset.offset = off;
      b.style.transform = bookTransform(off);
      b.style.opacity = absOff > 2 ? 0 : 1;
      b.style.zIndex  = 10 - absOff;
      b.style.pointerEvents = absOff > 2 ? 'none' : 'auto';
      b.tabIndex = absOff <= 2 ? 0 : -1;
      b.setAttribute('aria-hidden', absOff <= 2 ? 'false' : 'true');
      b.setAttribute('aria-label', off === 0
        ? `開啟「${e.title}」的心得（${PEOPLE[e.owner]?.name || e.owner} · ${typeLabel(e.type)} · ${e.rating} 顆星）`
        : `切換到「${e.title}」`);
    });
  }

  /* ------------------------------------------------------------------
   * 個人頁：簡介 + 錯落的書封牆
   * ------------------------------------------------------------------ */
  function cardHTML(e) {
    const ym = (e.date || '').slice(0, 7);
    const label = `${e.title} · ${stars(e.rating)}${ym ? ' · ' + ym : ''}`;
    return `<a class="card" href="#/entry/${encodeURIComponent(e.id)}" title="${esc(label)}" aria-label="${esc(label)}">
      ${coverHTML(e)}
    </a>`;
  }

  function renderOwner(id) {
    const prevOwner = currentOwner;
    if (currentOwner !== id) { filter = 'all'; currentOwner = id; }
    setChrome('owner', id);
    const p = PEOPLE[id];
    /* 切換主人時的進場方向：queenie(左)→jnmin(右) 從右滑入，反之從左滑入 */
    const owners = Object.keys(PEOPLE);
    const enterDir = prevOwner && prevOwner !== id
      ? (owners.indexOf(id) > owners.indexOf(prevOwner) ? 'right' : 'left')
      : null;
    const mine = byDateDesc(entries.filter(e => e.owner === id));
    const books = mine.filter(e => e.type === 'book').length;
    const movies = mine.length - books;
    const shown = mine.filter(e => filter === 'all' || e.type === filter);
    const legacy = canEdit(id) ? legacyEntries() : [];
    const cols = [[], []];
    if (filter === 'all') {
      shown.forEach((e, i) => cols[i % 2].push(cardHTML(e)));
    } else {
      const half = Math.ceil(shown.length / 2);
      shown.forEach((e, i) => cols[i < half ? 0 : 1].push(cardHTML(e)));
    }

    const chip = (key, label) =>
      `<button class="chip" type="button" data-filter="${key}" aria-pressed="${filter === key}">${label}</button>`;

    app.innerHTML = `
      <section class="owner${enterDir ? ` owner--enter-${enterDir}` : ''}" aria-label="${esc(p.name)}的書架">
        <aside class="profile">
          <p class="eyebrow">Shelf of</p>
          <h2>${esc(p.name)}</h2>
          <p class="bio">${esc(p.bio)}</p>
          <dl class="stats">
            <div><dt>讀過的書</dt><dd>${books}</dd></div>
            <div><dt>看過的電影</dt><dd>${movies}</dd></div>
          </dl>
          <div class="chips" role="group" aria-label="篩選">
            ${chip('all', '全部')}${chip('book', '書')}${chip('movie', '電影')}
          </div>
          ${canEdit(id) ? `<div class="profile-actions">
            <button class="btn" type="button" data-add>＋ 新增一筆</button>
            ${legacy.length ? `<button class="btn btn--ghost" type="button" data-import>匯入這台瀏覽器的舊資料（${legacy.length} 筆）</button>` : ''}
          </div>` : ''}
        </aside>
        <div class="masonry" data-wall data-filter="${filter}">
          ${shown.length
            ? `<div class="masonry__track">${cols.map(c => `<div class="masonry__col">${c.join('')}</div>`).join('')}</div>`
            : loadState === 'ready' ? '<p class="empty">這裡還沒有內容。</p>' : statusHTML()}
        </div>
      </section>`;
    startWall();
  }

  /* 書牆自動循環捲動：每一欄把自己的卡片複製接在後面，各自無縫循環。
   * 滑鼠停在書牆上時暫停，可用滾輪（或觸控拖曳）上下捲，同樣會循環。 */
  const WALL_SPEED = 24;   // 每秒移動幾 px
  const WALL_DIR = 1;      // 1：卡片由上往下移動；-1：由下往上
  const WALL_STAGGER = 100; // 全部模式：兩欄錯落距離（書/電影模式時為 0）
  let wallRaf = null;

  function stopWall() {
    cancelAnimationFrame(wallRaf);
    wallRaf = null;
  }

  function startWall() {
    stopWall();
    const wall = app.querySelector('[data-wall]');
    const cols = wall ? [...wall.querySelectorAll('.masonry__col')] : [];
    cols.forEach(c => {
      c.querySelectorAll('[data-clone]').forEach(n => n.remove());
      c.style.transform = '';
    });
    if (wall) wall.onwheel = wall.ontouchstart = wall.ontouchmove = null;
    // 手機版書牆不捲動
    if (!cols.length || getComputedStyle(wall).overflowY === 'visible') return;
    const stagger = filter === 'all' ? WALL_STAGGER : 0;
    // 書／電影篩選模式：靜態顯示，不循環捲動
    if (filter !== 'all') return;
    const activeCols = cols.filter(c => c.children.length);
    if (!activeCols.length) return;

    const gap = parseFloat(getComputedStyle(activeCols[0]).rowGap) || 0;
    const viewH = wall.clientHeight || 600;
    const loops = activeCols.map((col, i) => {
      const items = [...col.children];
      const period = col.offsetHeight + gap;
      // 至少複製到能填滿畫面兩倍，確保循環不管幾筆資料都能動
      const copies = Math.max(Math.ceil(viewH * 2 / period), 2);
      for (let k = 0; k < copies; k++) {
        items.forEach(n => {
          const c = n.cloneNode(true);
          c.inert = true;
          c.setAttribute('aria-hidden', 'true');
          c.dataset.clone = '';
          col.appendChild(c);
        });
      }
      return { col, period, phase: i === 0 ? -stagger : 0 };
    });

    let pos = 0;
    const apply = () => loops.forEach(l => {
      const y = (((pos + l.phase) % l.period) + l.period) % l.period;
      l.col.style.transform = `translateY(${-y}px)`;
    });
    apply();

    wall.onwheel = (e) => {
      e.preventDefault();
      pos += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      apply();
    };
    let touchY = 0;
    wall.ontouchstart = (e) => { touchY = e.touches[0].clientY; };
    wall.ontouchmove = (e) => {
      e.preventDefault();
      const y = e.touches[0].clientY;
      pos += touchY - y;
      touchY = y;
      apply();
    };

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      const held = reduced || dialog.open || document.hidden ||
        wall.matches(':hover') || wall.querySelector(':focus-visible');
      if (!held) {
        pos -= WALL_DIR * WALL_SPEED * dt;
        apply();
      }
      wallRaf = requestAnimationFrame(tick);
    };
    wallRaf = requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------------
   * 單篇心得：封面、欄位、便利貼
   * ------------------------------------------------------------------ */
  function renderEntry(id) {
    const e = entries.find(x => x.id === id);
    if (!e) {
      setChrome('entry');
      app.innerHTML = loadState === 'ready'
        ? '<p class="empty">找不到這筆紀錄。<a href="#/">回首頁</a></p>'
        : statusHTML();
      return;
    }
    setChrome('entry', e.owner);
    const p = PEOPLE[e.owner] || { name: e.owner };
    document.title = `${e.title} · Our Shelves`;

    app.innerHTML = `
      <article class="entry">
        <div>${coverHTML(e)}</div>

        <div class="entry__main">
          <a class="back" href="#/${esc(e.owner)}">← ${esc(p.name)}'s page</a>
          <div class="field field--title">
            <span class="field__label">${typeLabel(e.type)}名</span>
            <span class="field__value">${esc(e.title)}</span>
          </div>
          <div class="field">
            <span class="field__label">${e.type === 'movie' ? '導演' : '作者'}</span>
            <span class="field__value">${esc(e.creator) || '—'}</span>
          </div>
          <div class="field">
            <span class="field__label">${e.type === 'movie' ? '觀影日期' : '閱讀日期'} · 評分</span>
            <span class="field__value">${esc(e.date) || '—'} · <span class="stars">${stars(e.rating)}</span></span>
          </div>

          <section class="note">
            <span class="pin pin--c" aria-hidden="true"></span>
            <h3>心得</h3>
            <div class="ruled">${esc(e.review) || '還沒有寫心得。'}</div>
          </section>
        </div>

        <aside class="entry__side">
          <section class="note note--small">
            <span class="pin pin--l" aria-hidden="true"></span>
            <span class="pin pin--r" aria-hidden="true"></span>
            <h3>摘錄</h3>
            <p class="quote">${esc(e.quote) || '—'}</p>
          </section>
          ${canEdit(e.owner) ? `<div class="entry__actions">
            <button class="btn" type="button" data-edit="${esc(e.id)}">編輯</button>
            <button class="btn btn--ghost" type="button" data-delete="${esc(e.id)}">刪除</button>
          </div>` : ''}
          <p class="meta">${esc(p.name)} 的${typeLabel(e.type)}</p>
        </aside>
      </article>`;
  }

  /* ------------------------------------------------------------------
   * About us / Donate
   * ------------------------------------------------------------------ */
  function renderAbout() {
    setChrome('about');
    document.title = 'About us · Our Shelves';
    app.innerHTML = `
      <section class="page">
        <p class="eyebrow">About us</p>
        <h2>Our Shelves</h2>
        <p>這是 ${esc(PEOPLE.queenie.name)} 和 ${esc(PEOPLE.jnmin.name)} 的書架，收著我們讀過的書、看過的電影，和看完之後留下的一點心得。</p>
        <p><a href="#/queenie">${esc(PEOPLE.queenie.name)}'s page</a> · <a href="#/jnmin">${esc(PEOPLE.jnmin.name)}'s page</a></p>
      </section>`;
  }

  function renderDonate() {
    setChrome('donate');
    document.title = 'Donate<3 · Our Shelves';
    app.innerHTML = `
      <section class="page">
        <p class="eyebrow">Donate&lt;3</p>
        <h2>請我們喝杯咖啡</h2>
        <p>讓兩位窮女大學生可以買更多書跟電影票。Pleaseee donate us.<div>贊助方式準備中。</div></p>
      </section>`;
  }

  /* ------------------------------------------------------------------
   * 路由（網址 hash）
   * ------------------------------------------------------------------ */
  function route() {
    stopAuto();
    stopWall();
    const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
    if (a === 'entry' && b) renderEntry(decodeURIComponent(b));
    else if (a === 'about') renderAbout();
    else if (a === 'donate') renderDonate();
    else if (PEOPLE[a]) renderOwner(a);
    else renderHome();
    window.scrollTo({ top: 0 });
    try { positionTitle(); } catch (e) {}
  }

  function go(hashValue) {
    if (location.hash === hashValue) route(); else location.hash = hashValue;
  }

  /* ------------------------------------------------------------------
   * 登入：用 email 收登入連結。登入後查 owners 表，知道自己是哪個書架的主人。
   * ------------------------------------------------------------------ */
  const authBtn = $('[data-auth]');
  const loginDialog = $('#login-dialog');
  const loginForm = $('#login-form');
  const loginStatus = $('#login-status');

  let myId = null;     // 登入帳號的 user id
  let myEmail = '';
  let me = null;       // 這個帳號是哪個書架的主人：'queenie' | 'jnmin' | null
  const canEdit = (owner) => !!me && me === owner;

  function updateAuthButton() {
    authBtn.hidden = !sb;
    authBtn.textContent = myId ? `${me ? PEOPLE[me].name : myEmail} · 登出` : '登入';
  }

  async function loadMe(session) {
    myEmail = session?.user?.email || '';
    me = null;
    if (session) {
      const { data } = await sb.from('owners').select('owner').eq('user_id', session.user.id).maybeSingle();
      me = data?.owner || null;
      /* 從登入連結回來時網址會帶 ?code=，登入完成後拿掉 */
      if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    }
    updateAuthButton();
    route();
  }

  if (sb) {
    sb.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id || null;
      if (id === myId) return;
      myId = id;
      /* 回呼裡不能直接 await 其他 Supabase 呼叫，延到下一輪再查 */
      setTimeout(() => loadMe(session), 0);
    });
  }

  authBtn.addEventListener('click', () => {
    if (myId) sb.auth.signOut();
    else {
      loginForm.reset();
      loginStatus.textContent = '';
      loginDialog.showModal();
      loginForm.elements.email.focus();
    }
  });

  loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = loginForm.elements.email.value.trim();
    const btn = loginForm.querySelector('[type="submit"]');
    btn.disabled = true;
    loginStatus.textContent = '寄送中…';
    const { error } = await sb.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname }
    });
    btn.disabled = false;
    loginStatus.textContent = error
      ? `寄送失敗：${error.message}`
      : `已寄出登入連結到 ${email}，請到信箱點連結。`;
  });

  loginDialog.querySelector('[data-cancel]').addEventListener('click', () => loginDialog.close());

  /* ------------------------------------------------------------------
   * 新增／編輯／刪除：只有登入的本人能改自己的書架，資料庫也會再檢查一次
   * ------------------------------------------------------------------ */
  function openDialog(entry) {
    form.reset();
    editingId = entry ? entry.id : null;
    $('#dialog-title').textContent = entry ? '編輯紀錄' : '新增一筆';
    const d = entry || {
      type: 'book', title: '', creator: '',
      date: todayStr(), rating: 4, cover: '', review: '', quote: ''
    };
    Object.keys(d).forEach(k => { if (form.elements[k]) form.elements[k].value = d[k]; });
    dialog.showModal();
    form.elements.title.focus();
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!me) return;
    const fd = Object.fromEntries(new FormData(form));
    const data = {
      owner: me,
      type: fd.type === 'movie' ? 'movie' : 'book',
      title: (fd.title || '').trim(),
      creator: (fd.creator || '').trim(),
      date: fd.date || null,
      rating: Math.min(5, Math.max(1, Number(fd.rating) || 4)),
      cover: normalizeCover(fd.cover),
      review: (fd.review || '').trim(),
      quote: (fd.quote || '').trim()
    };
    if (!data.title) return;

    const id = editingId;
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    const { data: row, error } = id
      ? await sb.from('entries').update(data).eq('id', id).select().single()
      : await sb.from('entries').insert(data).select().single();
    btn.disabled = false;
    if (error) { alert(`儲存失敗：${error.message}`); return; }

    const saved = fromRow(row);
    entries = id ? entries.map(e => (e.id === id ? saved : e)) : [saved, ...entries];
    writeCache();
    homeIndex = null;
    dialog.close();
    go('#/entry/' + encodeURIComponent(saved.id));
  });

  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());

  async function removeEntry(id) {
    const e = entries.find(x => x.id === id);
    if (!e || !canEdit(e.owner) || !confirm(`確定要刪除「${e.title}」嗎？這個動作無法復原。`)) return;
    const { data, error } = await sb.from('entries').delete().eq('id', id).select('id');
    if (error || !data.length) { alert(`刪除失敗：${error ? error.message : '沒有權限刪除這筆紀錄'}`); return; }
    entries = entries.filter(x => x.id !== id);
    writeCache();
    homeIndex = null;
    go('#/' + e.owner);
  }

  /* ------------------------------------------------------------------
   * 匯入：把改用雲端前存在這台瀏覽器的舊紀錄搬上去（範例資料不匯入）
   * ------------------------------------------------------------------ */
  function readLegacy() {
    try {
      const data = JSON.parse(localStorage.getItem(LEGACY_KEY));
      if (Array.isArray(data)) return data;
    } catch (_) { /* 沒有舊資料 */ }
    return [];
  }

  function legacyEntries() {
    return readLegacy()
      .map(e => (e.owner === 'jimi' ? { ...e, owner: 'jnmin' } : e))
      .filter(e => e.owner === me && e.title &&
        !(String(e.id).startsWith('seed') && e.review === SAMPLE_REVIEW));
  }

  async function importLegacy() {
    const list = legacyEntries();
    if (!list.length || !confirm(`要把這台瀏覽器裡的 ${list.length} 筆舊紀錄匯入雲端嗎？`)) return;
    const rows = list.map(e => ({
      owner: me,
      type: e.type === 'movie' ? 'movie' : 'book',
      title: String(e.title).trim().slice(0, 80),
      creator: e.creator || '',
      date: e.date || null,
      rating: Math.min(5, Math.max(1, Number(e.rating) || 4)),
      cover: normalizeCover(e.cover),
      review: e.review || '',
      quote: e.quote || ''
    }));
    const { error } = await sb.from('entries').insert(rows);
    if (error) { alert(`匯入失敗：${error.message}`); return; }
    /* 匯入成功的從舊資料移除，避免重複匯入；另一位主人的舊資料保留 */
    const done = new Set(list.map(e => e.id));
    try {
      localStorage.setItem(LEGACY_KEY, JSON.stringify(readLegacy().filter(e => !done.has(e.id))));
    } catch (_) { /* 隱私模式等情況略過 */ }
    alert(`已匯入 ${list.length} 筆。`);
    await refresh();
  }

  /* ------------------------------------------------------------------
   * 事件
   * ------------------------------------------------------------------ */
  app.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-add],[data-import],[data-filter],[data-edit],[data-delete],[data-nav],[data-autoplay],.book');
    if (!t || !app.contains(t)) return;

    if (t.matches('.book')) {
      const i = Number(t.dataset.i);
      if (i === homeIndex) go('#/entry/' + encodeURIComponent(homeList[i].id));
      else { setHome(i); startAuto(); }
    } else if (t.dataset.nav) {
      setHome(homeIndex + Number(t.dataset.nav));
      startAuto();
    } else if (t.hasAttribute('data-autoplay')) {
      autoPaused = !autoPaused;
      updateAutoplayButton();
      startAuto();
    } else if (t.dataset.filter) {
      filter = t.dataset.filter;
      renderOwner(currentOwner);
    } else if (t.hasAttribute('data-add')) {
      openDialog(null);
    } else if (t.hasAttribute('data-import')) {
      importLegacy();
    } else if (t.dataset.edit) {
      openDialog(entries.find(e => e.id === t.dataset.edit));
    } else if (t.dataset.delete) {
      removeEntry(t.dataset.delete);
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (document.body.dataset.view !== 'home' || dialog.open || loginDialog.open || !homeList.length) return;
    if (ev.key === 'ArrowLeft') setHome(homeIndex - 1);
    else if (ev.key === 'ArrowRight') setHome(homeIndex + 1);
    else return;
    startAuto();
  });

  window.addEventListener('hashchange', route);

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (document.body.dataset.view === 'owner') startWall();
      if (document.body.dataset.view === 'home') {
        app.querySelectorAll('.book').forEach(b => { b.style.transition = 'none'; });
        setHome(homeIndex);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          app.querySelectorAll('.book').forEach(b => { b.style.transition = ''; });
        }));
      }
      try { positionTitle(true); } catch (e) {}
    }, 200);
  });

  $('#year').textContent = '© ' + new Date().getFullYear();
  updateAuthButton();
  route();
  refresh();
  try { positionTitle(true); } catch (e) {}
  if (document.fonts) document.fonts.ready.then(function() { try { positionTitle(true); } catch(e) {} });
})();