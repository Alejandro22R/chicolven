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

  /* ---------- quality (keeps old TVs fluid) ----------
   * full: every effect. lite: transitions + floating products only. low: plain fades.
   * The player measures its own frame rate and steps down by itself when the TV can't keep up;
   * the choice is remembered on that TV. Force it with ?calidad=alta|media|baja in the URL.
   */
  var QUALITY_KEY = 'chicolven.player.quality';
  var QUALITY_PARAM = { alta: 'full', media: 'lite', baja: 'low' };
  var forcedQuality = (/[?&]calidad=(alta|media|baja)/.exec(location.search) || [])[1];
  var quality = forcedQuality ? QUALITY_PARAM[forcedQuality] : (function () {
    try { return localStorage.getItem(QUALITY_KEY) || 'full'; } catch (e) { return 'full'; }
  })();

  function effectiveQuality() {
    return payload && payload.screen.low_power ? 'low' : quality;
  }

  function setQuality(q) {
    if (q === quality) return;
    quality = q;
    try { localStorage.setItem(QUALITY_KEY, q); } catch (e) { /* ignore */ }
    fit();
  }

  /** Samples the frame rate in 5 s windows; two slow windows in a row step the quality down. */
  function watchFrameRate() {
    var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame;
    if (!raf || preview || forcedQuality) return;
    var frames = 0;
    var start = Date.now();
    var slowWindows = 0;
    function tick() {
      frames++;
      var elapsed = Date.now() - start;
      if (elapsed >= 5000) {
        var fps = frames * 1000 / elapsed;
        // Ignore windows where the page was hidden (rAF paused).
        if (elapsed < 7500) {
          var limit = quality === 'full' ? 40 : quality === 'lite' ? 24 : 0;
          slowWindows = fps < limit ? slowWindows + 1 : 0;
          if (slowWindows >= 2) {
            slowWindows = 0;
            setQuality(quality === 'full' ? 'lite' : 'low');
          }
        }
        frames = 0;
        start = Date.now();
      }
      if (quality !== 'low') raf(tick);
    }
    raf(tick);
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
    var q = effectiveQuality();
    document.body.className = (portrait ? 'portrait' : 'landscape') + (q === 'low' ? ' low-power' : q === 'lite' ? ' lite' : '');
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
    // A last page with few products uses fewer rows so the cards fill the screen.
    var rows = Math.max(1, Math.min(slide.rows, Math.ceil(slide.items.length / cols)));
    var w = (100 / cols) + '%';
    var h = (100 / rows) + '%';
    var html = '<div class="grid">';
    for (var i = 0; i < slide.items.length; i++) {
      var it = slide.items[i];
      var delay = 'animation-delay:' + (i * 0.12) + 's;-webkit-animation-delay:' + (i * 0.12) + 's';
      var later = 'animation-delay:' + (0.35 + i * 0.12) + 's;-webkit-animation-delay:' + (0.35 + i * 0.12) + 's';
      var floatDelay = 'animation-delay:-' + (i * 0.7) + 's;-webkit-animation-delay:-' + (i * 0.7) + 's';
      html += '<div class="cell" style="width:' + w + ';height:' + h + '">' +
        '<div class="card h' + (it.is_offer ? ' offer' : '') + (it.sold_out ? ' is-soldout' : '') + '" style="' + delay + '">' +
        '<div class="card-media" style="background-color:' + esc(slide.color) + '">' +
          '<div class="card-rays"></div><div class="card-glow"></div>' +
          (it.image
            ? '<div class="card-photo" style="' + floatDelay + '"><img src="' + esc(it.image) + '" alt=""></div>'
            : '<div class="ph">' + esc(initials(it.name)) + '</div>') +
          sealHtml(it) +
        '</div>' +
        '<div class="card-info">' +
          '<div class="card-top">' +
            '<span class="card-unit" style="' + later + '">Por ' + esc(it.unit) + '</span>' +
            '<div class="card-name fit" style="' + later + '">' + esc(it.name) + '</div>' +
          '</div>' +
          '<div class="card-tag" style="' + later + '">' + priceHtml(it, display) + '<span class="shine" style="' + floatDelay + '"></span></div>' +
        '</div>' +
        soldOutHtml(it) +
        '</div></div>';
    }
    return html + '</div>';
  }

  /*
   * Responsive pass, run once the slide is in the DOM: size every card from its real cell
   * (portrait, 720p, 4K, 2x2 or 4x3 all look the same) and shrink long names / prices
   * until they fit instead of being cut off.
   */
  function layoutSlide(el) {
    var cards = el.getElementsByClassName('card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var cell = card.parentNode;
      var cw = card.offsetWidth || cell.clientWidth;
      var ch = card.offsetHeight || cell.clientHeight;
      if (!cw || !ch) continue;
      var vertical = cw / ch < 1.2;
      card.className = card.className.replace(/\b[hv]\b/, vertical ? 'v' : 'h');
      // Reference design: 640x430 horizontal card -> 20px; 400x520 vertical card -> 20px.
      var base = vertical ? Math.min(cw / 20, ch / 26) : Math.min(cw / 32, ch / 21.5);
      card.style.fontSize = base.toFixed(2) + 'px';
    }
    var fits = el.getElementsByClassName('fit');
    for (var j = 0; j < fits.length; j++) fitText(fits[j], 0.45);
    var mains = el.querySelectorAll('.card-tag .main, .card-tag .sub, .card-tag .old, .hero-price .main, .hero-price .sub');
    for (var k = 0; k < mains.length; k++) fitWidth(mains[k], mains[k].parentNode.parentNode, 0.4);
  }

  /** Shrinks an element's font until its content fits its own box (multi-line names). */
  function fitText(node, minRatio) {
    node.style.fontSize = '';
    var start = parseFloat(window.getComputedStyle(node).fontSize);
    var size = start;
    // Tight line-heights let accents/descenders poke out a few px; that is not real overflow.
    while ((node.scrollHeight > node.clientHeight + size * 0.25 || node.scrollWidth > node.clientWidth + 1) && size > start * minRatio) {
      size *= 0.92;
      node.style.fontSize = size.toFixed(2) + 'px';
    }
  }

  /** Shrinks a single-line element until it is not wider than its container. */
  function fitWidth(node, container, minRatio) {
    node.style.fontSize = '';
    var start = parseFloat(window.getComputedStyle(node).fontSize);
    var size = start;
    var cs = window.getComputedStyle(container);
    var avail = container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    while (node.scrollWidth > avail + 1 && size > start * minRatio) {
      size *= 0.92;
      node.style.fontSize = size.toFixed(2) + 'px';
    }
  }

  /* Spotlight: highlights one card after another while a grid slide is on screen. */
  var spotTimer = null;
  function startSpotlight(el) {
    if (spotTimer) clearInterval(spotTimer);
    spotTimer = null;
    var cards = el.getElementsByClassName('card');
    if (cards.length < 2 || effectiveQuality() !== 'full') return;
    var i = -1;
    spotTimer = setInterval(function () {
      if (i >= 0 && cards[i]) cards[i].className = cards[i].className.replace(' spot', '');
      i = (i + 1) % cards.length;
      if (cards[i]) cards[i].className += ' spot';
    }, 2200);
  }

  function renderHero(slide, display, offers) {
    var it = slide.items[0];
    if (!it) return '';
    return '<div class="hero' + (it.sold_out ? ' is-soldout' : '') + '">' +
      '<div class="hero-img" style="background-color:' + esc(slide.color) + '"><div class="card-rays"></div><div class="card-glow"></div>' +
        (it.image ? '<div class="card-photo"><img src="' + esc(it.image) + '" alt=""></div>' : '<div class="ph">' + esc(initials(it.name)) + '</div>') +
        soldOutHtml(it) + '</div>' +
      '<div class="hero-info">' +
      (offers ? '<div class="offer-flag">¡Oferta!</div>' : '') +
      '<div class="hero-name fit">' + esc(it.name) + '</div>' +
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

  function logoSrc() {
    return (payload && payload.store.logo) || '/player/logo.svg';
  }

  /** Splits a title into words of animated letters (words never break across lines). */
  function lettersHtml(text) {
    var words = String(text).split(/\s+/);
    var html = '';
    var n = 0;
    for (var w = 0; w < words.length; w++) {
      if (!words[w]) continue;
      html += (html ? ' ' : '') + '<span class="w">';
      var word = words[w];
      for (var i = 0; i < word.length; i++) {
        var ch = word.charAt(i);
        var code = word.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF && i + 1 < word.length) ch += word.charAt(++i); // emoji
        var d1 = (0.5 + n * 0.045).toFixed(3) + 's';
        var d2 = (1.4 + n * 0.09).toFixed(3) + 's';
        html += '<span class="l" style="animation-delay:' + d1 + ',' + d2 + ';-webkit-animation-delay:' + d1 + ',' + d2 + '">' + esc(ch) + '</span>';
        n++;
      }
      html += '</span>';
    }
    return html;
  }

  var CONFETTI_COLORS = ['#FFD21F', '#8DC63F', '#2F5FD0', '#FFFFFF', '#D7191C'];
  function confettiHtml(count) {
    var html = '';
    for (var i = 0; i < count; i++) {
      var size = 1.2 + (i * 7 % 5) * 0.5;
      var round = i % 3 === 0 ? 'border-radius:50%;' : '';
      var dur = (7 + (i * 13 % 7)).toFixed(1);
      var delay = (-(i * 1.7) % 9).toFixed(1);
      html += '<span class="cf" style="left:' + ((i * 37) % 100) + '%;width:' + size + 'rem;height:' + (size * (i % 2 ? 1 : 1.8)) + 'rem;' + round +
        'background:' + CONFETTI_COLORS[i % CONFETTI_COLORS.length] + ';animation-duration:' + dur + 's;-webkit-animation-duration:' + dur +
        's;animation-delay:' + delay + 's;-webkit-animation-delay:' + delay + 's"></span>';
    }
    return html;
  }

  function renderPromo(slide) {
    var title = '<div class="promo-title fit">' + lettersHtml(slide.title) + '</div>' +
      (slide.subtitle ? '<div class="promo-sub">' + esc(slide.subtitle) + '</div>' : '');
    if (!slide.image) {
      // Welcome / announcement without photo: logo, sunburst, confetti and dancing letters.
      return '<div class="promo no-img"><div class="promo-burst"></div>' + confettiHtml(18) +
        '<div class="promo-text">' +
        '<div class="promo-logo"><span class="ring"></span><span class="ring r2"></span><img src="' + esc(logoSrc()) + '" alt=""></div>' +
        title + '</div></div>';
    }
    return '<div class="promo"><img class="promo-photo" src="' + esc(slide.image) + '" alt="">' +
      '<div class="promo-badge"><img src="' + esc(logoSrc()) + '" alt=""></div>' +
      '<div class="promo-text">' + title + '</div></div>';
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
    // Long category names shrink instead of running into the clock.
    h1.style.fontSize = '';
    var size = parseFloat(window.getComputedStyle(h1).fontSize);
    var min = size * 0.5;
    while (h1.scrollWidth > h1.clientWidth && size > min) {
      size *= 0.93;
      h1.style.fontSize = size.toFixed(2) + 'px';
    }
    $('title-bar').style.background = color || '#FFD21F';
  }

  var wipeCount = 0;

  /** Builds the overlay of brand-colored bands (+ logo) used between slides. */
  function makeWipe() {
    var el = document.createElement('div');
    el.className = 'wipe' + (wipeCount++ % 2 ? ' vert' : '');
    el.innerHTML = '<div class="wb wb1"></div><div class="wb wb2"></div><div class="wb wb3"></div><div class="wb wb4"></div>' +
      '<div class="wl"><img src="' + esc(logoSrc()) + '" alt=""></div>';
    return el;
  }

  function show(slide, instant) {
    var r = renderSlide(slide);
    var el = document.createElement('div');
    el.className = 'slide ' + r.cls;
    el.innerHTML = r.html;
    var title = slide.type === 'promo' ? (payload.screen.title || payload.store.name) : slide.title;
    var color = slide.type === 'promo' ? '#FFD21F' : slide.color;

    var old = currentEl;
    currentEl = el;
    var mount = function () {
      stage.appendChild(el);
      layoutSlide(el);
      startSpotlight(el);
      setTitle(title, color);
    };

    if (!old || instant || effectiveQuality() === 'low') {
      // First slide, instant refresh or low-power mode: simple cross-fade.
      mount();
      setTimeout(function () {
        el.className += ' active';
        if (old) {
          old.className += ' leave';
          setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 700);
        }
      }, 30);
      return;
    }

    // Colorful wipe: bands cover the screen, the logo pops, the slide is swapped underneath,
    // then the bands leave and reveal the new products.
    var wipe = makeWipe();
    stage.appendChild(wipe);
    setTimeout(function () { wipe.className += ' in'; }, 30);
    setTimeout(function () {
      if (old.parentNode) old.parentNode.removeChild(old);
      el.className += ' active';
      el.style.transition = el.style.webkitTransition = 'none';
      mount();
      wipe.className = wipe.className.replace(' in', ' out');
      setTimeout(function () { if (wipe.parentNode) wipe.parentNode.removeChild(wipe); }, 900);
    }, 1150);
  }

  function preload(slide) {
    if (!slide) return;
    var urls = slide.type === 'promo' ? [slide.image] : slide.items.map(function (i) { return i.image; });
    for (var i = 0; i < urls.length; i++) if (urls[i]) { var img = new Image(); img.src = urls[i]; }
  }

  function showIdle() {
    if (timer) clearTimeout(timer);
    if (spotTimer) clearInterval(spotTimer);
    timer = null;
    index = -1;
    stage.innerHTML = '<div class="idle"><img src="' + esc(logoSrc()) + '" alt=""><p>' +
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

  /**
   * Appearance settings from the panel. Written as a <style> block (no CSS variables: old TVs).
   * Sizes are relative to the design defaults (100 %).
   */
  var themeKey = '';
  function applyTheme(theme) {
    if (!theme) return;
    var key = JSON.stringify(theme) + (payload.screen.orientation || '');
    if (key === themeKey) return;
    themeKey = key;
    var hs = Math.max(0.5, Math.min(2, theme.header_logo_scale / 100));
    var ts = Math.max(0.5, Math.min(2, theme.transition_logo_scale / 100));
    var portrait = payload.screen.orientation === 'portrait';
    var logoH = 11.5 * hs;
    var wlW = Math.min(100 * ts, portrait ? 100 : 175);
    var wlH = Math.min(46 * ts, 80);
    var css =
      '.hdr{height:' + Math.max(13, logoH + 2.4).toFixed(1) + 'rem}' +
      '.hdr-logo{height:' + logoH.toFixed(1) + 'rem;max-width:' + ((portrait ? 32 : 50) * hs).toFixed(1) + 'rem}' +
      '.wl{width:' + wlW.toFixed(1) + 'rem;height:' + wlH.toFixed(1) + 'rem;margin:-' + (wlH / 2).toFixed(1) + 'rem 0 0 -' + (wlW / 2).toFixed(1) + 'rem}' +
      '.card{background:' + theme.card_bg_color + ';color:' + theme.card_text_color + '}';
    var el = $('theme');
    if (!el) {
      el = document.createElement('style');
      el.id = 'theme';
      document.getElementsByTagName('head')[0].appendChild(el);
    }
    el.textContent = css;
  }

  function renderChrome() {
    var p = payload;
    var logo = $('logo');
    var src = logoSrc();
    if (logo.getAttribute('src') !== src) logo.setAttribute('src', src);

    applyTheme(p.theme);

    var rateEl = $('rate');
    rateEl.className = 'ftr-rate rs-' + ((p.theme && p.theme.footer_rate_style) || 'red');
    if (p.rate) {
      var f = new Date(new Date(p.rate.fetched_at).getTime() + CARACAS_OFFSET_MS);
      var ed = p.rate.effective_date.split('-');
      rateEl.innerHTML = '<span class="r-label">' + (p.rate.is_manual ? 'Tasa del día' : 'Tasa BCV') + '</span>' +
        '<span class="r-val"><small>Bs</small>' + esc(p.rate.display) + '</span>' +
        '<span class="r-meta">' + (ed.length === 3 ? '<b>Vigente ' + ed[2] + '/' + ed[1] + '</b>' : '') +
        'Act. ' + pad(f.getUTCDate()) + '/' + pad(f.getUTCMonth() + 1) + ' ' + pad(f.getUTCHours()) + ':' + pad(f.getUTCMinutes()) + '</span>' +
        (p.rate.stale ? '<span class="r-warn"></span>' : '');
    } else {
      rateEl.innerHTML = '<span class="r-label">Precios</span><span class="r-val">USD</span>';
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

  window.addEventListener('resize', function () {
    fit();
    if (currentEl) layoutSlide(currentEl);
  });
  fit();
  tickClock();
  setInterval(tickClock, 10000);

  var cached = storageGet();
  if (cached && cached.slides) apply(cached, true);
  else showIdle();
  setOnline(false);

  load();
  connect();
  watchFrameRate();
  setInterval(load, POLL_MS);
  // Kiosk browsers left on for weeks leak memory; reload once a day at ~4am when online.
  setInterval(function () {
    var d = caracasNow();
    if (online && d.getUTCHours() === 4 && d.getUTCMinutes() < 10) location.reload();
  }, 10 * 60 * 1000);
})();
