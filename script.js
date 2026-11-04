(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * 設定：兩位書架主人。改這裡就能換名字與簡介。
   * ------------------------------------------------------------------ */
  let PEOPLE = {
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
    date: r.date || '', rating: r.rating, cover: r.cover || '', review: r.review || '', quote: r.quote || '', genre: r.genre || ''
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
  let currentReadings = {};
  let loadState = entries.length ? 'ready' : 'loading';  // loading | ready | error

  async function refresh() {
    try {
      if (!sb) throw new Error('supabase-js 沒有載入');
      const [entriesRes, crRes, ownersRes] = await Promise.all([
        sb.from('entries').select('*').order('date', { ascending: false }),
        sb.from('current_reading').select('*'),
        sb.from('owners').select('owner, name, bio').order('owner')
      ]);
      if (entriesRes.error) throw entriesRes.error;
      if (crRes.data) { currentReadings = {}; crRes.data.forEach(r => { currentReadings[r.owner] = r; }); }
      if (ownersRes.data && ownersRes.data.length) {
        ownersRes.data.forEach(r => { if (r.owner && r.name) PEOPLE[r.owner] = { name: r.name, bio: r.bio || '' }; });
      }
      const fresh = entriesRes.data.map(fromRow);
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
    const scale = [1.0, 0.78, 0.63, 0.50][Math.min(absOff, 3)];
    const tx = off * cfStep();
    return `translate(calc(-50% + ${tx}px), -50%) scale(${scale})`;
  }

  function miniCoverHTML(e) {
    const url = safeUrl(e.cover);
    if (url) return `<div class="se-bk" style="background-image:url('${url}')"></div>`;
    const [a, b] = PALETTES[hash(e.title) % PALETTES.length];
    return `<div class="se-bk" style="background:linear-gradient(160deg,${a},${b})"></div>`;
  }

  function animateCardToPage(owner, cardEl) {
    const rect = cardEl.getBoundingClientRect();
    const cssVar = owner === 'queenie' ? '--pink' : '--salmon';
    const bg = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || '#fff';

    const ov = document.createElement('div');
    ov.style.cssText =
      'position:fixed;z-index:9999;pointer-events:none;' +
      `left:${rect.left}px;top:${rect.top}px;` +
      `width:${rect.width}px;height:${rect.height}px;` +
      `background:${bg};border-radius:14px;` +
      'transition:' +
      'left .44s cubic-bezier(.22,1,.36,1),' +
      'top .44s cubic-bezier(.22,1,.36,1),' +
      'width .44s cubic-bezier(.22,1,.36,1),' +
      'height .44s cubic-bezier(.22,1,.36,1),' +
      'border-radius .44s cubic-bezier(.22,1,.36,1);';
    document.body.appendChild(ov);

    ov.getBoundingClientRect(); // force layout
    requestAnimationFrame(() => {
      ov.style.left = '0px';
      ov.style.top = '0px';
      ov.style.width = '100vw';
      ov.style.height = '100vh';
      ov.style.borderRadius = '0';
    });

    setTimeout(() => {
      app.style.opacity = '0';
      go('#/' + owner);
      requestAnimationFrame(() => {
        app.style.transition = 'opacity 0.38s ease';
        app.style.opacity = '1';
        setTimeout(() => { app.style.transition = ''; }, 400);
      });
      ov.style.transition = 'opacity 0.35s ease';
      ov.style.opacity = '0';
      setTimeout(() => ov.remove(), 360);
    }, 430);
  }

  function shelfEntryCardHTML(owner) {
    const p = PEOPLE[owner];
    const mine = byDateDesc(entries.filter(e => e.owner === owner));
    const bookCount = mine.filter(e => e.type === 'book').length;
    const movieCount = mine.filter(e => e.type === 'movie').length;
    const recent = mine[0];
    if (!mine.length) {
      return `<a class="shelf-entry se-${owner}" href="#/${owner}">
        <div class="se-head">
          <div class="se-name">${esc(p.name)}'s shelf</div>
          <div class="se-stat">尚無紀錄</div>
        </div>
        <div class="se-scroll"><p class="empty" style="margin:auto;padding:24px 0">尚無紀錄</p></div>
        <div class="se-foot"><span class="se-enter">進入 →</span></div>
      </a>`;
    }
    let pool = mine.slice(0, 12);
    while (pool.length < 3) pool = [...pool, ...pool];
    const rot = (arr, n) => { const s = n % arr.length; return [...arr.slice(s), ...arr.slice(0, s)]; };
    const step = Math.max(1, Math.floor(pool.length / 3));
    const makeCol = (items) => [...items, ...items].map(e => miniCoverHTML(e)).join('');
    const recentStr = recent ? `最近：${esc(recent.title)}` : '';
    return `<a class="shelf-entry se-${owner}" href="#/${owner}">
      <div class="se-head">
        <div class="se-name">${esc(p.name)}'s shelf</div>
        <div class="se-stat">${bookCount} 本書 · ${movieCount} 部電影</div>
      </div>
      <div class="se-scroll">
        <div class="se-col">${makeCol(rot(pool, 0))}</div>
        <div class="se-col">${makeCol(rot(pool, step))}</div>
        <div class="se-col">${makeCol(rot(pool, step * 2))}</div>
      </div>
      <div class="se-foot">
        <span class="se-recent">${recentStr}</span>
        <span class="se-enter">進入 →</span>
      </div>
    </a>`;
  }

  function renderHome() {
    setChrome('home');
    homeList = [...entries].sort(() => Math.random() - 0.5);
    if (!homeList.length) {
      app.innerHTML = loadState === 'ready'
        ? '<p class="empty">書架還是空的。登入後到自己的頁面新增第一筆吧。</p>'
        : statusHTML();
      return;
    }
    if (homeIndex === null || homeIndex >= homeList.length) homeIndex = 0;

    const shelfEntriesHTML = Object.keys(PEOPLE).map(shelfEntryCardHTML).join('')
      + `<button class="shelf-entry shelf-entry--add" type="button" data-add-owner aria-label="新增書架主人"><span class="add-owner-icon" aria-hidden="true">＋</span><span class="add-owner-label">新增書架</span></button>`;
    app.innerHTML = `
      <section class="home" aria-label="書架">
        <div class="home-hero-wrap">
          <h1 class="home-hero">Our Shelves</h1>
          <div class="shelf">
            ${homeList.map((e, i) => `<button class="book" type="button" data-i="${i}">${coverHTML(e)}</button>`).join('')}
          </div>
          <div class="scroll-hint" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
          </div>
        </div>
        <div class="shelf-section">
          <div class="sg-bg">
            <div class="sg-blob sg-b1"></div>
            <div class="sg-blob sg-b2"></div>
            <div class="sg-blob sg-b3"></div>
          </div>
          <div class="danmaku" aria-hidden="true"></div>
          <div class="ss-inner">
            <p class="ss-label">選一個書架</p>
            <div class="shelf-entries">${shelfEntriesHTML}</div>
          </div>
        </div>
      </section>`;
    /* 初始定位不跑動畫，待下一幀才開啟 transition */
    app.querySelectorAll('.book').forEach(b => { b.style.transition = 'none'; });
    setHome(homeIndex);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      app.querySelectorAll('.book').forEach(b => { b.style.transition = ''; });
      startAuto();
      startDanmaku();
    }));

    /* Hero title: click to scroll to shelf section */
    const heroTitle = app.querySelector('.home-hero');
    const shelfSection = app.querySelector('.shelf-section');
    if (heroTitle && shelfSection) {
      heroTitle.addEventListener('click', () => {
        shelfSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    /* Shelf section: entry reveal */
    const ssInner = app.querySelector('.ss-inner');
    if (ssInner) {
      const io = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) { entry.target.classList.add('ss-visible'); io.disconnect(); }
      }, { threshold: 0.1 });
      io.observe(ssInner);
    }
    requestAnimationFrame(tickParallax);
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

function startDanmaku() {
    const danmaku = app.querySelector(".danmaku");
    if (!danmaku) return;
    const quotes = entries.filter(e => e.quote && e.quote.trim());
    if (!quotes.length) { danmaku.hidden = true; return; }
    const pool = [...quotes].sort(() => Math.random() - 0.5).slice(0, Math.min(quotes.length, 12));
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
      b.style.opacity = absOff > 3 ? 0 : absOff === 3 ? 0.65 : 1;
      b.style.zIndex  = 10 - absOff;
      b.style.pointerEvents = absOff > 3 ? 'none' : 'auto';
      b.tabIndex = absOff <= 3 ? 0 : -1;
      b.setAttribute('aria-hidden', absOff <= 3 ? 'false' : 'true');
      b.setAttribute('aria-label', off === 0
        ? `開啟「${e.title}」的心得（${PEOPLE[e.owner]?.name || e.owner} · ${typeLabel(e.type)} · ${e.rating} 顆星）`
        : `切換到「${e.title}」`);
    });
  }

  /* ------------------------------------------------------------------
   * 個人頁：簡介 + 錯落的書封牆
   * ------------------------------------------------------------------ */

  function crBlockHTML(owner) {
    const cr = currentReadings[owner];
    if (!cr && !canEdit()) return '';
    if (!cr) {
      return `<div class="cr-block" data-cr-owner="${owner}">
        <button class="cr-add-btn" type="button" data-cr-edit>＋ 加入正在閱讀的書</button>
      </div>`;
    }
    const imgUrl = safeUrl(cr.cover || '');
    const hasProgress = cr.page && cr.total_pages;
    const pct = hasProgress ? Math.min(100, Math.round(cr.page / cr.total_pages * 100)) : 0;
    return `<div class="cr-block" data-cr-owner="${owner}">
      <p class="eyebrow cr-eyebrow">正在閱讀</p>
      <div class="cr-card">
        <div class="cr-cover"${imgUrl ? ` style="background-image:url('${imgUrl}')"` : ''}></div>
        <div class="cr-info">
          <p class="cr-title">${esc(cr.title)}</p>
          ${cr.creator ? `<p class="cr-creator">${esc(cr.creator)}</p>` : ''}
          ${hasProgress ? `<p class="cr-progress">第 ${cr.page} 頁 ／ ${cr.total_pages} 頁</p>
          <div class="cr-bar"><div class="cr-bar__fill" style="width:${pct}%"></div></div>` : ''}
        </div>
      </div>
      ${canEdit() ? `<button class="cr-edit-btn" type="button" data-cr-edit>✏ 更改</button>` : ''}
    </div>`;
  }

  function crEditHTML(owner) {
    const cr = currentReadings[owner] || {};
    return `<p class="eyebrow cr-eyebrow">正在閱讀</p>
      <form class="cr-form" data-cr-form="${owner}">
        <input class="cr-input" name="title" placeholder="書名" value="${esc(cr.title || '')}" required>
        <input class="cr-input" name="creator" placeholder="作者（選填）" value="${esc(cr.creator || '')}">
        <input class="cr-input" name="cover" type="url" placeholder="封面圖片網址（選填）" value="${esc(cr.cover || '')}">
        <div class="cr-pages">
          <input class="cr-input cr-input--num" name="page" type="number" min="1" placeholder="目前頁" value="${cr.page || ''}">
          <span class="cr-pages-sep">／</span>
          <input class="cr-input cr-input--num" name="total_pages" type="number" min="1" placeholder="共幾頁" value="${cr.total_pages || ''}">
        </div>
        <div class="cr-actions">
          ${cr.title ? `<button type="button" class="btn btn--ghost btn--sm" data-cr-delete="${owner}">移除</button>` : ''}
          <button type="button" class="btn btn--ghost btn--sm" data-cr-cancel="${owner}">取消</button>
          <button type="submit" class="btn btn--sm">儲存</button>
        </div>
      </form>`;
  }

  function cardHTML(e) {
    const ym = (e.date || '').slice(0, 7);
    const dateStr = ym ? ym.replace('-', '/') : '';
    const label = `${e.title} · ${stars(e.rating)}${ym ? ' · ' + ym : ''}`;
    const hasImg = !!safeUrl(e.cover);
    return `<a class="card${hasImg ? ' card--img' : ''}" href="#/entry/${encodeURIComponent(e.id)}" aria-label="${esc(label)}">
      ${coverHTML(e)}${hasImg ? `<div class="card__info" aria-hidden="true">
        ${e.type === 'movie' ? '<span class="card__type">FILM</span>' : ''}
        <p class="card__title">${esc(e.title)}</p>
        ${e.creator ? `<p class="card__creator">${esc(e.creator)}</p>` : ''}
        ${dateStr ? `<p class="card__date">${dateStr}</p>` : ''}
      </div>` : ''}
    </a>`;
  }

  function showProfileEdit(field) {
    const profile = app.querySelector('.profile[data-profile-owner]');
    if (!profile) return;
    const ownerId = profile.dataset.profileOwner;
    const current = PEOPLE[ownerId][field] || '';
    const wrap = profile.querySelector(`.profile-field:has([data-profile-${field}])`);
    if (!wrap) return;
    wrap.innerHTML = field === 'name'
      ? `<input class="edit-inline-input" type="text" value="${esc(current)}" maxlength="40" autocomplete="off">
         <div class="edit-inline-actions">
           <button class="btn" type="button" data-save-profile="${field}">儲存</button>
           <button class="btn btn--ghost" type="button" data-cancel-profile>取消</button>
         </div>`
      : `<textarea class="edit-inline-input edit-inline-textarea" maxlength="200" rows="4">${esc(current)}</textarea>
         <div class="edit-inline-actions">
           <button class="btn" type="button" data-save-profile="${field}">儲存</button>
           <button class="btn btn--ghost" type="button" data-cancel-profile>取消</button>
         </div>`;
    const input = wrap.querySelector('.edit-inline-input');
    input.focus();
    if (field === 'name') input.select();
  }

  async function saveProfileEdit(field) {
    const profile = app.querySelector('.profile[data-profile-owner]');
    if (!profile) return;
    const ownerId = profile.dataset.profileOwner;
    const input = profile.querySelector('.edit-inline-input');
    if (!input) return;
    const newVal = input.value.trim();
    if (field === 'name' && !newVal) return;
    const saveBtn = profile.querySelector(`[data-save-profile="${field}"]`);
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '儲存中…'; }
    const { error } = await sb.from('owners').update({ [field]: newVal }).eq('owner', ownerId);
    if (error) { alert('儲存失敗：' + error.message); if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '儲存'; } return; }
    PEOPLE[ownerId][field] = newVal;
    renderOwner(ownerId);
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
    const numCols = window.innerWidth > 820 ? 3 : 2;
    const cols = Array.from({ length: numCols }, () => []);
    shown.forEach((e, i) => cols[i % numCols].push(cardHTML(e)));

    const chip = (key, label) =>
      `<button class="chip" type="button" data-filter="${key}" aria-pressed="${filter === key}">${label}</button>`;

    app.innerHTML = `
      <section class="owner${enterDir ? ` owner--enter-${enterDir}` : ''}" aria-label="${esc(p.name)}的書架">
        <aside class="profile" data-profile-owner="${id}">
          <p class="eyebrow">Shelf of</p>
          <div class="profile-field">
            <h2 data-profile-name>${esc(p.name)}</h2>
            ${canEdit(id) ? `<button class="edit-inline-btn" type="button" data-edit-name aria-label="編輯名字">✎</button>` : ''}
          </div>
          <div class="profile-field">
            <p class="bio" data-profile-bio>${esc(p.bio)}</p>
            ${canEdit(id) ? `<button class="edit-inline-btn" type="button" data-edit-bio aria-label="編輯簡介">✎</button>` : ''}
          </div>
          ${crBlockHTML(id)}
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
          ${monthlyStatsHTML(mine)}
        </aside>
        <div class="masonry" data-wall data-filter="${filter}">
          ${shown.length
            ? `<div class="masonry__track">${cols.map(c => `<div class="masonry__col">${c.join('')}</div>`).join('')}</div>`
            : loadState === 'ready' ? '<p class="empty">這裡還沒有內容。</p>' : statusHTML()}
        </div>
      </section>`;
    startWall();
  }

  const WALL_SPEED = 24;
  const WALL_DIR = 1;
  const WALL_STAGGER = 100;
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
    wall.querySelectorAll('.wall-arrow').forEach(b => b.remove());
    if (!cols.length || getComputedStyle(wall).overflowY === 'visible') return;

    // 書／電影篩選模式：arrow buttons 手動捲動
    if (filter !== 'all') {
      const track = wall.querySelector('.masonry__track');
      if (!track) return;
      requestAnimationFrame(() => {
        const padTop = parseFloat(getComputedStyle(wall).paddingTop) || 0;
        const maxScroll = Math.max(0, padTop + track.offsetHeight - wall.clientHeight);
        if (maxScroll <= 0) return;
        let scrollPos = 0;
        const upBtn = document.createElement('button');
        upBtn.className = 'wall-arrow wall-arrow--up';
        upBtn.type = 'button';
        upBtn.setAttribute('aria-label', '往上');
        upBtn.textContent = '↑';
        const downBtn = document.createElement('button');
        downBtn.className = 'wall-arrow wall-arrow--down';
        downBtn.type = 'button';
        downBtn.setAttribute('aria-label', '往下');
        downBtn.textContent = '↓';
        wall.appendChild(upBtn);
        wall.appendChild(downBtn);
        const setPos = (target, animated) => {
          scrollPos = Math.max(0, Math.min(maxScroll, target));
          track.style.transition = animated ? 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
          track.style.transform = `translateY(${-scrollPos}px)`;
          upBtn.hidden = scrollPos <= 0;
          downBtn.hidden = scrollPos >= maxScroll;
        };
        upBtn.onclick = () => setPos(scrollPos - wall.clientHeight * 0.8, true);
        downBtn.onclick = () => setPos(scrollPos + wall.clientHeight * 0.8, true);
        wall.onwheel = (e) => { e.preventDefault(); setPos(scrollPos + e.deltaY * (e.deltaMode === 1 ? 16 : 1), false); };
        let touchY0 = 0;
        wall.ontouchstart = (e) => { touchY0 = e.touches[0].clientY; };
        wall.ontouchmove = (e) => { e.preventDefault(); setPos(scrollPos - (e.touches[0].clientY - touchY0), false); touchY0 = e.touches[0].clientY; };
        setPos(0, false);
      });
      return;
    }

    // 全部模式：自動循環捲動
    const activeCols = cols.filter(c => c.children.length);
    if (!activeCols.length) return;
    const gap = parseFloat(getComputedStyle(activeCols[0]).rowGap) || 0;
    const viewH = wall.clientHeight || 600;
    const loops = activeCols.map((col, i) => {
      const items = [...col.children];
      const period = col.offsetHeight + gap;
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
      return { col, period, phase: (i - Math.floor(activeCols.length / 2)) * WALL_STAGGER };
    });
    let pos = 0;
    const apply = () => loops.forEach(l => {
      const y = (((pos + l.phase) % l.period) + l.period) % l.period;
      l.col.style.transform = `translateY(${-y}px)`;
    });
    apply();
    wall.onwheel = (e) => { e.preventDefault(); pos += e.deltaY * (e.deltaMode === 1 ? 16 : 1); apply(); };
    let touchY = 0;
    wall.ontouchstart = (e) => { touchY = e.touches[0].clientY; };
    wall.ontouchmove = (e) => { e.preventDefault(); pos += touchY - e.touches[0].clientY; touchY = e.touches[0].clientY; apply(); };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      if (!reduced && !dialog.open && !document.hidden && !wall.matches(':hover') && !wall.querySelector(':focus-visible')) {
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
          ${e.genre ? `<div class="field"><span class="field__label">分類</span><a class="genre-tag" href="#/genres">${esc(e.genre)}</a></div>` : ""}
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
        <section class="entry__comments">
          <h3 class="comments__heading">留言</h3>
          <div class="comment-list"><p class="empty">載入中⋯</p></div>
          <form class="comment-form" data-comment-form="${esc(e.id)}">
            <input name="nickname" placeholder="你的名字" maxlength="30" required autocomplete="off">
            <textarea name="message" placeholder="留言⋯" maxlength="300" rows="3" required></textarea>
            <button class="btn" type="submit">留言</button>
          </form>
        </section>
      </article>`;
    loadCommentsSection(e.id);
  }

  /* ------------------------------------------------------------------
   * 推薦書：任何人都可以不登入推薦一本書
   * ------------------------------------------------------------------ */
  function recCardHTML(r) {
    const date = r.created_at
      ? new Date(r.created_at).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })
      : '';
    return `<div class="rec-card">
      <p class="rec-card__title">${esc(r.title)}</p>
      ${r.creator ? `<p class="rec-card__creator">${esc(r.creator)}</p>` : ''}
      <p class="rec-card__review">${esc(r.review)}</p>
      <p class="rec-card__meta">— ${esc(r.nickname)}${date ? `<span class="rec-card__date"> · ${esc(date)}</span>` : ''}</p>
    </div>`;
  }

  async function loadRecsSection() {
    const list = app.querySelector('.rec-list');
    if (!list || !sb) return;
    try {
      const { data, error } = await sb.from('recommendations')
        .select('title, creator, review, nickname, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      list.innerHTML = data.length
        ? data.map(recCardHTML).join('')
        : '<p class="empty recs-empty">還沒有推薦，來第一個吧。</p>';
    } catch (err) {
      console.error('loadRecs:', err);
      list.innerHTML = `<p class="empty">載入失敗：${esc(err?.message || String(err))}</p>`;
    }
  }

  async function submitRec(d, form) {
    if (!sb) { alert('需要資料庫連線。'); return; }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = '送出中…';
    const { data, error } = await sb.from('recommendations').insert({
      title:    d.title.slice(0, 80),
      creator:  (d.creator || '').slice(0, 60),
      review:   d.review.slice(0, 400),
      nickname: d.nickname.slice(0, 30)
    }).select('title, creator, review, nickname, created_at').single();
    btn.disabled = false; btn.textContent = '送出推薦';
    if (error) { alert('送出失敗：' + error.message); return; }
    form.reset();
    const list = app.querySelector('.rec-list');
    if (list) {
      list.querySelector('.recs-empty')?.remove();
      list.insertAdjacentHTML('afterbegin', recCardHTML(data));
    }
  }

  function renderAbout() {
    setChrome('about');
    document.title = '推薦書 · Our Shelves';
    app.innerHTML = `
      <section class="recs-page">
        <div class="recs-left">
          <p class="eyebrow">大家的推薦</p>
          <h2>推薦一本書</h2>
          <p class="recs-lead">不用登入，任何人都可以推薦一本喜歡的書，留下幾句心得。</p>
          <form class="rec-form" data-rec-form>
            <input class="rec-input" name="title" placeholder="書名" maxlength="80" required autocomplete="off">
            <input class="rec-input" name="creator" placeholder="作者（選填）" maxlength="60" autocomplete="off">
            <textarea class="rec-input" name="review" placeholder="推薦的理由或心得" maxlength="400" rows="4" required></textarea>
            <div class="rec-form-foot">
              <input class="rec-input rec-input--name" name="nickname" placeholder="你的名字" maxlength="30" required autocomplete="off">
              <button class="btn" type="submit">送出推薦</button>
            </div>
          </form>
        </div>
        <div class="recs-right">
          <div class="rec-list"><p class="empty">載入中⋯</p></div>
        </div>
      </section>`;
    loadRecsSection();
  }


  function donateClick(sourceEl) {
    const numEl = document.getElementById('donate-num');
    if (!numEl) return;
    const n = parseInt(numEl.textContent || '0') + 1;
    numEl.textContent = n;
    try { localStorage.setItem('donate-hearts', n); } catch (_) {}

    const cup = document.getElementById('donate-cup');
    if (cup) { cup.classList.remove('cup-bounce'); void cup.offsetWidth; cup.classList.add('cup-bounce'); }

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const icons = ['☕', '♡', '✨', '💛', '📖'];
    const fly = document.createElement('span');
    fly.textContent = icons[Math.floor(Math.random() * icons.length)];
    fly.style.cssText = 'position:fixed;pointer-events:none;z-index:9000;font-size:22px;transition:none;user-select:none';
    const rect = sourceEl.getBoundingClientRect();
    fly.style.left = (rect.left + rect.width / 2 - 11) + 'px';
    fly.style.top  = rect.top + 'px';
    document.body.appendChild(fly);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fly.style.transition = 'transform .4s cubic-bezier(.22,1,.36,1), opacity .4s ease .05s';
      fly.style.transform  = 'translateY(-88px) scale(1.5)';
      fly.style.opacity    = '0';
      setTimeout(() => fly.remove(), 450);
    }));
  }

  function renderDonate() {
    setChrome('donate');
    document.title = 'Donate♡ · Our Shelves';
    const saved = (() => { try { return parseInt(localStorage.getItem('donate-hearts') || '0'); } catch (_) { return 0; } })();
    app.innerHTML = `
      <section class="donate-page">
        <p class="eyebrow">Donate♡</p>
        <h2>請我們喝杯咖啡</h2>
        <p class="donate-lead">讓兩位窮女大學生可以買更多書跟電影票。Pleaseee donate us.</p>

        <div class="coffee-zone">
          <button class="coffee-cup" type="button" id="donate-cup" aria-label="投一個心意">
            <span class="cup-emoji">☕</span>
          </button>
          <p class="heart-count">已收到 <strong id="donate-num">${saved}</strong> 個心意</p>
          <button class="btn donate-click-btn" type="button">投一個心意 ♡</button>
        </div>

      </section>`;

    app.querySelector('.donate-click-btn').addEventListener('click', function () { donateClick(this); });
    document.getElementById('donate-cup').addEventListener('click', function () { donateClick(this); });
  }

  /* ------------------------------------------------------------------
   * Genres 分類頁
   * ------------------------------------------------------------------ */
  function renderGenres() {
    setChrome("genres");
    document.title = "Genres · Our Shelves";
    const books = entries.filter(e => e.genre && e.genre.trim());
    if (!books.length) {
      app.innerHTML = loadState === "ready"
        ? `<section class="page"><p class="eyebrow">Genres</p><h2>書籍分類</h2><p>還沒有分類資料。在新增書籍時填入分類欄位吧。</p></section>`
        : statusHTML();
      return;
    }
    const byGenre = {};
    books.forEach(e => {
      const g = e.genre.trim();
      if (!byGenre[g]) byGenre[g] = [];
      byGenre[g].push(e);
    });
    const sorted = Object.entries(byGenre).sort((a, b) => b[1].length - a[1].length);
    app.innerHTML = `
      <section class="genres">
        <p class="eyebrow">Genres</p>
        <h2 class="genres__title">書籍分類</h2>
        <nav class="genre-chips" aria-label="分類">
          ${sorted.map(([g]) => `<a class="genre-chip" href="#genre-${esc(g)}">${esc(g)}<span class="genre-chip__count">${byGenre[g].length}</span></a>`).join("")}
        </nav>
        ${sorted.map(([g, list]) => `<section class="genre-section" id="genre-${esc(g)}">
          <h3 class="genre-section__title">${esc(g)}</h3>
          <div class="genre-covers">
            ${list.map(e => `<a class="genre-card" href="#/entry/${encodeURIComponent(e.id)}">${coverHTML(e)}</a>`).join("")}
          </div>
        </section>`).join("")}
      </section>`;
  }

  /* ------------------------------------------------------------------
   * 留言：便條紙
   * ------------------------------------------------------------------ */
  function stickyHTML(c) {
    const date = c.created_at
      ? new Date(c.created_at).toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" })
      : "";
    return `<div class="sticky">
      <p class="sticky__name">${esc(c.nickname)}</p>
      <p class="sticky__text">${esc(c.message)}</p>
      ${date ? `<time class="sticky__time">${esc(date)}</time>` : ""}
    </div>`;
  }

  async function loadComments(entryId) {
    if (!sb) return [];
    try {
      const { data, error } = await sb.from("comments")
        .select("nickname, message, created_at")
        .eq("entry_id", entryId)
        .order("created_at", { ascending: true });
      if (error) return [];
      return data || [];
    } catch (_) { return []; }
  }

  async function loadCommentsSection(entryId) {
    const list = app.querySelector(".comment-list");
    if (!list) return;
    const comments = await loadComments(entryId);
    list.innerHTML = comments.length
      ? comments.map(stickyHTML).join("")
      : `<p class="empty comments__empty">還沒有留言，來第一個留言吧。</p>`;
  }

  async function submitComment(entryId, nickname, message, f) {
    if (!sb) { alert("留言功能需要資料庫連線。"); return; }
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    const { data, error } = await sb.from("comments").insert({
      entry_id: entryId,
      nickname: nickname.slice(0, 50),
      message: message.slice(0, 500)
    }).select("nickname, message, created_at").single();
    btn.disabled = false;
    if (error) { alert("留言失敗：" + error.message); return; }
    f.reset();
    const list = app.querySelector(".comment-list");
    if (list) {
      const empty = list.querySelector(".comments__empty");
      if (empty) empty.remove();
      list.insertAdjacentHTML("beforeend", stickyHTML(data));
    }
  }

  /* ------------------------------------------------------------------
   * 每月閱讀統計（queenie）
   * ------------------------------------------------------------------ */
  function monthlyStatsHTML(ownerEntries) {
    const counts = {};
    ownerEntries.forEach(e => {
      if (!e.date) return;
      const ym = e.date.slice(0, 7);
      counts[ym] = (counts[ym] || 0) + 1;
    });
    const recorded = Object.keys(counts).sort();
    if (!recorded.length) return "";
    // Fill every month from first to last so gaps show as 0
    const months = [];
    let [y, mo] = recorded[0].split('-').map(Number);
    const [endY, endMo] = recorded[recorded.length - 1].split('-').map(Number);
    while (y < endY || (y === endY && mo <= endMo)) {
      months.push(`${y}-${String(mo).padStart(2, '0')}`);
      if (++mo > 12) { mo = 1; y++; }
    }
    const displayed = months.slice(-12);
    const maxC = Math.max(...displayed.map(m => counts[m] || 0), 1);
    return `<div class="monthly-stats">
      <p class="eyebrow" style="margin-top:28px">每月紀錄</p>
      <div class="monthly-chart">
        ${displayed.map(m => {
          const n = counts[m] || 0;
          return `<div class="month-row">
          <span class="month-label">${m.replace("-", "/")}</span>
          <div class="month-bar-wrap"><div class="month-bar" style="width:${Math.round(n / maxC * 100)}%"></div></div>
          <span class="month-count">${n || ''}</span>
        </div>`;
        }).join("")}
      </div>
    </div>`;
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
    else if (a === 'genres') renderGenres();
    else if (PEOPLE[a]) renderOwner(a);
    else renderHome();
    window.scrollTo({ top: 0 });
    try { positionTitle(); } catch (e) {}
  }

  function go(hashValue) {
    if (location.hash === hashValue) route(); else location.hash = hashValue;
  }

  /* ------------------------------------------------------------------
   * 登入：平常用 email + 密碼；還沒設密碼或忘記密碼時改寄登入連結。
   * 登入後查 owners 表，知道自己是哪個書架的主人。
   * ------------------------------------------------------------------ */
  const authBtn = $('[data-auth]');
  const loginDialog = $('#login-dialog');
  const loginForm = $('#login-form');
  const loginStatus = $('#login-status');
  const accountDialog = $('#account-dialog');
  const accountForm = $('#account-form');
  const accountStatus = $('#account-status');

  let myId = null;     // 登入帳號的 user id
  let myEmail = '';
  let me = null;       // 這個帳號是哪個書架的主人：'queenie' | 'jnmin' | null
  /* 兩位主人登入後都能改兩個書架 */
  const canEdit = () => !!me;

  function updateAuthButton() {
    authBtn.hidden = !sb;
    authBtn.textContent = myId ? `${me ? PEOPLE[me].name : myEmail} · 帳號` : '登入';
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
    if (myId) {
      accountForm.reset();
      $('#account-email').textContent = `目前登入：${myEmail}`;
      accountStatus.textContent = '';
      accountDialog.showModal();
    } else {
      loginForm.reset();
      loginStatus.textContent = '';
      loginDialog.showModal();
      loginForm.elements.email.focus();
    }
  });

  loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = loginForm.elements.email.value.trim();
    const password = loginForm.elements.password.value;
    if (!password) { loginStatus.textContent = '請輸入密碼。'; return; }
    const btn = loginForm.querySelector('[type="submit"]');
    btn.disabled = true;
    loginStatus.textContent = '登入中…';
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (!error) { loginDialog.close(); return; }
    loginStatus.textContent = error.code === 'invalid_credentials'
      ? 'email 或密碼不對。還沒設定過密碼的話，請先用下面的登入連結登入一次。'
      : `登入失敗：${error.message}`;
  });

  loginForm.querySelector('[data-magic]').addEventListener('click', async (ev) => {
    const input = loginForm.elements.email;
    if (!input.reportValidity()) return;
    ev.target.disabled = true;
    loginStatus.textContent = '寄送中…';
    const { error } = await sb.auth.signInWithOtp({
      email: input.value.trim(), options: { emailRedirectTo: location.origin + location.pathname }
    });
    ev.target.disabled = false;
    loginStatus.textContent = error
      ? `寄送失敗：${error.message}`
      : `已寄出登入連結到 ${input.value.trim()}，請用這個瀏覽器打開信裡的連結，登入後再按右上角設定密碼。`;
  });

  loginDialog.querySelector('[data-cancel]').addEventListener('click', () => loginDialog.close());

  accountForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { password, confirm: again } = accountForm.elements;
    if (password.value !== again.value) { accountStatus.textContent = '兩次輸入的密碼不一樣。'; return; }
    const btn = accountForm.querySelector('[type="submit"]');
    btn.disabled = true;
    accountStatus.textContent = '設定中…';
    const { error } = await sb.auth.updateUser({ password: password.value });
    btn.disabled = false;
    accountForm.reset();
    accountStatus.textContent = error
      ? `設定失敗：${error.message}`
      : '密碼設定好了，下次可以用 email + 密碼登入。';
  });

  accountForm.querySelector('[data-signout]').addEventListener('click', async () => {
    await sb.auth.signOut();
    accountDialog.close();
  });

  accountForm.querySelector('[data-cancel]').addEventListener('click', () => accountDialog.close());

  /* ------------------------------------------------------------------
   * 新增書架主人
   * ------------------------------------------------------------------ */
  const addOwnerDialog = $('#add-owner-dialog');
  const addOwnerForm = $('#add-owner-form');
  const addOwnerStatus = $('#add-owner-status');

  function openAddOwnerDialog() {
    addOwnerForm.reset();
    addOwnerStatus.textContent = '';
    addOwnerDialog.showModal();
    addOwnerForm.elements.owner_id.focus();
  }

  addOwnerForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const owner_id = addOwnerForm.elements.owner_id.value.trim().toLowerCase();
    const name = addOwnerForm.elements.name.value.trim();
    const bio = addOwnerForm.elements.bio.value.trim();
    if (!owner_id || !name) return;
    if (PEOPLE[owner_id]) { addOwnerStatus.textContent = '這個 ID 已經存在。'; return; }
    addOwnerStatus.textContent = '儲存中…';
    const { error } = await sb.from('owners').insert({ owner: owner_id, name, bio });
    if (error) { addOwnerStatus.textContent = '新增失敗：' + error.message; return; }
    PEOPLE[owner_id] = { name, bio };
    addOwnerDialog.close();
    route();
  });

  addOwnerDialog.querySelector('[data-cancel]').addEventListener('click', () => addOwnerDialog.close());

  /* ------------------------------------------------------------------
   * 新增／編輯／刪除：只有登入的主人能改，資料庫也會再檢查一次
   * ------------------------------------------------------------------ */
  function openDialog(entry, ownerDefault) {
    form.reset();
    editingId = entry ? entry.id : null;
    $('#dialog-title').textContent = entry ? '編輯紀錄' : '新增一筆';
    const ownerSel = form.elements.owner;
    if (ownerSel) ownerSel.innerHTML = Object.keys(PEOPLE).map(k =>
      `<option value="${esc(k)}">${esc(PEOPLE[k].name)}</option>`).join('');
    const d = entry || {
      owner: ownerDefault || me, type: 'book', title: '', creator: '',
      date: todayStr(), rating: 4, cover: '', review: '', quote: '', genre: ''
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
      owner: PEOPLE[fd.owner] ? fd.owner : me,
      type: fd.type === 'movie' ? 'movie' : 'book',
      title: (fd.title || '').trim(),
      creator: (fd.creator || '').trim(),
      date: fd.date || null,
      rating: Math.min(5, Math.max(1, Number(fd.rating) || 4)),
      cover: normalizeCover(fd.cover),
      review: (fd.review || '').trim(),
      quote: (fd.quote || '').trim(),
      genre: (fd.genre || '').trim()
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
   * 匯入：把改用雲端前存在這台瀏覽器的舊紀錄（兩人的）搬上去，範例資料不匯入
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
      .filter(e => PEOPLE[e.owner] && e.title &&
        !(String(e.id).startsWith('seed') && e.review === SAMPLE_REVIEW));
  }

  async function importLegacy() {
    const list = legacyEntries();
    if (!list.length || !confirm(`要把這台瀏覽器裡的 ${list.length} 筆舊紀錄匯入雲端嗎？`)) return;
    const rows = list.map(e => ({
      owner: e.owner,
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
    /* 匯入成功的從舊資料移除，避免重複匯入 */
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
    const card = ev.target.closest('.shelf-entry:not(.shelf-entry--add)');
    if (card && app.contains(card)) {
      ev.preventDefault();
      const href = card.getAttribute('href') || '';
      const owner = href.replace('#/', '');
      if (PEOPLE[owner]) animateCardToPage(owner, card);
      else if (href) go(href);
      return;
    }

    const t = ev.target.closest('[data-add],[data-import],[data-filter],[data-edit],[data-delete],[data-cr-edit],[data-cr-cancel],[data-cr-delete],[data-add-owner],[data-edit-name],[data-edit-bio],[data-save-profile],[data-cancel-profile],.book');
    if (!t || !app.contains(t)) return;

    if (t.matches('.book')) {
      const i = Number(t.dataset.i);
      if (i === homeIndex) go('#/entry/' + encodeURIComponent(homeList[i].id));
      else { setHome(i); startAuto(); }
    } else if (t.dataset.filter) {
      filter = t.dataset.filter;
      renderOwner(currentOwner);
    } else if (t.hasAttribute('data-add')) {
      openDialog(null, currentOwner);
    } else if (t.hasAttribute('data-import')) {
      importLegacy();
    } else if (t.dataset.edit) {
      openDialog(entries.find(e => e.id === t.dataset.edit));
    } else if (t.dataset.delete) {
      removeEntry(t.dataset.delete);
    } else if (t.hasAttribute('data-add-owner')) {
      if (canEdit()) openAddOwnerDialog(); else authBtn.click();
    } else if (t.hasAttribute('data-cr-edit')) {
      const block = t.closest('[data-cr-owner]');
      if (block) block.innerHTML = crEditHTML(block.dataset.crOwner);
    } else if (t.dataset.crCancel) {
      const owner = t.dataset.crCancel;
      const block = app.querySelector(`[data-cr-owner="${owner}"]`);
      if (block) block.outerHTML = crBlockHTML(owner);
    } else if (t.dataset.crDelete) {
      const owner = t.dataset.crDelete;
      if (confirm('確定移除正在閱讀的書？')) {
        sb.from('current_reading').delete().eq('owner', owner).then(({ error }) => {
          if (error) { alert('移除失敗：' + error.message); return; }
          delete currentReadings[owner];
          const block = app.querySelector(`[data-cr-owner="${owner}"]`);
          if (block) block.outerHTML = crBlockHTML(owner);
        });
      }
    } else if (t.hasAttribute('data-edit-name')) {
      showProfileEdit('name');
    } else if (t.hasAttribute('data-edit-bio')) {
      showProfileEdit('bio');
    } else if (t.dataset.saveProfile) {
      saveProfileEdit(t.dataset.saveProfile);
    } else if (t.hasAttribute('data-cancel-profile')) {
      if (currentOwner) renderOwner(currentOwner);
    }
  });

  app.addEventListener('submit', (ev) => {
    const crForm = ev.target.closest('[data-cr-form]');
    if (crForm) {
      ev.preventDefault();
      const owner = crForm.dataset.crForm;
      const d = Object.fromEntries(new FormData(crForm).entries());
      const row = { owner, title: d.title, creator: d.creator || '', cover: d.cover || '' };
      if (d.page) row.page = Number(d.page);
      if (d.total_pages) row.total_pages = Number(d.total_pages);
      row.updated_at = new Date().toISOString();
      sb.from('current_reading').upsert(row, { onConflict: 'owner' }).then(({ error }) => {
        if (error) { alert('儲存失敗：' + error.message); return; }
        currentReadings[owner] = row;
        const block = app.querySelector(`[data-cr-owner="${owner}"]`);
        if (block) block.outerHTML = crBlockHTML(owner);
      });
      return;
    }

    const recForm = ev.target.closest('[data-rec-form]');
    if (recForm) {
      ev.preventDefault();
      const title    = (recForm.elements.title.value    || '').trim();
      const creator  = (recForm.elements.creator.value  || '').trim();
      const review   = (recForm.elements.review.value   || '').trim();
      const nickname = (recForm.elements.nickname.value || '').trim();
      if (!title || !review || !nickname) return;
      submitRec({ title, creator, review, nickname }, recForm);
      return;
    }

    const f = ev.target.closest('[data-comment-form]');
    if (!f) return;
    ev.preventDefault();
    const entryId = f.dataset.commentForm;
    const nickname = (f.elements.nickname.value || '').trim();
    const message = (f.elements.message.value || '').trim();
    if (!nickname || !message) return;
    submitComment(entryId, nickname, message, f);
  });

  document.addEventListener('keydown', (ev) => {
    if (document.body.dataset.view !== 'home' || dialog.open || loginDialog.open || accountDialog.open || !homeList.length) return;
    if (ev.key === 'ArrowLeft') setHome(homeIndex - 1);
    else if (ev.key === 'ArrowRight') setHome(homeIndex + 1);
    else return;
    startAuto();
  });

  const hamBtn = document.querySelector('.ham-btn');
  const mobNav = document.getElementById('mob-nav');
  if (hamBtn && mobNav) {
    hamBtn.addEventListener('click', () => {
      const open = mobNav.hidden;
      mobNav.hidden = !open;
      hamBtn.setAttribute('aria-expanded', String(open));
      hamBtn.textContent = open ? '✕' : '☰';
    });
    mobNav.addEventListener('click', (ev) => {
      if (ev.target.matches('a')) {
        mobNav.hidden = true;
        hamBtn.setAttribute('aria-expanded', 'false');
        hamBtn.textContent = '☰';
      }
    });
  }

  /* Parallax: three speed layers — blobs (far) > danmaku (mid) > cards (near) */
  let parallaxRAF = null;
  function tickParallax() {
    parallaxRAF = null;
    const bg = document.querySelector('.sg-bg');
    if (!bg) return;
    const section = bg.closest('.shelf-section');
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight;
    if (rect.bottom < -vh || rect.top > vh * 2) return;

    const dist = (vh / 2) - (rect.top + rect.height / 2);
    bg.style.transform = `translateY(${(dist * 0.42).toFixed(1)}px)`;
    const dm = section.querySelector('.danmaku');
    if (dm) dm.style.transform = `translateY(${(dist * 0.15).toFixed(1)}px)`;

    /* Hero wrap: scale + fade as rising card covers it */
    const hero = document.querySelector('.home-hero-wrap');
    if (hero) {
      const heroRect = hero.getBoundingClientRect();
      const coverPct = Math.max(0, Math.min(1, (heroRect.bottom - rect.top) / heroRect.height));
      hero.style.transform = `scale(${(1 - coverPct * 0.05).toFixed(4)})`;
      hero.style.opacity = (1 - coverPct * 0.35).toFixed(3);
    }
  }
  window.addEventListener('scroll', () => {
    if (!parallaxRAF) parallaxRAF = requestAnimationFrame(tickParallax);
  }, { passive: true });

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
          requestAnimationFrame(tickParallax);
        }));
      }
    }, 200);
  });

  $('#year').textContent = '© ' + new Date().getFullYear();
  updateAuthButton();
  route();
  refresh();

  const loaderEl = document.getElementById('loader');
  if (loaderEl) {
    setTimeout(() => {
      loaderEl.classList.add('loader--done');
      loaderEl.addEventListener('transitionend', () => loaderEl.remove(), { once: true });
    }, 2900);
  }
})();