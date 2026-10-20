/*
 * Chicolven TV player. Plain ES5 on purpose: it has to run on old Smart TV browsers.
 * - Fetches /api/player/:id (prices already formatted by the server; no money math here).
 * - Keeps the last content in localStorage, so the TV keeps showing prices if the server is down.
 * - Listens on a WebSocket for "content-changed" and refetches; reconnects with backoff.
 */
(function () {
  'use strict';

  var match = /\/tv\/(\d+)/.exec(location.pathname);
  var screenId = match ? match[1] : '1';
  var preview = /[?&]preview=1/.test(location.search); // admin thumbnails: not counted as a connected TV
  var CACHE_KEY = 'chicolven.player.' + screenId + (preview ? '.preview' : '');
  var POLL_MS = 5 * 60 * 1000;
  var CARACAS_OFFSET_MS = -4 * 3600 * 1000; // Venezuela is UTC-4 all year
  var DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  var $ = function (id) { return document.getElementById(id); };
  var app = $('app');
  var stage = $('stage');

  var payload = null;
  var slidesKey = '';
  var index = -1;
  var timer = null;
  var currentEl = null;
  var serverOffset = 0;
  var online = false;
  var ws = null;
  var wsRetry = 0;

  /* ---------- helpers ---------- */

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function caracasNow() { return new Date(Date.now() + serverOffset + CARACAS_OFFSET_MS); }

  function initials(name) {
    var words = String(name).split(/\s+/);
    return (words[0] ? words[0].charAt(0) : '') + (words[1] ? words[1].charAt(0) : '');
  }

  function storageGet() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { return null; }
  }

  function storageSet(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* storage full or blocked */ }
  }

  function get(url, ok, fail) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 15000;
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { ok(JSON.parse(xhr.responseText), xhr); } catch (e) { fail(e); }
      } else fail(new Error('HTTP ' + xhr.status));
    };
    xhr.onerror = xhr.ontimeout = function () { fail(new Error('network')); };
    xhr.send();
  }

  /* ---------- scaling ---------- */

  function fit() {
    var portrait = payload && payload.screen.orientation === 'portrait';
    var w = window.innerWidth;
    var h = window.innerHeight;
    var rotate = portrait && w > h; // TV outputs landscape but is mounted vertically
    var cw = rotate ? h : w;
    var ch = rotate ? w : h;
    var baseW = portrait ? 1080 : 1920;
    var baseH = portrait ? 1920 : 1080;
    var scale = Math.min(cw / baseW, ch / baseH);
    document.documentElement.style.fontSize = (10 * scale) + 'px';
    if (rotate) {
      app.className = 'rotated';
      app.style.width = cw + 'px';
      app.style.height = ch + 'px';
      app.style.transform = app.style.webkitTransform = 'translateX(' + w + 'px) rotate(90deg)';
    } else {
      app.className = '';
      app.style.width = app.style.height = '';
      app.style.transform = app.style.webkitTransform = '';
    }
    document.body.className = (portrait ? 'portrait' : 'landscape') + (payload && payload.screen.low_power ? ' low-power' : '');
  }

  /* ---------- rendering ---------- */

  function priceHtml(item, display) {
    var showUsd = display.show_usd || !item.bs;
    var showBs = display.show_bs && item.bs;
    var primaryBs = display.primary === 'bs' && showBs;
    var main = primaryBs ? item.bs : item.usd;
    var sub = primaryBs ? (showUsd ? item.usd : '') : (showBs ? item.bs : '');
    var old = primaryBs ? item.old_bs : item.old_usd;
    if (!showUsd && !showBs) return '';
    return '<div class="price">' +
      (old ? '<span class="old">' + esc(old) + '</span>' : '') +
      '<span class="main">' + esc(main) + '</span>' +
      (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') +
      '</div>';
  }

  function imageHtml(item, color, phSize) {
    if (item.image) return '<img src="' + esc(item.image) + '" alt="">';
    return '<div class="ph" style="background-color:' + esc(color) + ';' + (phSize ? 'font-size:' + phSize : '') + '">' + esc(initials(item.name)) + '</div>';
  }

  function sealHtml(item) {
    if (!item.badge) return '';
    var label = item.badge === 'oferta' ? 'Oferta' : item.badge === 'nuevo' ? 'Nuevo' : '¡Top!';
    return '<div class="seal ' + esc(item.badge) + '">' + label + '</div>';
  }

  function soldOutHtml(item) {
    return item.sold_out ? '<div class="soldout">AGOTADO</div>' : '';
  }

  function renderGrid(slide, display) {
    var cols = Math.max(1, slide.cols);
    var rows = Math.max(1, slide.rows);
    var dense = cols >= 4 || rows >= 3;
    var w = (100 / cols) + '%';
    var h = (100 / rows) + '%';
    var html = '<div class="grid' + (dense ? ' dense' : '') + '">';
    for (var i = 0; i < slide.items.length; i++) {
      var it = slide.items[i];
      html += '<div class="cell" style="width:' + w + ';height:' + h + '">' +
        '<div class="card' + (it.is_offer ? ' offer' : '') + (it.sold_out ? ' is-soldout' : '') + '" style="animation-delay:' + (i * 0.08) + 's;-webkit-animation-delay:' + (i * 0.08) + 's">' +
        '<div class="card-img">' + imageHtml(it, slide.color, dense ? '6rem' : '9rem') + '</div>' +
        '<div class="card-body"><div><div class="card-name">' + esc(it.name) + '</div><div class="unit">por ' + esc(it.unit) + '</div></div>' +
        '<div class="card-price">' + priceHtml(it, display) + '</div></div>' +
        sealHtml(it) + soldOutHtml(it) +
        '</div></div>';
    }
    return html + '</div>';
  }

  function renderHero(slide, display, offers) {
    var it = slide.items[0];
    if (!it) return '';
    return '<div class="hero' + (it.sold_out ? ' is-soldout' : '') + '">' +
      '<div class="hero-img">' + imageHtml(it, slide.color) + soldOutHtml(it) + '</div>' +
      '<div class="hero-info">' +
      (offers ? '<div class="offer-flag">¡Oferta!</div>' : '') +
      '<div class="hero-name">' + esc(it.name) + '</div>' +
      (it.description ? '<div class="hero-desc">' + esc(it.description) + '</div>' : '') +
      '<div class="unit">Precio por ' + esc(it.unit) + '</div>' +
      '<div class="hero-price">' + priceHtml(it, display) + '</div>' +
      '</div>' + (offers ? '' : sealHtml(it)) + '</div>';
  }

  function renderMenu(slide, display) {
    var feature = null;
    for (var i = 0; i < slide.items.length; i++) if (slide.items[i].image) { feature = slide.items[i]; break; }
    var cols = Math.max(1, Math.min(slide.cols, 3));
    var perCol = Math.max(1, slide.rows);
    var html = '<div class="menu">';
    var first = feature || slide.items[0];
    if (first) html += '<div class="menu-feature">' + imageHtml(first, slide.color) + '<div class="cap">' + esc(first.name) + '</div></div>';
    html += '<div class="menu-cols">';
    for (var c = 0; c < cols; c++) {
      var part = slide.items.slice(c * perCol, (c + 1) * perCol);
      if (!part.length && c > 0) break;
      html += '<div class="menu-col">';
      for (var r = 0; r < perCol; r++) {
        var it = part[r];
        if (!it) { html += '<div class="menu-row" style="border:0"></div>'; continue; }
        html += '<div class="menu-row' + (it.sold_out ? ' is-soldout' : '') + '" style="animation-delay:' + ((c * perCol + r) * 0.06) + 's;-webkit-animation-delay:' + ((c * perCol + r) * 0.06) + 's">' +
          '<span class="name">' + esc(it.name) + '</span>' +
          (it.is_offer ? '<span class="tag">Oferta</span>' : '') +
          '<span class="unit">' + esc(it.unit) + '</span>' +
          (it.sold_out ? '<span class="soldout" style="position:static;transform:none;-webkit-transform:none">AGOTADO</span>' : priceHtml(it, display)) +
          '</div>';
      }
      html += '</div>';
    }
    return html + '</div></div>';
  }

  function renderPromo(slide) {
    return '<div class="promo' + (slide.image ? '' : ' no-img') + '">' +
      (slide.image ? '<img src="' + esc(slide.image) + '" alt="">' : '') +
      '<div class="promo-text"><div class="promo-title">' + esc(slide.title) + '</div>' +
      (slide.subtitle ? '<div class="promo-sub">' + esc(slide.subtitle) + '</div>' : '') +
      '</div></div>';
  }

  function renderSlide(slide) {
    var display = payload.display;
    if (slide.type === 'promo') return { cls: 'slide-promo', html: renderPromo(slide) };
    if (slide.layout === 'grid') return { cls: 'slide-grid', html: renderGrid(slide, display) };
    if (slide.layout === 'menu') return { cls: 'slide-menu', html: renderMenu(slide, display) };
    if (slide.layout === 'offers') return { cls: 'slide-offers', html: renderHero(slide, display, true) };
    return { cls: 'slide-hero', html: renderHero(slide, display, false) };
  }

  function setTitle(text, color) {
    var h1 = $('title');
    if (h1.textContent !== text) {
      h1.textContent = text;
      h1.className = '';
      void h1.offsetWidth; // restart animation
      h1.className = 'swap';
    }
    $('title-bar').style.background = color || '#FFD21F';
  }

  function show(slide, instant) {
    var r = renderSlide(slide);
    var el = document.createElement('div');
    el.className = 'slide ' + r.cls + (instant ? ' instant' : '');
    el.innerHTML = r.html;
    stage.appendChild(el);
    setTitle(slide.type === 'promo' ? (payload.screen.title || payload.store.name) : slide.title,
      slide.type === 'promo' ? '#FFD21F' : slide.color);

    var old = currentEl;
    currentEl = el;
    // Next frame: start the enter transition.
    setTimeout(function () {
      el.className = el.className.replace(' instant', '') + ' active';
      if (old) {
        old.className += ' leave';
        setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 900);
      }
    }, 30);
  }

  function preload(slide) {
    if (!slide) return;
    var urls = slide.type === 'promo' ? [slide.image] : slide.items.map(function (i) { return i.image; });
    for (var i = 0; i < urls.length; i++) if (urls[i]) { var img = new Image(); img.src = urls[i]; }
  }

  function showIdle() {
    if (timer) clearTimeout(timer);
    timer = null;
    index = -1;
    stage.innerHTML = '<div class="idle"><img src="' + esc((payload && payload.store.logo) || '/player/logo.svg') + '" alt=""><p>' +
      (payload ? 'Pronto verás nuestros productos aquí' : 'Conectando con el servidor…') + '</p></div>';
    currentEl = null;
    setTitle(payload ? (payload.screen.title || payload.store.name) : 'Chicolven', '#FFD21F');
  }

  function next() {
    var slides = payload && payload.slides;
    if (!slides || !slides.length) { showIdle(); return; }
    index = (index + 1) % slides.length;
    var slide = slides[index];
    if (!currentEl) stage.innerHTML = '';
    show(slide, false);
    preload(slides[(index + 1) % slides.length]);
    if (timer) clearTimeout(timer);
    // A single slide never needs to rotate; re-render it periodically anyway to restart animations.
    timer = setTimeout(next, Math.max(3, slide.duration_s) * 1000);
  }

  function renderChrome() {
    var p = payload;
    var logo = $('logo');
    var logoSrc = p.store.logo || '/player/logo.svg';
    if (logo.getAttribute('src') !== logoSrc) logo.setAttribute('src', logoSrc);

    var rateEl = $('rate');
    if (p.rate) {
      var f = new Date(new Date(p.rate.fetched_at).getTime() + CARACAS_OFFSET_MS);
      var ed = p.rate.effective_date.split('-');
      rateEl.className = 'ftr-rate' + (p.rate.stale ? ' warn' : '');
      rateEl.innerHTML = (p.rate.is_manual ? 'Tasa del día' : 'Tasa BCV') + ' <b>Bs ' + esc(p.rate.display) + '</b>' +
        '<small>' + (ed.length === 3 ? 'vigente ' + ed[2] + '/' + ed[1] + ' · ' : '') +
        'act. ' + pad(f.getUTCDate()) + '/' + pad(f.getUTCMonth() + 1) + ' ' + pad(f.getUTCHours()) + ':' + pad(f.getUTCMinutes()) + '</small>';
    } else {
      rateEl.className = 'ftr-rate warn';
      rateEl.innerHTML = 'Precios en <b>USD</b>';
    }

    var ticker = $('ticker');
    var text = p.ticker || '';
    if (ticker.getAttribute('data-text') !== text) {
      ticker.setAttribute('data-text', text);
      ticker.innerHTML = text ? '<span>' + esc(text) + '</span><span>' + esc(text) + '</span>' : '';
      var seconds = Math.max(15, Math.round(text.length * 0.28));
      ticker.style.animationDuration = ticker.style.webkitAnimationDuration = seconds + 's';
    }
  }

  function apply(data, fromCache) {
    var oldKey = slidesKey;
    var oldOrientation = payload && payload.screen.orientation;
    var oldLow = payload && payload.screen.low_power;
    payload = data;
    slidesKey = JSON.stringify([data.slides, data.display]);
    if (oldOrientation !== data.screen.orientation || oldLow !== data.screen.low_power) fit();
    renderChrome();
    if (slidesKey === oldKey && timer) return; // only the footer changed (e.g. rate refreshed)
    // New content: show the change right away on the current position.
    if (!data.slides.length) { showIdle(); return; }
    index = Math.min(Math.max(index, 0), data.slides.length) - 1;
    if (fromCache) index = -1;
    next();
  }

  /* ---------- data & live updates ---------- */

  function setOnline(value) {
    online = value;
    $('status').className = 'ftr-status' + (online ? '' : ' offline');
  }

  function load() {
    get('/api/player/' + screenId + '?t=' + Date.now(), function (data, xhr) {
      var date = xhr.getResponseHeader('Date');
      if (data.generated_at) serverOffset = new Date(data.generated_at).getTime() - Date.now();
      else if (date) serverOffset = new Date(date).getTime() - Date.now();
      storageSet(data);
      setOnline(true);
      apply(data, false);
    }, function () {
      setOnline(false);
      if (!payload) showIdle();
    });
  }

  function connect() {
    if (!window.WebSocket) return; // fall back to polling only
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    try {
      ws = new WebSocket(proto + location.host + '/ws?role=player&screen=' + screenId + (preview ? '&preview=1' : ''));
    } catch (e) {
      scheduleReconnect();
      return;
    }
    ws.onopen = function () {
      wsRetry = 0;
      setOnline(true);
      load(); // catch up on anything missed while disconnected
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'content-changed') load();
      else if (msg.type === 'reload') location.reload();
      else if (msg.type === 'hello' && msg.server_time) serverOffset = new Date(msg.server_time).getTime() - Date.now();
    };
    ws.onclose = function () {
      setOnline(false);
      scheduleReconnect();
    };
    ws.onerror = function () { try { ws.close(); } catch (e) { /* ignore */ } };
  }

  function scheduleReconnect() {
    wsRetry = Math.min(wsRetry + 1, 6);
    setTimeout(connect, Math.pow(2, wsRetry) * 1000); // 2s … 64s
  }

  function tickClock() {
    var d = caracasNow();
    $('clock').textContent = pad(d.getUTCHours() % 12 || 12) + ':' + pad(d.getUTCMinutes()) + (d.getUTCHours() < 12 ? ' am' : ' pm');
    $('date').textContent = DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }

  /* ---------- start ---------- */

  window.addEventListener('resize', fit);
  fit();
  tickClock();
  setInterval(tickClock, 10000);

  var cached = storageGet();
  if (cached && cached.slides) apply(cached, true);
  else showIdle();
  setOnline(false);

  load();
  connect();
  setInterval(load, POLL_MS);
  // Kiosk browsers left on for weeks leak memory; reload once a day at ~4am when online.
  setInterval(function () {
    var d = caracasNow();
    if (online && d.getUTCHours() === 4 && d.getUTCMinutes() < 10) location.reload();
  }, 10 * 60 * 1000);
})();
