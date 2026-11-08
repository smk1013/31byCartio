/* 31 by Cartio — one pinned stage, one camera.
   Scroll drives a timeline of shots. Each shot places one or two studio stills
   in a frame (full screen or an editorial split) and moves a camera over them:
   holds, pushes, pull-backs, dolly tracks, wipes. Contact details are hidden
   inside the car (odometer, radio, mirror, plate, leather).                  */
(function () {
  'use strict';

  var PREVIEW = !!window.__PREVIEW__;
  var REDUCE = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cdnMeta = document.querySelector('meta[name="image-cdn"]');
  // Netlify features (image CDN, form handling) only exist on the Netlify site itself.
  var ON_NETLIFY = /^https?:$/.test(location.protocol) && /(\.netlify\.app|(^|\.)31bycartio\.com)$/.test(location.hostname);
  var USE_CDN = !PREVIEW && cdnMeta && cdnMeta.content === 'netlify' && ON_NETLIFY;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function seg(p, a, b) { return clamp((p - a) / (b - a), 0, 1); }
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  // Soft ease: half linear, half ease-in-out. Shots never fully stop at a seam, so the camera keeps flowing.
  function soft(t) { return .45 * t + .55 * ease(t); }
  function sm(t) { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  function imgUrl(src, w) {
    if (!src) return '';
    if (/^(data:|blob:|https?:)/.test(src)) return src;
    if (USE_CDN) return '/.netlify/images?url=' + encodeURIComponent(src) + '&w=' + w + '&q=80';
    return src.replace(/^\//, '');
  }
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.dataset.raw && t.getAttribute('src') !== t.dataset.raw.replace(/^\//, '')) { t.removeAttribute('srcset'); t.src = t.dataset.raw.replace(/^\//, ''); }
  }, true);

  /* ============================== SETTINGS ============================== */
  var S = { phone_display: '818-395-5765', phone: '+18183955765', text_phone: '+18183955765', email: 'alec@31bycartio.com', instagram: '31bycartio', facebook: '31bycartio', youtube: '31bycartio', locations: [] };
  function L() {
    return {
      tel: 'tel:' + S.phone, sms: 'sms:' + (S.text_phone || S.phone), mailto: 'mailto:' + S.email,
      // Profile pages open everywhere (app or browser, signed in or not); DM deep links don't.
      ig: 'https://www.instagram.com/' + S.instagram + '/', ig_dm: 'https://www.instagram.com/' + S.instagram + '/',
      fb: 'https://www.facebook.com/' + S.facebook, fb_dm: 'https://www.facebook.com/' + S.facebook,
      yt: 'https://www.youtube.com/@' + S.youtube
    };
  }
  function mapUrl(l) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(l.address || l.name); }
  function applySettings(s) {
    Object.keys(s || {}).forEach(function (k) { if (s[k] !== '' && s[k] != null) S[k] = s[k]; });
    if (s && s.facebook === '') S.facebook = '';
    var links = L();
    $$('[data-bind]').forEach(function (el) {
      var k = el.getAttribute('data-bind');
      if (el.tagName === 'A' && links[k]) el.href = links[k];
      else if (typeof S[k] === 'string') el.textContent = S[k];
    });
    if (!S.facebook) $$('[data-bind="fb"],[data-bind="fb_dm"]').forEach(function (a) { a.style.display = 'none'; });
    if (Array.isArray(S.locations) && S.locations.length) {
      var locHtml = S.locations.map(function (l) { return '<a href="' + esc(mapUrl(l)) + '" target="_blank" rel="noopener">' + esc(l.name) + '</a>'; }).join(' and ');
      $$('[data-locations]').forEach(function (el) { el.innerHTML = locHtml; });
    }
    $$('[data-handle]').forEach(function (el) { var k = el.getAttribute('data-handle'); if (S[k]) el.textContent = (k === 'facebook' ? '/' : '@') + S[k]; });
    if (S.logo) $$('[data-logo],[data-logo-large]').forEach(function (i) { i.src = imgUrl(S.logo, 1600); });
    var digits = String(S.phone_display || '').replace(/\D/g, '');
    if (digits.length >= 10) { var d = digits.slice(-10); setOdo(d.slice(0, 6), d.slice(6)); }
    buildObc();
  }

  /* ============================ 7-SEGMENT LCD ============================ */
  var SEGS = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcfgd', '-': 'g', ' ': '' };
  function hs(x0, x1, y) { var t = 1.05; return [[x0, y], [x0 + t, y - t], [x1 - t, y - t], [x1, y], [x1 - t, y + t], [x0 + t, y + t]]; }
  function vs(x, y0, y1) { var t = 1.05; return [[x, y0], [x + t, y0 + t], [x + t, y1 - t], [x, y1], [x - t, y1 - t], [x - t, y0 + t]]; }
  var GEOM = { a: hs(2.4, 7.6, 1.3), g: hs(2.4, 7.6, 9), d: hs(2.4, 7.6, 16.7), f: vs(1.7, 1.9, 8.4), b: vs(8.3, 1.9, 8.4), e: vs(1.7, 9.6, 16.1), c: vs(8.3, 9.6, 16.1) };
  function poly(pts, dx) { return pts.map(function (p) { return (p[0] + dx).toFixed(2) + ',' + p[1].toFixed(2); }).join(' '); }
  function seg7(str, slots, vbw) {
    if (slots) str = (new Array(slots + 1).join(' ') + str).slice(-slots);
    var x = 0, out = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === '.') { out += '<rect class="on" x="' + (x - 1.4) + '" y="15.6" width="1.8" height="1.8"/>'; continue; }
      var on = SEGS[ch] || '';
      'abcdefg'.split('').forEach(function (k) { out += '<polygon class="' + (on.indexOf(k) >= 0 ? 'on' : 'off') + '" points="' + poly(GEOM[k], x) + '"/>'; });
      x += 11;
    }
    var vw = vbw || x + .5;
    return '<svg class="seg7" viewBox="' + (x - vw) + ' 0 ' + vw + ' 18" preserveAspectRatio="xMaxYMid meet" aria-hidden="true"><g transform="skewX(-5) translate(1.2 0)">' + out + '</g></svg>';
  }
  function setOdo(a, b) { var o1 = $('#odo-a'), o2 = $('#odo-b'); if (o1) o1.innerHTML = seg7(a, 6, 66.5); if (o2) o2.innerHTML = seg7(b, 5, 61); }

  /* ================================ SCENES ================================ */
  // w/h = the still's original pixel size; every coordinate below uses those pixels.
  var SC = {
    heroOff: { file: 'hero-off', w: 1672, h: 941, focus: [830, 470], mfit: .97 },
    heroOn: { file: 'hero-on', w: 1672, h: 941, focus: [830, 470], mfit: .97 },
    lamp: { file: 'lamp', w: 1448, h: 1086, focus: [690, 520] },
    corner: { file: 'corner', w: 1448, h: 1086, focus: [820, 560] },
    rearwheel: { file: 'rearwheel', w: 1448, h: 1086, focus: [640, 640] },
    rear: { file: 'rear', w: 1672, h: 941, focus: [820, 470] },
    cabin: { file: 'cabin', w: 1536, h: 1024, focus: [768, 520] },
    cluster: { file: 'cluster', w: 1536, h: 1024, focus: [760, 470] },
    driver: { file: 'driver', w: 1672, h: 941, focus: [836, 470] },
    console: { file: 'console', w: 1024, h: 1536, focus: [512, 700] },
    backseat: { file: 'backseat', w: 1672, h: 941, focus: [836, 470] },
    bonnet: { file: 'bonnet', w: 1448, h: 1086, focus: [780, 470] },
    headon: { file: 'headon', w: 1448, h: 1086, focus: [724, 470] },
    engine: { file: 'engine', w: 1448, h: 1086, focus: [720, 560] },
    steer: { file: 'corner', w: 1448, h: 1086, focus: [930, 640] },
    passenger: { file: 'passenger', w: 1536, h: 1024, focus: [1010, 640] },
    glass: { file: 'rear', w: 1672, h: 941, focus: [560, 420] },
    dash: { file: 'cabin-clock', w: 1536, h: 1024, focus: [720, 470] },
    stock: { file: 'hero-on', w: 1672, h: 941, focus: [830, 470], mfit: .97 },
    story: { file: 'hero-off', w: 1672, h: 941, focus: [700, 470], mfit: .97 },
    finale: { file: 'hero-on', w: 1672, h: 941, focus: [830, 470], mfit: .97 }
  };
  var OVERLAYS = {
    headon: '<div class="hood" style="left:60px;top:240px;width:1330px;height:238px">' +
      '<div class="hood-bay"><img src="assets/photos/engine.webp" alt="" decoding="async"></div>' +
      '<div class="hood-flap"><i class="hood-top"></i><i class="hood-under"></i></div></div>',
    // data-quad = the four corners (top-left, top-right, bottom-right, bottom-left) measured on the photo;
    // the element is drawn flat at its own size and mapped onto those corners in perspective.
    rear: '<div class="ov ov-plate" data-quad="1233,412 1383,414 1395,475.5 1240.5,481" style="width:240px;height:120px"><b>California</b><span>31 CARTIO</span><i>E31 SPECIALIST</i>' +
      '<u style="left:19%;top:8%"></u><u style="right:19%;top:8%"></u><u style="left:19%;bottom:8%"></u><u style="right:19%;bottom:8%"></u></div>',
    cluster: '<a class="ov ov-odo-link" data-bind="tel" data-lit="odo" href="tel:+18183955765" aria-label="Call us" style="left:972px;top:402px;width:160px;height:52px">' +
      '<span class="odo-w" style="left:8px;top:10px;width:70px;height:29px;-webkit-mask-image:url(assets/img/mask-odo.png);mask-image:url(assets/img/mask-odo.png)"><span class="ov-odo" id="odo-a" data-quad="3.1,3 67.4,4.7 66.9,25.6 3.6,23.7" style="width:128px;height:42px"></span></span>' +
      '<span class="odo-w" style="left:87px;top:14px;width:62px;height:28px"><span class="ov-odo" id="odo-b" data-quad="2.7,2.6 59.6,5.4 59.3,26.1 2.1,22.6" style="width:114px;height:40px"></span></span></a>',
    console: '<a class="ov ov-lcd" id="obc" data-lit="radio" data-quad="190,520 619,512 618,553.5 190,565" href="https://www.instagram.com/31bycartio/" target="_blank" rel="noopener" aria-label="31 by Cartio on Instagram" style="width:430px;height:48px"><span id="obc-text">31 BY CARTIO</span><i>ST</i></a>',
    backseat: '<div class="ov ov-mirror" style="left:726px;top:127px;width:226px;height:42px"><span>31 BY CARTIO</span></div>' +
      '<div class="ov ov-emboss" style="left:130px;top:752px;width:172px;height:74px"><i class="e-sh"></i><i class="e-hi"></i><i class="e-base"></i></div>'
  };

  /* ============================== TIMELINE ============================== */
  var REST = { rest: true };
  function K(x, y, w, cap) { return { c: [x, y], w: w, cap: cap || false }; }
  function R(o) { var r = { rest: true }; for (var k in o) r[k] = o[k]; return r; }

  var CAM = {
    hero: R({ k: 1.04, dy: .02 }),
    podNear: K(760, 430, 760), podP: K(756, 447, 565),
    rwP: K(835, 520, 725), winP: K(460, 245, 260), clP: K(547, 475, 934),
    odo: K(1051, 428, 560, 1), odoP: K(795, 386, 726),
    drvConsole: K(1300, 560, 900), radioP: K(1283, 488, 436), radio: K(435, 560, 700, 1),
    bsRadioP: K(845, 495, 330), mirror: K(838, 150, 520, 1), leather: K(233, 740, 600, 'r'), leatherIn: K(216, 789, 380),
    kb0: R({ k: 1.0 }), kb1: R({ k: .88 }), kbIn: R({ k: 1.1 }),
    stock: R({ k: 1.0 }), final0: R({ k: .94 }), final1: R({ k: 1.06 })
  };

  function hold(s, cam, d, o) { return ext({ t: 'hold', s: s, cam: cam, d: d }, o); }
  function move(s, a, b, d, o) { return ext({ t: 'move', s: s, from: a, to: b, d: d }, o); }
  function xin(a, from, portal, b, to, d, o) { return ext({ t: 'in', a: a, from: from, portal: portal, b: b, to: to, d: d }, o); }
  function xout(a, from, b, portal, to, d, o) { return ext({ t: 'out', a: a, from: from, portal: portal, b: b, to: to, d: d }, o); }
  function x(A, B, d, o) { return ext({ t: 'x', A: A, B: B, d: d }, o); }
  // Camera tracks sideways past the car: the outgoing still keeps sliding and the next one arrives
  // already moving the same way, with a soft motion blur where they cross.
  // Every sideways move is paired with a slight push-in so there is always picture beyond the frame edge.
  var DRIFT = R({ k: .95, dx: .025 });
  function track(a, b, d, o) {
    return x({ s: a, c0: DRIFT, c1: R({ k: .8, dx: .12 }), o: [.42, .92], blur: 1, lin: 1 }, { s: b, c0: R({ k: .8, dx: -.12 }), c1: REST, o: [.08, .58], blur: 1, lin: 1 }, d, o);
  }
  // Chapter to chapter: the slow zoom keeps going while the frame glides on to the next car.
  function wipe(a, b, d, o) {
    return x({ s: a, c0: CAM.kb1, c1: R({ k: .78, dx: .1 }), box: 'split', o: [.4, .92], blur: 1 }, { s: b, c0: R({ k: .85, dx: -.08 }), c1: CAM.kb0, box: 'split', o: [.08, .6], blur: 1 }, d, o);
  }
  function ext(a, b) { for (var k in b) a[k] = b[k]; return a; }

  var SEG = [
    hold('heroOff', CAM.hero, 55, { cap: 'hero', ch: 'hero' }),
    x({ s: 'heroOff', c0: CAM.hero, c1: CAM.hero, o: [.62, .8] }, { s: 'heroOn', c0: CAM.hero, c1: CAM.hero, o: [.32, .58] }, 45, { flash: .4 }),
    move('heroOn', CAM.hero, CAM.podNear, 40),
    xin('heroOn', CAM.podNear, CAM.podP, 'lamp', REST, 80),
    move('lamp', REST, DRIFT, 45, { cap: 'lamp', lin: 1 }),
    track('lamp', 'corner', 90),
    move('corner', REST, DRIFT, 45, { cap: 'corner', lin: 1 }),
    track('corner', 'rearwheel', 90),
    xout('rearwheel', REST, 'rear', CAM.rwP, REST, 90),
    move('rear', REST, R({ k: .95 }), 55, { cap: 'step', ch: 'inside', detail: 'plate', lin: 1 }),
    xin('rear', R({ k: .95 }), CAM.winP, 'cabin', REST, 90),
    move('cabin', REST, R({ k: .95 }), 40, { cap: 'look', lin: 1 }),
    xin('cabin', R({ k: .95 }), CAM.clP, 'cluster', REST, 80),
    move('cluster', REST, CAM.odo, 35, { cap: 'odo' }),
    hold('cluster', CAM.odo, 55, { cap: 'odo', ch: 'gauges', detail: 'odo' }),
    xout('cluster', CAM.odo, 'driver', CAM.odoP, REST, 90),
    move('driver', REST, CAM.drvConsole, 35),
    xin('driver', CAM.drvConsole, CAM.radioP, 'console', CAM.radio, 80, { cap: 'radio' }),
    hold('console', CAM.radio, 60, { cap: 'radio', ch: 'radio', detail: 'radio' }),
    xout('console', CAM.radio, 'backseat', CAM.bsRadioP, REST, 90),
    move('backseat', REST, CAM.mirror, 35, { cap: 'mirror' }),
    hold('backseat', CAM.mirror, 40, { cap: 'mirror', detail: 'mirror' }),
    move('backseat', CAM.mirror, CAM.leather, 40, { cap: 'leather' }),
    hold('backseat', CAM.leather, 50, { cap: 'leather', ch: 'leather', detail: 'leather' }),
    x({ s: 'backseat', c0: CAM.leather, c1: CAM.leatherIn, o: [.3, .8], blur: 1 }, { s: 'bonnet', c0: R({ k: .9, dx: -.05 }), c1: CAM.kb0, box: 'full', box1: 'split', o: [.06, .52], blur: 1 }, 85),
    move('bonnet', CAM.kb0, CAM.kb1, 85, { box: 'split', cap: 'paint', ch: 'paint' }),
    wipe('bonnet', 'headon', 70),
    move('headon', CAM.kb0, CAM.kb1, 45, { box: 'split', cap: 'engines', ch: 'engines' }),
    move('headon', CAM.kb1, K(724, 500, 1000), 130, { box: 'split', cap: 'engines', hood: 1 }),
    x({ s: 'headon', c0: K(724, 500, 1000), c1: K(724, 380, 470), box: 'split', o: [.5, .95], blur: 1 }, { s: 'engine', c0: R({ k: 1 }), c1: R({ k: .94 }), box: 'split', o: [.36, .88], blur: 1 }, 90, { cap: 'engines' }),
    move('engine', R({ k: .94 }), CAM.kb1, 60, { box: 'split', cap: 'engines' }),
    wipe('engine', 'steer', 70),
    move('steer', CAM.kb0, CAM.kb1, 85, { box: 'split', cap: 'steering', ch: 'steering' }),
    wipe('steer', 'passenger', 70),
    move('passenger', CAM.kb0, CAM.kb1, 85, { box: 'split', cap: 'interior', ch: 'interior' }),
    wipe('passenger', 'glass', 70),
    move('glass', CAM.kb0, CAM.kb1, 85, { box: 'split', cap: 'sunroof', ch: 'sunroof' }),
    wipe('glass', 'dash', 70),
    move('dash', CAM.kb0, CAM.kb1, 85, { box: 'split', cap: 'wiring', ch: 'wiring' }),
    x({ s: 'dash', c0: CAM.kb1, c1: CAM.kb1, box: 'split', box1: 'full', o: [.55, .95] }, { s: 'stock', c0: R({ k: 1.12 }), c1: CAM.stock, o: [.4, .92], blur: 1 }, 85),
    hold('stock', CAM.stock, 150, { cap: 'stock', ch: 'stock', lineup: true, dim: .6 }),
    x({ s: 'stock', c0: CAM.stock, c1: R({ k: .9 }), o: [.25, .8], blur: 1 }, { s: 'story', c0: R({ k: .9, dx: .05 }), c1: CAM.kb0, box: 'full', box1: 'story', o: [.05, .5], blur: 1 }, 85),
    move('story', CAM.kb0, CAM.kb1, 75, { box: 'story', cap: 'story', ch: 'story' }),
    x({ s: 'story', c0: CAM.kb1, c1: CAM.final0, box: 'story', box1: 'full', o: [.6, .9] }, { s: 'finale', c0: CAM.final0, c1: CAM.final0, o: [.45, .85], blur: 1 }, 85, { flash: .55 }),
    move('finale', CAM.final0, CAM.final1, 80, { cap: 'contact', ch: 'contact', end: true, dim: .45 })
  ];
  var CHAPTERS = [
    ['hero', 'Studio'], ['inside', 'Step inside'], ['gauges', 'Gauges'], ['radio', 'Electronics'], ['leather', 'Leather'],
    ['paint', 'Paint & body'], ['engines', 'Engines'], ['steering', 'Steering'], ['interior', 'Interior'], ['sunroof', 'Sunroof & glass'],
    ['wiring', 'Wiring'], ['stock', 'For sale'], ['story', 'Story'], ['contact', 'Contact']
  ];
  var DETAILS = {
    plate: { name: 'The plate on the 850Ci', hint: 'Behind the car, before you step inside.' },
    odo: { name: 'Our number on the odometer', hint: 'In the gauges.' },
    radio: { name: 'The radio display', hint: 'On the center console.' },
    mirror: { name: 'The name in the mirror', hint: 'Look up from the back seat.' },
    leather: { name: 'The badge pressed into the leather', hint: 'On the driver\'s seat.' }
  };
  var DKEYS = Object.keys(DETAILS);

  var acc = 0;
  SEG.forEach(function (s, i) { s.u0 = acc; acc += s.d; s.u1 = acc; s.i = i; });
  var TOTAL = acc;
  window.__journey = { total: TOTAL, segs: SEG.map(function (s) { return [s.u0, s.u1, s.cap || s.t, s.ch || '']; }) };

  /* ============================== BUILD STAGE ============================== */
  var stage = $('#stage'), journey = $('#journey'), layersBox = $('#layers');
  var layers = {}, loadQueue = [];
  Object.keys(SC).forEach(function (k, i) {
    var sc = SC[k];
    var fr = document.createElement('div'); fr.className = 'frame';
    var ph = document.createElement('div'); ph.className = 'ph'; ph.style.width = sc.w + 'px'; ph.style.height = sc.h + 'px';
    var img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.draggable = false;
    var src = (window.__ASSET__ && window.__ASSET__[sc.file]) || ('assets/photos/' + sc.file + '.webp');
    if (i < 3) img.src = src; else loadQueue.push([img, src]);
    if (i === 0) {
      var reveal = function () { document.documentElement.classList.remove('intro'); };
      if (img.complete) setTimeout(reveal, 60); else { img.addEventListener('load', reveal); img.addEventListener('error', reveal); }
      setTimeout(reveal, 2200);
    }
    ph.appendChild(img);
    var ov = document.createElement('div'); ov.className = 'ovl'; ov.style.width = sc.w + 'px'; ov.style.height = sc.h + 'px';
    ov.innerHTML = OVERLAYS[k] || '';
    fr.appendChild(ph); fr.appendChild(ov); layersBox.appendChild(fr);
    layers[k] = { fr: fr, ph: ph, ov: ov, on: false, used: false };
  });
  function drain() { var it = loadQueue.shift(); if (!it) return; it[0].onload = it[0].onerror = function () { setTimeout(drain, 0); }; it[0].src = it[1]; }
  window.addEventListener('load', function () { drain(); drain(); drain(); });
  setTimeout(function () { drain(); drain(); }, 2500);

  // Projective transform that maps a w x h box onto four measured corners (CSS matrix3d).
  function homography(w, h, q) {
    var src = [[0, 0], [w, 0], [w, h], [0, h]], A = [], i, j, k;
    for (i = 0; i < 4; i++) {
      var x0 = src[i][0], y0 = src[i][1], X = q[i][0], Y = q[i][1];
      A.push([x0, y0, 1, 0, 0, 0, -x0 * X, -y0 * X, X]);
      A.push([0, 0, 0, x0, y0, 1, -x0 * Y, -y0 * Y, Y]);
    }
    for (i = 0; i < 8; i++) {
      var p = i; for (j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
      var tmp = A[i]; A[i] = A[p]; A[p] = tmp;
      for (j = i + 1; j < 8; j++) { var f = A[j][i] / A[i][i]; for (k = i; k < 9; k++) A[j][k] -= f * A[i][k]; }
    }
    var hh = new Array(8);
    for (i = 7; i >= 0; i--) { var sum = A[i][8]; for (j = i + 1; j < 8; j++) sum -= A[i][j] * hh[j]; hh[i] = sum / A[i][i]; }
    return [hh[0], hh[3], 0, hh[6], hh[1], hh[4], 0, hh[7], 0, 0, 1, 0, hh[2], hh[5], 0, 1];
  }
  $$('[data-quad]').forEach(function (el) {
    var q = el.getAttribute('data-quad').split(' ').map(function (p) { return p.split(',').map(Number); });
    el.style.left = '0px'; el.style.top = '0px'; el.style.transformOrigin = '0 0';
    el.style.transform = 'matrix3d(' + homography(parseFloat(el.style.width), parseFloat(el.style.height), q).map(function (v) { return +v.toFixed(8); }).join(',') + ')';
  });

  var embossSrc = (window.__ASSET__ && window.__ASSET__.badge) || 'assets/img/logo-badge-400.png';
  $$('.ov-emboss i').forEach(function (i) { i.style.webkitMaskImage = i.style.maskImage = 'url("' + embossSrc + '")'; });

  var caps = {};
  $$('.cap').forEach(function (c) { caps[c.dataset.cap] = { el: c, u0: Infinity, u1: -Infinity }; });
  SEG.forEach(function (s) { if (s.cap && caps[s.cap]) { caps[s.cap].u0 = Math.min(caps[s.cap].u0, s.u0); caps[s.cap].u1 = Math.max(caps[s.cap].u1, s.u1); } });

  var chapNav = $('#chapters');
  chapNav.innerHTML = CHAPTERS.map(function (c) { return '<button type="button" data-go="' + c[0] + '"><span>' + esc(c[1]) + '</span></button>'; }).join('');
  var chapBtns = $$('button', chapNav);

  /* ================================ CAMERA ================================ */
  var W = 0, H = 0, VH = 0, layout = 'd', NAVH = 64;
  function box(name) {
    if (!name || name === 'full') return [0, 0, W, H];
    if (layout === 'd') {
      if (name === 'split') return [W * .44, NAVH + H * .05, W * .5, H * .84 - NAVH];
      if (name === 'story') return [W * .04, NAVH + H * .05, W * .5, H * .84 - NAVH];
    }
    return [W * .05, NAVH + H * .02, W * .9, H * .42];
  }
  function mixBox(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)]; }
  function isFull(b) { return b[0] < .5 && b[1] < .5 && b[2] > W - 1 && b[3] > H - 1; }

  function resolve(scene, spec, bx) {
    var sc = SC[scene], bw = bx[2], bh = bx[3], asp = bh / bw, r;
    var full = isFull(bx);
    if (spec.rest) {
      var coverW = Math.min(sc.w, sc.h / asp);
      var w = coverW;
      if (full) {
        var maxScale = layout === 'd' ? 2.4 : 2.8;
        w = Math.max(coverW, bw / maxScale);
        if (layout === 'm' && sc.w / sc.h > 1) w = Math.max(w, sc.w * (sc.mfit || .8));
      }
      var h = w * asp;
      var cx = sc.focus[0], cy = sc.focus[1];
      if (w <= sc.w) cx = clamp(cx, w / 2, sc.w - w / 2); else cx = sc.w / 2;
      if (h <= sc.h) cy = clamp(cy, h / 2, sc.h - h / 2); else cy = sc.h / 2;
      r = { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
      if (spec.k) { var k = spec.k; r = { x: r.x - r.w * (k - 1) / 2, y: r.y - r.h * (k - 1) / 2, w: r.w * k, h: r.h * k }; }
      if (spec.dx) r.x += r.w * spec.dx;
      if (spec.dy) r.y += r.h * spec.dy;
    } else {
      var w2 = spec.w, h2 = w2 * asp;
      r = { x: spec.c[0] - w2 / 2, y: spec.c[1] - h2 / 2, w: w2, h: h2 };
    }
    // Leave room for the caption: left captions push the subject right, 'r' captions push it left.
    if (spec.cap && full) { if (layout === 'd') r.x += (spec.cap === 'r' ? 1 : -1) * r.w * .17; else r.y += r.h * .2; }
    return r;
  }
  function mixRect(A, B, t, asp) {
    var w = Math.exp(lerp(Math.log(A.w), Math.log(B.w), t));
    var cx = lerp(A.x + A.w / 2, B.x + B.w / 2, t), cy = lerp(A.y + A.h / 2, B.y + B.h / 2, t);
    var h = w * asp;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }
  function scr(rect, cam) { var s = W / cam.w; return { x: (rect.x - cam.x) * s, y: (rect.y - cam.y) * s, w: rect.w * s, h: rect.h * s }; }
  function mapTo(rect, target) { var s = target.w / rect.w; var w = W / s; return { x: rect.x - target.x / s, y: rect.y - target.y / s, w: w, h: w * H / W }; }

  function place(name, cam, bx, op, z, wipeT, blur) {
    var Ly = layers[name], s = bx[2] / cam.w;
    var tf = 'translate3d(' + (bx[0] - cam.x * s).toFixed(2) + 'px,' + (bx[1] - cam.y * s).toFixed(2) + 'px,0) scale(' + s.toFixed(5) + ')';
    Ly.ph.style.transform = tf; Ly.ov.style.transform = tf;
    var top = bx[1];
    if (wipeT != null) top = bx[1] + bx[3] * (1 - wipeT);
    var clip = (isFull(bx) && wipeT == null) ? 'none' : 'inset(' + top.toFixed(1) + 'px ' + (W - bx[0] - bx[2]).toFixed(1) + 'px ' + (H - bx[1] - bx[3]).toFixed(1) + 'px ' + bx[0].toFixed(1) + 'px round 3px)';
    Ly.fr.style.clipPath = clip; Ly.fr.style.webkitClipPath = clip;
    Ly.fr.style.opacity = op.toFixed(3);
    var bl = blur > .02 ? (blur * BLUR).toFixed(2) : 0;
    if (bl !== Ly.bl) { Ly.fr.style.filter = bl ? 'blur(' + bl + 'px)' : ''; Ly.bl = bl; }
    Ly.fr.style.zIndex = z;
    // On phones a full-screen still is shorter than the screen: fade its top and bottom into the studio.
    var fe = layout === 'm' ? clamp((bx[3] - H * .42) / (H * .58), 0, 1) : 0;
    if (fe !== Ly.fe) { Ly.ph.style.setProperty('--fe', fe.toFixed(3)); Ly.fe = fe; }
    Ly.ov.style.pointerEvents = op > .9 ? 'auto' : 'none';
    Ly.used = true;
  }
  var BLUR = 0;
  function findSeg(u) { for (var i = 0; i < SEG.length; i++) if (u < SEG[i].u1) return SEG[i]; return SEG[SEG.length - 1]; }

  function render(u) {
    for (var k0 in layers) layers[k0].used = false;
    var sg = findSeg(u), t = clamp((u - sg.u0) / sg.d, 0, 1), FULL = box('full');
    if (sg.t === 'hold' || sg.t === 'move') {
      var bx = box(sg.box), asp = bx[3] / bx[2];
      var cam = sg.t === 'hold' ? resolve(sg.s, sg.cam, bx) : mixRect(resolve(sg.s, sg.from, bx), resolve(sg.s, sg.to, bx), sg.box || sg.lin ? t : soft(t), asp);
      if (sg.t === 'hold') { var kk = 1 - .02 * Math.sin(Math.PI * t); cam = { x: cam.x + cam.w * (1 - kk) / 2, y: cam.y + cam.h * (1 - kk) / 2, w: cam.w * kk, h: cam.h * kk }; }
      place(sg.s, cam, bx, 1, 2);
    } else if (sg.t === 'in') {
      var A0 = resolve(sg.a, sg.from, FULL), P = resolve(sg.a, sg.portal, FULL), B0 = resolve(sg.b, sg.to, FULL);
      var ca = mixRect(A0, P, soft(t), H / W);
      var cb = mapTo(B0, scr(P, ca));
      place(sg.a, ca, FULL, 1 - sm(seg(t, .62, 1)), 2, null, .7 * sm(seg(t, .4, .95)));
      place(sg.b, cb, FULL, sm(seg(t, .22, .82)), 4, null, .7 * (1 - sm(seg(t, .3, .92))));
    } else if (sg.t === 'out') {
      var A1 = resolve(sg.a, sg.from, FULL), P2 = resolve(sg.b, sg.portal, FULL), B1 = resolve(sg.b, sg.to, FULL);
      var cb2 = mixRect(P2, B1, soft(t), H / W);
      var ca2 = mapTo(A1, scr(P2, cb2));
      place(sg.b, cb2, FULL, sm(seg(t, 0, .3)), 2, null, .7 * (1 - sm(seg(t, .15, .85))));
      place(sg.a, ca2, FULL, 1 - sm(seg(t, .1, .82)), 4, null, .7 * sm(seg(t, .05, .7)));
    } else if (sg.t === 'x') {
      [['A', 2], ['B', 4]].forEach(function (pair) {
        var L1 = sg[pair[0]], te = L1.lin ? t : soft(t);
        var b0 = box(L1.box), b1 = L1.box1 ? box(L1.box1) : b0, bxx = mixBox(b0, b1, te);
        var c = mixRect(resolve(L1.s, L1.c0, bxx), resolve(L1.s, L1.c1, bxx), te, bxx[3] / bxx[2]);
        var op = 1;
        if (L1.o) op = pair[0] === 'A' ? 1 - sm(seg(t, L1.o[0], L1.o[1])) : sm(seg(t, L1.o[0], L1.o[1]));
        var w = L1.wipe ? ease(seg(t, L1.wipe[0], L1.wipe[1])) : null;
        if (w === 0) op = 0;
        var bl = L1.blur ? Math.pow(Math.sin(Math.PI * seg(t, .04, .96)), 1.6) : 0;
        place(L1.s, c, bxx, op, pair[1], w, bl);
      });
    }
    for (var k2 in layers) {
      var Ly = layers[k2];
      if (!Ly.used && Ly.on) { Ly.fr.style.visibility = 'hidden'; Ly.on = false; }
      if (Ly.used && !Ly.on) { Ly.fr.style.visibility = 'visible'; Ly.on = true; }
    }

    // captions
    var side = 0, sideR = 0, low = 0, dim = sg.dim ? sg.dim * sm(seg(t, 0, .15)) : 0;
    for (var n in caps) {
      var c2 = caps[n], f = Math.min(18, (c2.u1 - c2.u0) * .22), o;
      if (n === 'hero') o = 1 - sm(seg(u, c2.u1 - f * 1.6, c2.u1));
      else o = (u <= c2.u0 || u >= c2.u1) ? 0 : Math.min(sm(seg(u, c2.u0, c2.u0 + f)), 1 - sm(seg(u, c2.u1 - f, c2.u1)));
      if (n === 'contact' && u >= c2.u0 + f) o = 1;
      c2.el.style.opacity = o.toFixed(3); c2.el.style.setProperty('--o', o.toFixed(3));
      c2.el.classList.toggle('on', o > .01); c2.el.classList.toggle('live', o > .55);
      var cl = c2.el.classList;
      if (cl.contains('cap-detail')) { side = Math.max(side, o); if (cl.contains('cap-right')) sideR = Math.max(sideR, o); }
      else if (cl.contains('cap-line') || cl.contains('cap-hero')) low = Math.max(low, o * (layout === 'd' ? .8 : 1));
      else if (layout === 'm' && (cl.contains('cap-ch') || cl.contains('cap-story'))) low = Math.max(low, 0);
    }
    if (sg.t === 'x' && SEG[sg.i + 1] && SEG[sg.i + 1].dim) dim = SEG[sg.i + 1].dim * sm(seg(t, .5, 1));
    scrimL.style.opacity = (layout === 'd' ? side : 0).toFixed(3);
    scrimL.classList.toggle('flip', sideR > 0 && sideR >= side - .001);
    setHood(u);
    scrimB.style.opacity = (layout === 'd' ? low : Math.max(side, low)).toFixed(3);
    scrimF.style.opacity = dim.toFixed(3);

    // logo flies into the nav
    var q = ease(seg(u, 0, SEG[0].u1 * .85));
    if (logoFrom) {
      var ls = lerp(1, logoTo.w / logoFrom.w, q);
      heroLogo.style.transform = 'translate(' + ((logoTo.x - logoFrom.x) * q).toFixed(1) + 'px,' + ((logoTo.y - logoFrom.y) * q).toFixed(1) + 'px) scale(' + ls.toFixed(4) + ')';
    }
    var inStory = journey.getBoundingClientRect().bottom > 2;
    heroLogo.style.opacity = q >= 1 || !inStory ? '0' : '1';
    nav.classList.toggle('logo-hidden', q < 1 && inStory);
    cue.style.opacity = (1 - seg(u, 0, 8)).toFixed(3);

    if (sg.lineup) {
      var row = lineup.scrollWidth, view = lineupWrap.clientWidth;
      lineup.style.transform = 'translate3d(' + lerp(view * .06, Math.min(view * .06, view - row - view * .04), sm(seg(t, .12, .9))).toFixed(1) + 'px,0,0)';
    }

    // flashes
    if (sg.flash != null && !REDUCE) {
      if (lastU >= 0 && lastU < sg.u0 + sg.d * sg.flash && u >= sg.u0 + sg.d * sg.flash) fire();
    }
    lastU = u;

    var ch = 0;
    for (var ci = 0; ci < CHAPTERS.length; ci++) if (u >= chStart(CHAPTERS[ci][0]) - 3) ch = ci;
    chapBtns.forEach(function (b, i) { b.classList.toggle('on', i === ch); });
    if (sg.detail && t > .15 && t < .95) arm(sg.detail); else arm('');
    found.classList.toggle('show', u > SEG[8].u0 && u < SEG[24].u0);
  }
  var lastU = -1;
  // Hood: 0 = shut, 1 = fully open. Shut before its segment, open after it.
  var HOOD = SEG.filter(function (s) { return s.hood; })[0], hoodEl = $('.hood'), hoodTop = $('.hood-top'), hoodUnder = $('.hood-under'), hoodO = -1;
  function setHood(u) {
    if (!HOOD || !hoodEl) return;
    var o = u <= HOOD.u0 ? 0 : u >= HOOD.u1 ? 1 : sm(seg((u - HOOD.u0) / HOOD.d, .06, .88));
    if (Math.abs(o - hoodO) < .0005) return; hoodO = o;
    hoodEl.classList.toggle('on', o > 0);
    hoodTop.style.transform = 'scaleY(' + (1 - sm(o / .42)).toFixed(4) + ')';
    hoodUnder.style.transform = 'scaleY(' + sm((o - .36) / .64).toFixed(4) + ')';
    hoodEl.style.setProperty('--h', o.toFixed(3));
  }
  function chStart(id) { for (var i = 0; i < SEG.length; i++) if (SEG[i].ch === id) return SEG[i].u0; return 0; }
  function fire() { flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go'); }

  /* ============================ HIDDEN DETAILS ============================ */
  var foundSet = {};
  try { foundSet = JSON.parse(localStorage.getItem('31-found') || '{}') || {}; } catch (e) { foundSet = {}; }
  var found = $('#found'), armTimer = null, armed = '';
  var NOHOVER = window.matchMedia && matchMedia('(hover: none)').matches;
  function arm(k) {
    if (k === armed) return;
    if (NOHOVER) $$('[data-lit]').forEach(function (el) { el.classList.toggle('lit', el.getAttribute('data-lit') === k); });
    armed = k; clearTimeout(armTimer); if (k) armTimer = setTimeout(function () { markFound(k); }, 900); }
  function markFound(k) {
    if (!DETAILS[k] || foundSet[k]) return;
    foundSet[k] = 1;
    try { localStorage.setItem('31-found', JSON.stringify(foundSet)); } catch (e) {}
    drawFound(true);
  }
  function drawFound(pulse) {
    var n = DKEYS.filter(function (k) { return foundSet[k]; }).length;
    $('#found-dots').innerHTML = DKEYS.map(function (k) { return '<i class="' + (foundSet[k] ? 'on' : '') + '"></i>'; }).join('');
    $('#found-text').textContent = n === DKEYS.length ? 'All 5 found' : n + ' of 5 found';
    if (pulse) { found.classList.remove('pulse'); void found.offsetWidth; found.classList.add('pulse'); }
  }
  found.addEventListener('click', function () { openPanel('details'); });
  drawFound(false);

  /* ============================== SCROLL LOOP ============================== */
  var nav = $('#nav'), heroLogo = $('#hero-logo'), cue = $('#scroll-cue'), flash = $('.flash');
  var scrimL = $('.scrim-l'), scrimB = $('.scrim-b'), scrimF = $('.scrim-f');
  var lineup = $('#lineup'), lineupWrap = $('.lineup-wrap');
  var logoFrom = null, logoTo = null;
  function measureLogo() {
    heroLogo.style.transform = 'none';
    var r1 = heroLogo.getBoundingClientRect(), r2 = $('.nav-logo img').getBoundingClientRect();
    logoFrom = { x: r1.left, y: r1.top, w: r1.width }; logoTo = { x: r2.left, y: r2.top, w: r2.width };
  }
  function measure(force) {
    var nw = stage.clientWidth, nh = window.innerHeight;
    if (!force && nw === W && Math.abs(nh - H) < 120) return;
    W = nw; H = stage.clientHeight || nh; VH = nh / 100;
    layout = W / H >= .85 ? 'd' : 'm';
    BLUR = REDUCE ? 0 : layout === 'd' ? 7 : 3.5;
    journey.style.height = (TOTAL * VH + nh) + 'px';
    measureLogo();
  }
  var target = 0, cur = 0, running = false;
  function readScroll() {
    var r = journey.getBoundingClientRect();
    target = clamp(-r.top / VH, 0, TOTAL);
    nav.classList.toggle('solid', r.bottom < window.innerHeight * .6);
  }
  var lastT = 0;
  function loop(now) {
    if (!running) return;
    var dt = lastT ? Math.min(64, now - lastT) : 16.7; lastT = now;
    cur += (target - cur) * (REDUCE ? 1 : 1 - Math.pow(1 - .068, dt / 16.7));
    if (Math.abs(target - cur) < .001) cur = target;
    render(cur);
    if (cur === target) { running = false; lastT = 0; return; }
    requestAnimationFrame(loop);
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(loop); } }
  window.addEventListener('scroll', function () { readScroll(); kick(); }, { passive: true });
  window.addEventListener('resize', function () { var ow = W; measure(false); if (W !== ow) { readScroll(); cur = target; render(cur); } });
  window.addEventListener('orientationchange', function () { setTimeout(function () { measure(true); readScroll(); cur = target; render(cur); }, 250); });

  function jumpTo(id) {
    var s = null;
    for (var i = 0; i < SEG.length; i++) if (SEG[i].ch === id) { s = SEG[i]; break; }
    if (!s) return;
    closePanel(true);
    var u = id === 'hero' ? 0 : s.u0 + Math.min(s.d * .3, 14);
    var top = journey.getBoundingClientRect().top + window.scrollY + u * VH;
    var dip = $('#dip');
    dip.classList.add('on');
    setTimeout(function () { window.scrollTo(0, top); readScroll(); cur = target; render(cur); requestAnimationFrame(function () { dip.classList.remove('on'); }); }, REDUCE ? 0 : 420);
  }
  document.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); jumpTo(g.dataset.go); return; }
    var o = e.target.closest('[data-open]');
    if (o) { e.preventDefault(); openPanel(o.dataset.open, o.dataset.need); return; }
    // The odometer and radio are real links; tapping them also counts as finding them.
    if (e.target.closest('.ov-odo-link')) markFound('odo');
    if (e.target.closest('.ov-lcd')) markFound('radio');
    var c = e.target.closest('[data-car]');
    if (c) { e.preventDefault(); openPanel('car', c.dataset.car); }
  });

  /* ============================ RADIO DISPLAY ============================ */
  var OBC = [], obcIdx = 0;
  function buildObc() {
    OBC = [
      { t: '31 BY CARTIO', href: 'ig', label: '31 by Cartio on Instagram' },
      { t: 'CALL ' + String(S.phone_display).replace(/-/g, ' '), href: 'tel', label: 'Call ' + S.phone_display },
      { t: String(S.email).toUpperCase(), href: 'mailto', label: 'Email ' + S.email },
      { t: 'IG @' + String(S.instagram).toUpperCase(), href: 'ig', label: 'Instagram @' + S.instagram }
    ];
    setObcLink();
  }
  buildObc();
  setInterval(function () {
    var el = $('#obc-text'); if (!el) return;
    obcIdx = (obcIdx + 1) % OBC.length;
    el.classList.add('flip');
    setTimeout(function () { el.textContent = OBC[obcIdx].t; el.classList.remove('flip'); fitObc(); setObcLink(); }, 160);
  }, 2400);
  function setObcLink() {
    var a = $('#obc'), m = OBC[obcIdx]; if (!a || !m) return;
    a.href = L()[m.href]; a.setAttribute('aria-label', m.label);
    if (m.href === 'ig') { a.target = '_blank'; a.rel = 'noopener'; } else { a.removeAttribute('target'); a.removeAttribute('rel'); }
  }
  function fitObc() { var el = $('#obc-text'); if (!el) return; el.style.transform = 'none'; var k = Math.min(1, 380 / (el.scrollWidth || 380)); el.style.transform = 'scaleX(' + k.toFixed(3) + ')'; }
  setOdo('818395', '5765');
  $('#year').textContent = new Date().getFullYear();

  /* ================================= CARS ================================= */
  var CARS = [];
  var STATUS = { available: 'Available', pending: 'Sale pending', coming: 'Coming soon', restoration: 'In restoration', sold: 'Sold' };
  var ORDER = { available: 0, pending: 1, coming: 2, restoration: 3, sold: 4 };
  function title(c) { return [c.year, c.model].filter(Boolean).join(' ') || 'E31'; }
  function price(c) { return c.price ? '$' + fmt(c.price) : (c.status === 'sold' ? 'Sold' : 'Inquire'); }
  function photos(c) { return (c.photos || []).map(function (p) { return p && (p.image || p); }).filter(Boolean); }
  function asset(p) { var m = /assets\/photos\/([^/.]+)\.webp$/.exec(p || ''); return (m && window.__ASSET__ && window.__ASSET__[m[1]]) || p; }
  function cardImg(c, w) {
    var p = photos(c)[0];
    return p ? '<img src="' + esc(imgUrl(asset(p), w)) + '" data-raw="' + esc(asset(p)) + '" alt="' + esc(title(c) + ' ' + (c.paint || '')) + '" loading="lazy" decoding="async">'
      : '<span class="noimg"><img src="' + esc(embossSrc) + '" alt=""></span>';
  }
  function renderLineup() {
    var list = CARS.filter(function (c) { return c.status !== 'sold'; }).slice(0, 12);
    lineup.innerHTML = list.map(function (c) {
      return '<button class="lc" type="button" data-car="' + esc(c.id) + '"><span class="lc-img">' + cardImg(c, 800) + '</span>' +
        '<span class="lc-meta"><span class="lc-st">' + esc(STATUS[c.status] || 'Available') + '</span>' + (c.sample ? '<span class="lc-sample">Sample</span>' : '') + '</span>' +
        '<b>' + esc(title(c)) + '</b><span class="lc-sub">' + esc([c.paint, c.location].filter(Boolean).join(', ')) + '</span><span class="lc-price">' + esc(price(c)) + '</span></button>';
    }).join('') + '<button class="lc lc-all" type="button" data-open="inventory"><b>See all cars</b><span class="lc-sub">Filter by model and status</span></button>';
  }

  /* ================================ PANEL ================================ */
  var panel = $('#panel'), pBody = $('#panel-body'), pTitle = $('#panel-title'), pBox = $('.panel-box'), lastFocus = null;
  function openPanel(view, arg) {
    lastFocus = document.activeElement;
    clearTimeout(closeTimer); panel.classList.remove('closing');
    panel.hidden = false; panel.dataset.view = view;
    document.documentElement.classList.add('locked');
    VIEWS[view](arg);
    pBox.scrollTop = 0;
    var f = $('[autofocus]', pBody); (f || pBox).focus({ preventScroll: true });
  }
  var revealIO = null;
  function reveal() {
    var items = $$('.rv', pBody);
    if (REDUCE || !('IntersectionObserver' in window)) { items.forEach(function (el) { el.classList.add('in'); }); return; }
    if (revealIO) revealIO.disconnect();
    revealIO = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); revealIO.unobserve(en.target); } }); }, { root: pBox, rootMargin: '0px 0px -6% 0px', threshold: .08 });
    items.forEach(function (el) { el.classList.add('rv-on'); revealIO.observe(el); });
  }
  var closeTimer = null;
  function closePanel(silent) {
    if (panel.hidden) return;
    // ease out, then hide (a jump closes at once so the dip can cover it)
    clearTimeout(closeTimer);
    if (silent || REDUCE) panel.hidden = true;
    else { panel.classList.add('closing'); closeTimer = setTimeout(function () { panel.hidden = true; panel.classList.remove('closing'); }, 320); }
    document.documentElement.classList.remove('locked');
    if (/^#car-/.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
    if (!silent && lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  panel.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closePanel(); });
  document.addEventListener('keydown', function (e) {
    var typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
    if (e.key === 'Escape' && !panel.hidden) { closePanel(); return; }
    if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); openPanel('search'); }
    if (e.key === 'Tab' && !panel.hidden) {
      var f = $$('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])', pBox).filter(function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  var SERVICES = [
    { t: 'Paint and respray', k: 'paint color colour respray refinish clear coat scratches correction', go: 'paint', d: 'Factory-correct color and finish.' },
    { t: 'Bodywork and dents', k: 'body bodywork dent dents ding panel rust collision accident', go: 'paint', d: 'Panels, dents and rust, put right.' },
    { t: 'Engine rebuilds', k: 'engine motor rebuild v12 v8 m70 m73 s70 m60 m62 overheating cooling fuel oil leak timing', go: 'engines', d: 'V8 and V12, a leak to a full rebuild.' },
    { t: 'Power steering', k: 'power steering pump rack leak fluid hose', go: 'steering', d: 'Pumps, racks, hoses and leaks.' },
    { t: 'Suspension and brakes', k: 'suspension bushings dampers shocks brakes wheels tires alignment', go: 'steering', d: 'Drives tight again.' },
    { t: 'Interior and leather', k: 'interior leather seats upholstery dash headliner trim seat motor', go: 'interior', d: 'Seats, dash, headliner and trim.' },
    { t: 'Cuts and tears', k: 'cuts tears rips cracked leather bolster', go: 'interior', d: 'Leather repaired or re-trimmed.' },
    { t: 'Sunroof repair', k: 'sunroof leak cable motor roof moonroof track drain', go: 'sunroof', d: 'Leaks, cables, motors and seals.' },
    { t: 'Glass and seals', k: 'glass window seal windshield regulator pillarless wind noise', go: 'sunroof', d: 'Pillarless glass set up to seal.' },
    { t: 'Wiring and electrical', k: 'wiring electrical harness wires switch window lock climate battery drain', go: 'wiring', d: 'Harnesses, switches and faults.' },
    { t: 'Gauges and clusters', k: 'cluster gauges pixels odometer instrument check control', go: 'gauges', d: 'Pixels, needles and check control.' },
    { t: 'Electronics', k: 'electronics radio obc computer module sensor display', go: 'radio', d: 'Radio, computer and modules.' },
    { t: 'Parts sourcing', k: 'parts sourcing find discontinued nla rare', open: 'form', d: 'Hard-to-find parts, found.' },
    { t: 'Pre-purchase inspection', k: 'inspection pre-purchase ppi buying check', open: 'form', d: 'Know what you\'re buying.' },
    { t: 'Cars for sale', k: 'buy sell consign inventory cars for sale stock available', go: 'stock', d: 'Our cars, and help finding one.' }
  ];
  function contacts() {
    var l = L(), items = [
      { t: 'Call ' + S.phone_display, k: 'call phone number ring', href: l.tel },
      { t: 'Text ' + S.phone_display, k: 'text sms message', href: l.sms },
      { t: 'Email ' + S.email, k: 'email mail', href: l.mailto },
      { t: 'Instagram @' + S.instagram, k: 'instagram dm ig message social', href: l.ig, ext: 1 },
      { t: 'YouTube @' + S.youtube, k: 'youtube videos channel', href: l.yt, ext: 1 },
      { t: 'Send a message', k: 'form contact message quote estimate', open: 'form' }
    ];
    if (S.facebook) items.splice(4, 0, { t: 'Facebook', k: 'facebook messenger fb message social page', href: l.fb, ext: 1, d: 'facebook.com/' + S.facebook });
    (S.locations || []).forEach(function (loc) { items.push({ t: loc.name, k: 'location address where directions map shop ' + (loc.note || ''), href: mapUrl(loc), ext: 1, d: [loc.note, 'Open in Maps'].filter(Boolean).join(' · ') }); });
    return items;
  }
  function index() {
    var idx = [];
    SERVICES.forEach(function (s) { idx.push({ g: 'Services', t: s.t, k: s.k, go: s.go, open: s.open, d: s.d }); });
    CARS.forEach(function (c) { idx.push({ g: 'Cars', t: title(c) + (c.paint ? ', ' + c.paint : ''), k: [c.model, c.paint, c.year, c.status, STATUS[c.status], 'car cars sale', c.location].join(' '), car: c.id, d: STATUS[c.status] }); });
    contacts().forEach(function (c) { idx.push({ g: 'Contact', t: c.t, k: c.k, href: c.href, ext: c.ext, open: c.open, d: c.d }); });
    [['Our story', 'story about alec cartio founders history', 'story'], ['All cars for sale', 'inventory cars sale all list', 'inventory'], ['Hidden details', 'hidden easter eggs details secrets find', 'details'], ['Every service', 'services list all what do you do', 'services']]
      .forEach(function (p) { idx.push({ g: 'Pages', t: p[0], k: p[1], open: p[2] }); });
    return idx;
  }
  function resHtml(r) {
    var at = r.href ? 'href="' + esc(r.href) + '"' + (r.ext ? ' target="_blank" rel="noopener"' : '') : 'href="#"' + (r.go ? ' data-go="' + r.go + '"' : r.open ? ' data-open="' + r.open + '"' : r.car ? ' data-car="' + esc(r.car) + '"' : '');
    return '<a class="res" ' + at + '><b>' + esc(r.t) + '</b>' + (r.d ? '<span>' + esc(r.d) + '</span>' : '') + '</a>';
  }
  function runSearch(q) {
    var box2 = $('#results'); if (!box2) return;
    q = q.trim().toLowerCase();
    var idx = index(), list;
    if (!q) list = idx.filter(function (r) { return ['Sunroof repair', 'Engine rebuilds', 'Interior and leather', 'Paint and respray', 'Wiring and electrical', 'All cars for sale'].indexOf(r.t) >= 0 || /^Call /.test(r.t); });
    else {
      var toks = q.split(/\s+/);
      list = idx.map(function (r) {
        var hay = (r.t + ' ' + r.k).toLowerCase(), sc = 0;
        for (var i = 0; i < toks.length; i++) { if (hay.indexOf(toks[i]) < 0) return null; sc += r.t.toLowerCase().indexOf(toks[i]) === 0 ? 3 : 1; }
        return { r: r, s: sc };
      }).filter(Boolean).sort(function (a, b) { return b.s - a.s; }).map(function (x2) { return x2.r; });
    }
    if (!list.length) { box2.innerHTML = '<p class="empty">Nothing matches "' + esc(q) + '". Try "sunroof", "leather" or "850CSi", or <a href="' + L().tel + '">call ' + esc(S.phone_display) + '</a>.</p>'; return; }
    var groups = {};
    list.slice(0, 14).forEach(function (r) { (groups[r.g] = groups[r.g] || []).push(r); });
    box2.innerHTML = Object.keys(groups).map(function (g) { return '<div class="rg"><p class="rg-h">' + g + '</p>' + groups[g].map(resHtml).join('') + '</div>'; }).join('');
  }

  var VIEWS = {
    search: function () {
      pTitle.textContent = 'Search';
      pBody.innerHTML = '<label class="sr" for="q">Search the site</label><input class="q" id="q" type="search" placeholder="Try sunroof, leather, V12, 850CSi, phone" autocomplete="off" autofocus><div class="results" id="results"></div>';
      var inp = $('#q');
      inp.addEventListener('input', function () { runSearch(inp.value); });
      inp.addEventListener('keydown', function (e) { var rs = $$('.res', pBody); if (e.key === 'ArrowDown' && rs.length) { e.preventDefault(); rs[0].focus(); } if (e.key === 'Enter' && rs.length) { e.preventDefault(); rs[0].click(); } });
      $('#results').addEventListener('keydown', function (e) {
        var rs = $$('.res', pBody), i = rs.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); (rs[i + 1] || rs[i]).focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? rs[i - 1] : $('#q')).focus(); }
      });
      runSearch('');
    },
    menu: function () {
      pTitle.textContent = 'Menu';
      var names = { hero: 'The studio', inside: 'Step inside', gauges: 'Gauges and clusters', radio: 'Electronics', leather: 'The leather', paint: 'Paint & Bodywork', engines: 'Engines', steering: 'Steering & Suspension', interior: 'Interior & Leather', sunroof: 'Sunroof, Glass & Seals', wiring: 'Wiring & Electronics', stock: 'Available stock', story: 'How it started', contact: 'Contact' };
      pBody.innerHTML = '<button class="q q-btn" type="button" data-open="search">Search services, cars and contact</button>' +
        '<nav class="menu-tour" aria-label="Tour">' + CHAPTERS.map(function (c) { return '<a href="#" data-go="' + c[0] + '">' + names[c[0]] + '</a>'; }).join('') + '</nav>' +
        '<div class="menu-links"><a href="#" data-open="inventory">All cars for sale</a><a href="#" data-open="services">Every service</a><a href="#" data-open="story">Our story</a><a href="#" data-open="details">Hidden details</a></div>' +
        '<div class="menu-social"><a href="' + L().mailto + '">' + esc(S.email) + '</a><a href="' + L().ig + '" target="_blank" rel="noopener">Instagram @' + esc(S.instagram) + '</a>' + (S.facebook ? '<a href="' + L().fb + '" target="_blank" rel="noopener">Facebook</a>' : '') + '<a href="' + L().yt + '" target="_blank" rel="noopener">YouTube</a></div>' +
        '<div class="menu-cta"><a class="btn btn-gold" href="' + L().tel + '">Call ' + esc(S.phone_display) + '</a><a class="btn btn-line" href="' + L().sms + '">Text us</a><a class="btn btn-line" href="#" data-open="form">Send a message</a></div>';
    },
    services: function () {
      pTitle.textContent = 'What we do';
      pBody.innerHTML = '<h2 class="ph2">Everything the E31 needs.</h2><div class="svc">' + SERVICES.map(function (s) { return '<a href="#" ' + (s.go ? 'data-go="' + s.go + '"' : 'data-open="' + s.open + '"') + '><b>' + esc(s.t) + '</b><span>' + esc(s.d) + '</span></a>'; }).join('') + '</div>';
    },
    inventory: function () {
      pTitle.textContent = 'Cars for sale';
      var models = []; CARS.forEach(function (c) { if (c.model && models.indexOf(c.model) < 0) models.push(c.model); });
      var chips = [['all', 'All'], ['available', 'Available now']].concat(models.map(function (m) { return [m, m]; }));
      if (CARS.some(function (c) { return c.status === 'sold'; })) chips.push(['sold', 'Sold']);
      pBody.innerHTML = '<h2 class="ph2">Available stock</h2><div class="chips" id="inv-f">' + chips.map(function (c, i) { return '<button type="button" data-f="' + esc(c[0]) + '" aria-pressed="' + (i === 0) + '">' + esc(c[1]) + '</button>'; }).join('') + '</div><p class="count" id="inv-n"></p><div class="grid" id="inv-g"></div><p class="inv-more">Looking for a specific car? <a href="#" data-open="form">Tell us what you want</a> and we\'ll find it.</p>';
      function draw(f) {
        var list = CARS.filter(function (c) { return f === 'all' ? true : f === 'available' ? c.status === 'available' || c.status === 'pending' : f === 'sold' ? c.status === 'sold' : c.model === f && c.status !== 'sold'; });
        $('#inv-n').textContent = list.length + (list.length === 1 ? ' car' : ' cars');
        $('#inv-g').innerHTML = list.length ? list.map(function (c) {
          return '<button class="card' + (c.status === 'sold' ? ' sold' : '') + '" type="button" data-car="' + esc(c.id) + '"><span class="card-img">' + cardImg(c, 900) + '<span class="flag">' + esc(STATUS[c.status] || 'Available') + '</span>' + (c.sample ? '<span class="flag flag-s">Sample listing</span>' : '') + '</span><b>' + esc(title(c)) + '</b><span class="card-sub">' + esc([c.paint, c.transmission, c.mileage ? fmt(c.mileage) + ' mi' : ''].filter(Boolean).join(', ')) + '</span><span class="card-price">' + esc(price(c)) + '</span></button>';
        }).join('') : '<p class="empty">Nothing here right now. <a href="#" data-open="form">Tell us what you\'re after.</a></p>';
      }
      $('#inv-f').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; $$('#inv-f button').forEach(function (x2) { x2.setAttribute('aria-pressed', String(x2 === b)); }); draw(b.dataset.f); });
      draw('all');
    },
    car: function (id) {
      var c = CARS.filter(function (x2) { return x2.id === id; })[0];
      if (!c) { VIEWS.inventory(); return; }
      pTitle.textContent = STATUS[c.status] || 'Available';
      var ph = photos(c), l = L(), t = title(c) + (c.paint ? ' in ' + c.paint : '');
      var slides = ph.length ? ph.map(function (p, i) { return '<div class="slide"><img src="' + esc(imgUrl(asset(p), 1800)) + '" data-raw="' + esc(asset(p)) + '" alt="' + esc(title(c) + ', photo ' + (i + 1)) + '"' + (i ? ' loading="lazy"' : '') + '></div>'; }).join('') : '<div class="slide">' + cardImg(c, 1200) + '</div>';
      var rows = [['Year', c.year], ['Model', c.model], ['Paint', c.paint], ['Interior', c.interior], ['Gearbox', c.transmission], ['Mileage', c.mileage ? fmt(c.mileage) + ' miles' : ''], ['Location', c.location]].filter(function (r) { return r[1]; });
      var mail = l.mailto + '?subject=' + encodeURIComponent('Inquiry: ' + t) + '&body=' + encodeURIComponent('Hi, I\'m interested in the ' + t + ' on your site.\n\n');
      pBody.innerHTML = '<div class="gal"><div class="track" id="track">' + slides + '</div>' + (ph.length > 1 ? '<button class="gnav gp" type="button" aria-label="Previous photo">‹</button><button class="gnav gn" type="button" aria-label="Next photo">›</button><span class="gcount" id="gcount">1 / ' + ph.length + '</span>' : '') + '</div>' +
        (ph.length > 1 ? '<div class="thumbs" id="thumbs">' + ph.map(function (p, i) { return '<button type="button" data-i="' + i + '" aria-label="Photo ' + (i + 1) + '"' + (i ? '' : ' aria-current="true"') + '><img src="' + esc(imgUrl(asset(p), 240)) + '" data-raw="' + esc(asset(p)) + '" alt="" loading="lazy"></button>'; }).join('') + '</div>' : '') +
        '<div class="car-info"><div><h2>' + esc(title(c)) + '</h2>' + (c.headline ? '<p class="car-lead">' + esc(c.headline) + '</p>' : '') + '<p class="car-price">' + esc(price(c)) + '</p>' +
        (c.status !== 'sold' ? '<div class="car-cta"><a class="btn btn-gold" href="' + l.tel + '">Call about this car</a><a class="btn btn-line" href="' + l.sms + '">Text</a><a class="btn btn-line" href="' + l.ig + '" target="_blank" rel="noopener">Instagram</a><a class="btn btn-line" href="' + mail + '">Email</a></div>' : '<div class="car-cta"><a class="btn btn-line" href="#" data-open="form">Ask us to find one like it</a></div>') +
        (c.description ? '<p class="car-desc">' + esc(c.description) + '</p>' : '') +
        ((c.highlights || []).length ? '<ul class="car-hl">' + c.highlights.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul>' : '') +
        (c.sample ? '<p class="car-sample">Sample listing. Replace it with a real car and its real photos in the editor before launch.</p>' : '') +
        '</div><div>' + (rows.length ? '<dl class="specs">' + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>' : '') + '<button class="linkbtn" type="button" id="share">' + (navigator.share ? 'Share this car' : 'Copy link to this car') + '</button></div></div>';
      try { history.replaceState(null, '', '#car-' + c.id); } catch (e) {}
      var track2 = $('#track');
      if (ph.length > 1) {
        var idx = function () { return Math.round(track2.scrollLeft / track2.clientWidth); };
        var go = function (i) { i = (i + ph.length) % ph.length; track2.scrollTo({ left: i * track2.clientWidth, behavior: REDUCE ? 'auto' : 'smooth' }); };
        $('.gp', pBody).onclick = function () { go(idx() - 1); };
        $('.gn', pBody).onclick = function () { go(idx() + 1); };
        var thumbs = $$('#thumbs button', pBody);
        thumbs.forEach(function (b) { b.onclick = function () { go(+b.dataset.i); }; });
        track2.addEventListener('scroll', function () {
          var i = idx(); $('#gcount').textContent = (i + 1) + ' / ' + ph.length;
          thumbs.forEach(function (b, j) { if (j === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
        }, { passive: true });
      }
      $('#share').onclick = function (e) {
        var url = location.href.split('#')[0] + '#car-' + c.id, b = e.target;
        var copy = function () {
          if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { b.textContent = 'Link copied'; }, function () { b.textContent = url; }); else b.textContent = url;
        };
        // The share sheet can be blocked (embedded views); fall back to copying the link.
        if (navigator.share) { navigator.share({ title: t + ' | 31 by Cartio', text: t + ', ' + price(c), url: url }).catch(function (err) { if (!err || err.name !== 'AbortError') copy(); }); return; }
        copy();
      };
    },
    story: function () {
      pTitle.textContent = 'Our story';
      var img = function (f, alt, cls) { return '<figure class="st-fig ' + (cls || '') + '"><img src="' + esc(imgUrl('/assets/photos/' + f + '.webp', 1600)) + '" data-raw="assets/photos/' + f + '.webp" alt="' + esc(alt) + '" loading="lazy" decoding="async"></figure>'; };
      pBody.innerHTML = '<article class="st">' +
        '<header class="st-open rv"><p class="st-eyebrow">31 by Cartio</p><h2>Two life paths, crossing in pursuit of one perfect car.</h2>' +
        '<p class="st-lead">31 by Cartio is a partnership between the man who knows the E31 better than almost anyone, and the man who waited more than twenty years to own one.</p></header>' +
        img('hero-on', 'A black BMW 850 in the studio, headlights up', 'st-wide rv') +

        '<section class="st-part"><h3 class="rv">The partnership</h3>' +
        '<div class="st-prose">' +
        '<p class="rv">Alec Cartio is the person at the front of nearly every E31 thread, in the forums and the Facebook groups. He has spent years with these cars, buying them, selling more than a hundred collector cars on Bring a Trailer and filming them through CARTIOLOGi Films. If the E31 has a Michelangelo, it\'s Alec.</p>' +
        '<p class="rv">Michael Keeby spent forty years as an insurance executive and a lifetime working on cars, a true passion of his. Since the late 1990s, the BMW 850 had been the one car he always meant to own.</p>' +
        '<p class="rv">Together they bring the knowledge, the craft and the commitment that turn a shared passion into a company. 31 by Cartio is built on the hard work of both, with the backing of family and friends, among them Michael\'s brother, Jim Keeby, and many others who have helped along the way.</p>' +
        '</div></section>' +

        '<section class="st-part"><h3 class="rv">How we got here</h3>' +
        '<div class="st-thread">' +
        '<div class="rv"><p class="st-mark">The first 850Ci</p><p>After years of admiring the car, Michael purchases a black 1997 850Ci in South Florida. Bringing it back to the standard it deserves becomes a deep dive. The parts are hard to find, and the answers are harder.</p></div>' +
        '<div class="rv"><p class="st-mark">Help and guidance</p><p>The search leads to the E31 forums and Facebook groups, and to Alec. It begins with parts and soon becomes more: Michael asks Alec for help and guidance, and two people who have worked on cars all their lives find common ground. That is where the friendship begins.</p></div>' +
        '<div class="rv"><p class="st-mark">Two in the garage</p><p>A second 850Ci follows. Michael and his son take both cars to shows and work on them side by side, and the friendship with Alec grows into something more.</p></div>' +
        '<div class="rv"><p class="st-mark">The call</p><p>One day, Michael picks up the phone.</p></div>' +
        '</div>' +
        '<blockquote class="st-quote rv"><p>&ldquo;How would you feel about starting a company for the exquisite machines we both own and love?&rdquo;</p><cite>Michael Keeby, to Alec Cartio</cite></blockquote>' +
        '<p class="st-body rv">A search for parts became a friendship, and the friendship became a partnership. Today 31 by Cartio works from Southern California and South Florida, with a network of specialists who still know how to work on these cars.</p>' +
        '</section>' +
        img('cabin-wide', 'The cognac leather cabin of an 850', 'st-wide rv') +

        '<section class="st-part"><h3 class="rv">The road ahead</h3>' +
        '<p class="st-body rv">There is a particular class to a car that has stood the test of time, and the E31 carries it better than most. Every year there are fewer good examples, and fewer experts to keep them running straight on the road ahead. That is the work in front of us, and it is the mission this company is built around.</p>' +
        '<div class="st-ahead">' +
        '<div class="rv"><h4>More cars, put right</h4><p>Restoration to the standard BMW envisioned for these cars as they left the factory line.</p></div>' +
        '<div class="rv"><h4>The best E31s, from around the world</h4><p>Sourcing the finest examples and offering them through a company that is accessible, reputable and genuinely invested in bringing the public\'s love back to these machines.</p></div>' +
        '<div class="rv"><h4>Parts, finished properly</h4><p>Supplying parts, and working with our partners on custom-made ones, so that no part of your restoration or your new purchase feels unfinished.</p></div>' +
        '<div class="rv"><h4>The next generation</h4><p>For everyone who is part of this company: Alec, the Keeby family, the friends who have supported us along the way, and every customer, today and tomorrow, who travels the road ahead with us.</p></div>' +
        '</div>' +
        '<div class="menu-cta rv"><button class="btn btn-gold" type="button" data-open="form">Tell us about your car</button><button class="btn btn-line" type="button" data-open="inventory">See the cars</button></div>' +
        '</section>' +

        '<div class="st-facts rv"><h4>The E31</h4><dl class="specs st-specs"><div><dt>Built</dt><dd>1990 to 1999, Dingolfing, Germany</dd></div><div><dt>Designer</dt><dd>Klaus Kapitza</dd></div><div><dt>Body</dt><dd>Pillarless 2+2 coupe, pop-up headlights</dd></div><div><dt>Engines</dt><dd>4.0 and 4.4 V8, 5.0 and 5.4 V12, 5.6 S70 V12</dd></div></dl>' +
        '<h4>How many were built</h4><dl class="specs st-specs st-prod">' +
        '<div><dt>850i</dt><dd><span>5.0 V12, 1990 to 1994<small>Includes the first 850Ci, as the car was renamed in 1992</small></span><b>20,072</b></dd></div>' +
        '<div><dt>850Ci</dt><dd><span>5.4 V12, 1994 to 1999</span><b>1,218</b></dd></div>' +
        '<div><dt>850CSi</dt><dd><span>5.6 S70 V12, 1992 to 1996</span><b>1,510</b></dd></div>' +
        '<div class="st-sub"><dt>All 850s</dt><dd><span>1990 to 1999</span><b>22,800</b></dd></div>' +
        '<div><dt>840Ci</dt><dd><span>4.0 V8, 1993 to 1996</span><b>4,728</b></dd></div>' +
        '<div><dt>840Ci</dt><dd><span>4.4 V8, 1996 to 1999</span><b>3,075</b></dd></div>' +
        '<div class="st-sub"><dt>All 840Ci</dt><dd><span>1993 to 1999</span><b>7,803</b></dd></div>' +
        '<div class="st-total"><dt>All E31s</dt><dd><span>Including 18 830i</span><b>30,621</b></dd></div>' +
        '</dl>' +
        '<h4>Built for the United States</h4><dl class="specs st-specs st-prod">' +
        '<div><dt>850i</dt><dd><span>1990 to 1994</span><b>4,194</b></dd></div>' +
        '<div><dt>850Ci</dt><dd><span>1994 to 1997</span><b>363</b></dd></div>' +
        '<div><dt>850CSi</dt><dd><span>1993 to 1995</span><b>225</b></dd></div>' +
        '<div><dt>840Ci</dt><dd><span>1993 to 1999</span><b>2,450</b></dd></div>' +
        '<div class="st-total"><dt>US cars</dt><dd><span>About</span><b>7,232</b></dd></div>' +
        '</dl></div>' +
        '</article>';
      reveal();
    },
    details: function () {
      var n = DKEYS.filter(function (k) { return foundSet[k]; }).length;
      pTitle.textContent = 'Hidden details';
      pBody.innerHTML = '<h2 class="ph2">' + (n === 5 ? 'You found all five.' : n + ' of 5 found') + '</h2><p class="lead">' + (n === 5 ? 'Now come and see the real thing.' : 'Five things are hidden in the car. Keep looking.') + '</p><ul class="dl">' +
        DKEYS.map(function (k) { return '<li class="' + (foundSet[k] ? 'got' : '') + '"><b>' + (foundSet[k] ? esc(DETAILS[k].name) : 'Not found yet') + '</b><span>' + esc(DETAILS[k].hint) + '</span></li>'; }).join('') + '</ul>' +
        (n === 5 ? '<div class="menu-cta"><a class="btn btn-gold" href="' + L().tel + '">Call ' + esc(S.phone_display) + '</a></div>' : '<div class="menu-cta"><button class="btn btn-line" type="button" data-go="inside">Start the tour inside</button></div>');
    },
    form: function (need) {
      pTitle.textContent = 'Send a message';
      var opts = ['Paint or bodywork', 'Engine or power steering', 'Interior or leather', 'Sunroof or glass', 'Wiring or electronics', 'Full restoration', 'Parts', 'Buying a car', 'Selling a car', 'Pre-purchase inspection', 'Something else'];
      pBody.innerHTML = '<h2 class="ph2">Tell us about your car.</h2><form class="form" id="inquiry" name="inquiry" method="POST" data-netlify="true" netlify-honeypot="company" action="/thanks.html">' +
        '<input type="hidden" name="form-name" value="inquiry"><p class="hp"><label>Company <input name="company" tabindex="-1" autocomplete="off"></label></p>' +
        '<div class="row2"><label>Your name<input name="name" autocomplete="name" required autofocus></label><label>Phone or email<input name="contact" autocomplete="email" required></label></div>' +
        '<div class="row2"><label>Your car<input name="car" placeholder="e.g. 1995 850CSi"></label><label>What do you need?<select name="need">' +
        opts.map(function (o) { return '<option' + (o === need ? ' selected' : '') + '>' + o + '</option>'; }).join('') +
        '</select></label></div><label>Message<textarea name="message" rows="5" required></textarea></label>' +
        '<button class="btn btn-gold" type="submit">Send message</button><p class="status" id="fstatus" role="status" aria-live="polite"></p></form>' +
        '<p class="form-alt">Or call or text <a href="' + L().tel + '">' + esc(S.phone_display) + '</a>, or email <a href="' + L().mailto + '">' + esc(S.email) + '</a>.</p>';
      var form = $('#inquiry'), st = $('#fstatus');
      form.addEventListener('submit', function (e) {
        e.preventDefault(); st.classList.remove('err');
        if (!form.checkValidity()) { form.reportValidity(); return; }
        if (PREVIEW) { st.textContent = 'Preview only. On the live site this sends your message to ' + S.email + '.'; return; }
        if (!ON_NETLIFY) {
          // No form handler on this host: hand the message to the visitor's email app instead.
          var fd = new FormData(form), subj = 'Inquiry' + (fd.get('car') ? ': ' + fd.get('car') : '') + ' (' + fd.get('need') + ')';
          var body = fd.get('message') + '\n\n' + fd.get('name') + '\n' + fd.get('contact') + (fd.get('car') ? '\nCar: ' + fd.get('car') : '');
          location.href = L().mailto + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body);
          st.textContent = 'Opening your email app with the message filled in. If nothing opens, call or text ' + S.phone_display + '.';
          return;
        }
        var btn = $('button[type="submit"]', form); btn.disabled = true; btn.textContent = 'Sending…';
        fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(form)).toString() })
          .then(function (r) { if (!r.ok) throw 0; form.reset(); st.textContent = 'Message sent. We\'ll get back to you by phone or email.'; })
          .catch(function () { st.classList.add('err'); st.textContent = 'That didn\'t send. Call or text ' + S.phone_display + ' instead.'; })
          .then(function () { btn.disabled = false; btn.textContent = 'Send message'; });
      });
    }
  };
  function routeHash() { var m = /^#car-(.+)$/.exec(location.hash); if (m) openPanel('car', decodeURIComponent(m[1])); }
  window.addEventListener('hashchange', routeHash);

  /* ================================= BOOT ================================= */
  function load() {
    if (window.__DATA__) return Promise.resolve(window.__DATA__);
    var get = function (u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    return Promise.all([get('content/settings.json'), get('content/inventory.json')]).then(function (r) { return { settings: r[0], inventory: r[1] }; });
  }
  measure(true); readScroll(); cur = target; render(cur);
  window.addEventListener('load', function () { measure(true); render(cur); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measure(true); render(cur); fitObc(); });

  load().then(function (d) {
    applySettings((d && d.settings) || {});
    CARS = (((d && d.inventory) || {}).cars || []).filter(function (c) { return c && (c.model || c.year); }).map(function (c, i) {
      c.id = c.id ? slug(c.id) : slug([c.year, c.model, c.paint, i].join(' ')); c.status = c.status || 'available'; return c;
    });
    CARS.sort(function (a, b) {
      if (!!b.featured !== !!a.featured) return b.featured ? 1 : -1;
      var s = (ORDER[a.status] || 0) - (ORDER[b.status] || 0); if (s) return s;
      return (b.year || 0) - (a.year || 0);
    });
    renderLineup(); render(cur); routeHash(); fitObc();
  });
})();
