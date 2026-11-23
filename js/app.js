/* YMUSIC — YouTube Music 스타일 개인 음악 앱
 * 바닐라 JS 단일 파일. localStorage 에 좋아요/재생목록/최근감상/설정을 영구 저장한다.
 */
(function () {
  'use strict';

  /* =====================================================================
   * 0. 상수
   * ===================================================================== */
  var STORE = {
    likes: 'ymusic.likes.v1',
    playlists: 'ymusic.playlists.v1',
    recent: 'ymusic.recent.v1',
    settings: 'ymusic.settings.v1',
    prefs: 'ymusic.prefs.v1',
    songs: 'ymusic.songs.v1'
  };
  var APP_VERSION = '1.0.0';
  var MOODS = ['신나는', '잔잔한', '새벽', '집중', '운동', '감성', '이별', '청량', '밤'];
  var DEFAULT_GRADIENTS = [
    ['#3a1020', '#0b1522'], ['#231a3a', '#0b1420'], ['#12303a', '#101018'],
    ['#3a2410', '#141018'], ['#1d2a3a', '#0a0f16'], ['#2e1230', '#0d1018']
  ];

  /* =====================================================================
   * 1. 상태
   * ===================================================================== */
  var state = {
    data: { songs: [], genres: [], count: 0, generatedAt: '' },
    route: { name: 'home', q: '', genre: 'all' },
    homeFilter: 'all',
    explore: { q: '', genre: 'all', results: null, loading: false, source: 'local', error: '' },
    libraryTab: 'liked',
    queue: [],
    index: -1,
    current: null,
    playing: false,
    shuffle: false,
    repeat: 'off',
    mode: 'song',
    screen: 'none',
    sheet: null,
    modal: null,
    oled: false,
    liked: {},
    songStore: {},
    playlists: [],
    recent: [],
    settings: { apiKey: '', quality: 'highres' },
    yt: null,
    ytReady: false,
    pendingSong: null,
    position: 0,
    duration: 0,
    wakeLock: null,
    cache: {},
    colors: {},
    loaded: false,
    toastTimer: null,
    tickTimer: null,
    clockTimer: null,
    lastTap: 0
  };

  /* =====================================================================
   * 2. 유틸
   * ===================================================================== */
  function $(id) { return document.getElementById(id); }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }

  function fmtViews(n) {
    n = Number(n) || 0;
    if (n >= 100000000) return (Math.floor(n / 10000000) / 10) + '억회';
    if (n >= 10000) return Math.floor(n / 10000) + '만회';
    if (n >= 1000) return (Math.floor(n / 100) / 10) + '천회';
    return n ? n + '회' : '';
  }

  function thumb(id, big) {
    if (!id) return '';
    if (big) return 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg';
    return 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
  }

  function imgTag(song, opts) {
    opts = opts || {};
    var big = !!opts.big;
    var id = song && song.videoId;
    if (!id) return '';
    var fallback = 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
    var src = big ? thumb(id, true) : fallback;
    return '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async" ' +
      'onerror="this.onerror=null;this.src=\'' + fallback + '\'">';
  }

  function hashHue(str) {
    var h = 0;
    str = String(str || '');
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }

  /* 썸네일에서 대표 색을 뽑아 배경 그라데이션에 쓴다(불가능하면 해시 기반 색). */
  function extractPalette(song) {
    if (!song || !song.videoId || state.colors[song.videoId]) return;
    if (typeof window.Image !== 'function' || !document.createElement) return;
    try {
      var img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = 24; c.height = 14;
          var cctx = c.getContext && c.getContext('2d');
          if (!cctx) return;
          cctx.drawImage(img, 0, 0, 24, 14);
          var d = cctx.getImageData(0, 0, 24, 14).data;
          var r = 0, g = 0, b = 0, n = 0;
          for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
          if (!n) return;
          r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
          var mx = Math.max(r, g, b) || 1;
          var k = mx < 70 ? 2.3 : 1.35;
          var c1 = [Math.min(255, Math.round(r * k)), Math.min(255, Math.round(g * k)), Math.min(255, Math.round(b * k))];
          state.colors[song.videoId] = [
            'rgba(' + c1.join(',') + ',0.60)',
            'rgba(' + Math.round(c1[0] * 0.45) + ',' + Math.round(c1[1] * 0.55) + ',' + Math.round(c1[2] * 0.8) + ',0.55)'
          ];
          if (state.current && state.current.videoId === song.videoId) applyGlow();
        } catch (e) {}
      };
      img.src = thumb(song.videoId, false);
    } catch (e) {}
  }

  function applyGlow() {
    var p = $('player-screen');
    if (!p || !state.current) return;
    var g = gradientFor(state.current);
    try {
      p.style.setProperty('--glow-a', g[0]);
      p.style.setProperty('--glow-b', g[1]);
    } catch (e) {}
  }

  function gradientFor(song) {
    if (!song) return DEFAULT_GRADIENTS[0];
    if (state.colors[song.videoId]) return state.colors[song.videoId];
    var hue = hashHue(song.videoId);
    var a = 'hsl(' + hue + ', 34%, 16%)';
    var b = 'hsl(' + ((hue + 48) % 360) + ', 30%, 10%)';
    return [a, b];
  }

  function isMobileNarrow() {
    return (window.innerWidth || 390) <= 390;
  }

  function uid() {
    return 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var val = JSON.parse(raw);
      return val == null ? fallback : val;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  /* =====================================================================
   * 3. 영구 저장
   * ===================================================================== */
  function loadPersisted() {
    state.liked = readJSON(STORE.likes, {}) || {};
    state.songStore = readJSON(STORE.songs, {}) || {};
    state.playlists = readJSON(STORE.playlists, []) || [];
    state.recent = readJSON(STORE.recent, []) || [];
    var settings = readJSON(STORE.settings, {}) || {};
    state.settings = { apiKey: settings.apiKey || '', quality: settings.quality || 'highres' };
    var prefs = readJSON(STORE.prefs, {}) || {};
    state.shuffle = !!prefs.shuffle;
    state.repeat = prefs.repeat || 'off';
    state.mode = prefs.mode === 'video' ? 'video' : 'song';
  }

  function saveLikes() { writeJSON(STORE.likes, state.liked); }
  function savePlaylists() { writeJSON(STORE.playlists, state.playlists); }
  function saveRecent() { writeJSON(STORE.recent, state.recent); }
  function savePrefs() {
    writeJSON(STORE.prefs, { shuffle: state.shuffle, repeat: state.repeat, mode: state.mode });
  }
  function saveSettings() { writeJSON(STORE.settings, { apiKey: state.settings.apiKey, quality: state.settings.quality || 'highres' }); }

  /* =====================================================================
   * 4. 카탈로그
   * ===================================================================== */
  function indexCache() {
    var songs = state.data.songs || [];
    var i;
    for (i = 0; i < songs.length; i++) state.cache[songs[i].videoId] = songs[i];
    for (var id in state.songStore) {
      if (state.songStore[id] && state.songStore[id].title) state.cache[id] = state.songStore[id];
    }
    var liked = state.liked || {};
    for (var lid in liked) { if (liked[lid] && liked[lid].title) state.cache[lid] = liked[lid]; }
    var recent = state.recent || [];
    for (i = 0; i < recent.length; i++) {
      var r = recent[i];
      if (r && r.song && r.song.videoId && state.cache[r.song.videoId] == null) state.cache[r.song.videoId] = r.song;
    }
  }

  /* API 검색 등 내장 목록 밖의 곡도 새로고침 후에도 남도록 저장 */
  function rememberSong(song) {
    if (!song || !song.videoId || !song.title) return;
    state.songStore[song.videoId] = song;
    state.cache[song.videoId] = song;
    writeJSON(STORE.songs, state.songStore);
  }

  function songById(id) {
    if (!id) return null;
    if (state.cache[id]) return state.cache[id];
    var songs = state.data.songs || [];
    for (var i = 0; i < songs.length; i++) if (songs[i].videoId === id) { state.cache[id] = songs[i]; return songs[i]; }
    return null;
  }

  function songFromVideoId(id) {
    var song = songById(id);
    if (song) return song;
    return null;
  }

  function allSongs() { return state.data.songs || []; }

  function filteredSongs() {
    var songs = allSongs();
    var f = state.homeFilter;
    if (!f || f === 'all') return songs.slice();
    return songs.filter(function (s) {
      if (s.genre === f) return true;
      return (s.moods || []).indexOf(f) >= 0;
    });
  }

  function sortedByViews(list) {
    return list.slice().sort(function (a, b) { return (b.views || 0) - (a.views || 0); });
  }

  function playlistGroups() {
    var groups = {}, order = [];
    var songs = sortedByViews(allSongs());
    for (var i = 0; i < songs.length; i++) {
      var key = songs[i].playlist || '기타';
      if (!groups[key]) { groups[key] = { name: key, genre: songs[i].genre, songs: [], views: 0 }; order.push(key); }
      groups[key].songs.push(songs[i]);
      groups[key].views += songs[i].views || 0;
    }
    return order.map(function (k) { return groups[k]; });
  }

  function similarSongs(song, limit) {
    limit = limit || 14;
    if (!song) return [];
    var pool = allSongs().filter(function (s) {
      return s.videoId !== song.videoId && (s.genre === song.genre || s.artist === song.artist);
    });
    pool = sortedByViews(pool);
    var out = pool.slice(0, limit);
    if (out.length < limit) {
      var rest = sortedByViews(allSongs().filter(function (s) { return s.videoId !== song.videoId && out.indexOf(s) < 0; }));
      out = out.concat(rest.slice(0, limit - out.length));
    }
    return out;
  }

  /* =====================================================================
   * 5. 라우터
   * ===================================================================== */
  function parseHash() {
    var h = (location.hash || '#/home').replace(/^#\/?/, '');
    var parts = h.split('?');
    var path = parts[0] || 'home';
    var query = {};
    if (parts[1]) {
      parts[1].split('&').forEach(function (kv) {
        var pair = kv.split('=');
        if (pair[0]) query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
      });
    }
    if (path.indexOf('explore') === 0) return { name: 'explore', q: query.q || '', genre: query.genre || 'all' };
    if (path.indexOf('library') === 0) return { name: 'library', q: '', genre: 'all' };
    return { name: 'home', q: '', genre: 'all' };
  }

  function go(hash, replace) {
    if (replace) { try { history.replaceState(null, '', hash); } catch (e) { location.hash = hash; } }
    else if (location.hash !== hash) location.hash = hash;
    state.route = parseHash();
    if (state.route.name === 'explore') {
      state.explore.q = state.route.q || state.explore.q;
      state.explore.genre = state.route.genre || 'all';
    }
    render();
  }

  /* =====================================================================
   * 6. 렌더 — 공통 조각
   * ===================================================================== */
  var ICON = {
    search: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M12 3 4 9.5V21h6v-6h4v6h6V9.5L12 3z"/></svg>',
    explore: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.5 6.5-2.1 5.4-5.4 2.1 2.1-5.4 5.4-2.1zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>',
    library: '<svg viewBox="0 0 24 24"><path d="M4 3h3v18H4V3zm5 0h3v18H9V3zm6.2 1.6 2.8-.9 4.4 16.1-2.8.9-4.4-16.1z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M6 5l9 7-9 7V5zm11 0h3v14h-3V5z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M18 19l-9-7 9-7v14zM4 5h3v14H4V5z"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="m12 10.6 5-5L18.6 7l-5 5 5 5-1.6 1.6-5-5-5 5L5.4 17l5-5-5-5L7 5.4l5 5z"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.7-9.3-9A5.4 5.4 0 0 1 12 6.2 5.4 5.4 0 0 1 21.3 12c-1.8 4.3-9.3 9-9.3 9z"/></svg>',
    heartOutline: '<svg viewBox="0 0 24 24"><path d="M12 19.6 4.9 13A4.4 4.4 0 0 1 12 7.7 4.4 4.4 0 0 1 19.1 13L12 19.6zM12 4.4A6.4 6.4 0 0 0 1.9 11.7L12 21l10.1-9.3A6.4 6.4 0 0 0 12 4.4z" opacity=".65"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24"><path d="M17 3h4v4h-2V6.4l-4 4L13.6 9l4-4H17V3zM3 5h4.2l3.4 3.4-1.4 1.4L6.4 7H3V5zm14.3 11.6L16 15l1.3-1.3 2.3 2.3V14h2v6h-6v-2h1.9l-3-3L14 13.6l3.3 3zM3 17h3.4l3.2-3.2 1.4 1.4L7.2 19H3v-2z"/></svg>',
    repeat: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
    repeatOne: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zM13 15h-2v-4H9v-1.4L11.4 8H13v7z"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L14.9 3h-4l-.4 2.6a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4L6.4 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6zM12.9 15.4a3.4 3.4 0 1 1 0-6.8 3.4 3.4 0 0 1 0 6.8z"/></svg>',
    queue: '<svg viewBox="0 0 24 24"><path d="M4 6h2v2H4V6zm4 0h12v2H8V6zM4 11h2v2H4v-2zm4 0h12v2H8v-2zM4 16h2v2H4v-2zm4 0h8v2H8v-2z"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M12.3 3a9 9 0 1 0 8.4 12.4A7.4 7.4 0 0 1 12.3 3z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2zM4 7h16v2H4V7z"/></svg>',
    dots: '<svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>',
    music: '<svg viewBox="0 0 24 24"><path d="M12 3v11.2A3.4 3.4 0 1 0 14 17.4V7h5V3h-7z"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M9 18.5A2.5 2.5 0 1 1 6.5 16c.4 0 .8.1 1.1.2V5l9-2v3.2l-7 1.6v10.7z"/></svg>'
  };

  function brandHTML() {
    return '<div class="brand">' +
      '<div class="brand-mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>' +
      '<div class="brand-name">YMUSIC<em>.</em></div></div>';
  }

  function renderTopbar() {
    var el = $('topbar');
    if (!el) return;
    var right = '';
    if (state.route.name !== 'explore') {
      right += '<button class="icon-btn" data-act="go-explore" aria-label="검색">' + ICON.search + '</button>';
    }
    right += '<button class="icon-btn" data-act="open-settings" aria-label="설정">' + ICON.gear + '</button>';
    el.innerHTML = brandHTML() + right;
  }

  function renderTabbar() {
    var el = $('tabbar');
    if (!el) return;
    var tabs = [
      { id: 'home', label: '홈', icon: ICON.home },
      { id: 'explore', label: '탐색', icon: ICON.explore },
      { id: 'library', label: '보관함', icon: ICON.library }
    ];
    var current = state.route.name;
    el.innerHTML = tabs.map(function (t) {
      return '<button class="tab-btn' + (current === t.id ? ' on' : '') + '" data-act="tab" data-id="' + t.id + '">' +
        t.icon + '<span>' + t.label + '</span></button>';
    }).join('');
  }

  function cardHTML(song, badge) {
    var playing = !!(state.playing && state.current && state.current.videoId === song.videoId);
    return '<button class="card' + (playing ? ' playing' : '') + '" data-act="play-card" data-id="' + esc(song.videoId) + '">' +
      '<div class="art">' + imgTag(song) +
      (badge || song.genre ? '<span class="badge">' + esc(badge || song.genre) + '</span>' : '') +
      '<span class="play-dot">' + ICON.play + '</span></div>' +
      '<div class="t">' + esc(song.title) + '</div>' +
      '<div class="a">' + esc(song.artist) + '</div></button>';
  }

  function trackRowHTML(song, index, opts) {
    opts = opts || {};
    var playing = !!(state.playing && state.current && state.current.videoId === song.videoId);
    var num = opts.hideNum ? '' : '<span class="num">' + (playing ? '♪' : (index + 1)) + '</span>';
    var acts = '';
    if (opts.removePlaylist) {
      acts = '<span class="row-acts"><button class="icon-btn" data-act="pl-remove" data-id="' + esc(song.videoId) + '">' + ICON.close + '</button></span>';
    } else if (opts.menu) {
      acts = '<span class="row-acts"><button class="icon-btn" data-act="track-menu" data-id="' + esc(song.videoId) + '">' + ICON.dots + '</button></span>';
    }
    return '<div class="track' + (playing ? ' playing' : '') + '">' +
      num +
      '<button class="th" data-act="play-track" data-id="' + esc(song.videoId) + '" aria-label="' + esc(song.title) + ' 재생">' + imgTag(song) + '</button>' +
      '<button class="meta" data-act="play-track" data-id="' + esc(song.videoId) + '">' +
      '<div class="t">' + esc(song.title) + '</div><div class="a">' + esc(song.artist) + (song.views ? ' · ' + fmtViews(song.views) : '') + '</div></button>' +
      '<span class="dur">' + esc(song.duration || fmtTime(song.durationSec)) + '</span>' +
      acts + '</div>';
  }

  function sectionHead(title, moreHTML) {
    return '<div class="sect-head"><h2>' + esc(title) + '</h2>' + (moreHTML || '') + '</div>';
  }

  function chipsHTML() {
    var list = [{ id: 'all', label: '전체' }];
    (state.data.genres || []).forEach(function (g) { list.push({ id: g, label: g }); });
    MOODS.forEach(function (m) { list.push({ id: m, label: '# ' + m }); });
    return '<div class="chips">' + list.map(function (c) {
      var on = state.homeFilter === c.id;
      return '<button class="chip' + (on ? ' on' : '') + '" data-act="filter" data-id="' + esc(c.id) + '">' + esc(c.label) + '</button>';
    }).join('') + '</div>';
  }

  /* =====================================================================
   * 7. 홈
   * ===================================================================== */
  function renderHome() {
    var songs = filteredSongs();
    var html = '';
    html += '<h1 class="page-title">오늘은 어떤 음악?</h1>';
    html += '<p class="page-sub">' + (state.data.count || allSongs().length) + '곡 · YouTube 공식 채널 플레이리스트</p>';
    html += chipsHTML();

    var recentSongs = (state.recent || []).map(function (r) { return songFromVideoId(r.videoId); }).filter(Boolean).slice(0, 12);
    if (recentSongs.length) {
      html += '<section class="sect">' + sectionHead('최근 감상', '<button class="more" data-act="go-library" data-id="recent">전체</button>');
      html += '<div class="hscroll">' + recentSongs.map(function (s) { return cardHTML(s, ''); }).join('') + '</div></section>';
    }

    var quick = sortedByViews(songs).slice(0, isMobileNarrow() ? 8 : 12);
    html += '<section class="sect">' + sectionHead('빠른 선곡', '<button class="more" data-act="shuffle-all">셔플 재생</button>');
    if (quick.length) {
      html += '<div class="quick-grid">' + quick.map(function (s) { return cardHTML(s, ''); }).join('') + '</div>';
    } else {
      html += '<div class="empty">이 분위기의 곡이 아직 없어요. 다른 칩을 눌러 보세요.</div>';
    }
    html += '</section>';

    var chart = sortedByViews(songs).slice(0, 12);
    html += '<section class="sect">' + sectionHead('인기 차트', '<span class="more">조회수 기준</span>');
    html += '<div class="track-list">' + chart.map(function (s, i) { return trackRowHTML(s, i, { menu: true }); }).join('') + '</div>';
    html += '</section>';

    var groups = playlistGroups();
    if (state.homeFilter !== 'all') {
      groups = groups.filter(function (g) { return g.genre === state.homeFilter || (state.data.genres || []).indexOf(state.homeFilter) < 0; });
    }
    html += '<section class="sect">' + sectionHead('추천 플레이리스트');
    html += '<div class="hscroll">' + groups.slice(0, 14).map(function (g) {
      return '<button class="pl-card" data-act="open-playlist" data-id="' + esc(g.name) + '">' +
        '<div class="cover">' + imgTag(g.songs[0]) + '<span>' + g.songs.length + '곡</span></div>' +
        '<div class="t">' + esc(g.name) + '</div><div class="a">' + esc(g.genre) + '</div></button>';
    }).join('') + '</div></section>';

    return html;
  }

  /* =====================================================================
   * 8. 탐색
   * ===================================================================== */
  function localSearch(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    return allSongs().filter(function (s) {
      return (s.title || '').toLowerCase().indexOf(q) >= 0 ||
        (s.artist || '').toLowerCase().indexOf(q) >= 0 ||
        (s.playlist || '').toLowerCase().indexOf(q) >= 0 ||
        (s.genre || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function searchResultsHTML() {
    var ex = state.explore;
    var html = '<div class="result-note" id="search-note">';
    if (ex.loading) html += '검색 중…';
    else if (ex.source === 'api') html += 'YouTube 실시간 검색 결과' + (ex.results ? ' · ' + ex.results.length + '곡' : '');
    else html += '내장 라이브러리 검색 결과' + (ex.results ? ' · ' + ex.results.length + '곡' : '');
    html += '</div>';
    if (ex.loading) {
      html += '<div class="empty"><div class="spinner" style="margin:0 auto 10px"></div>찾고 있어요…</div>';
    } else if (ex.error) {
      html += '<div class="banner" style="margin-bottom:10px"><div class="txt">' + esc(ex.error) + '</div></div>';
      if (ex.results && ex.results.length) {
        html += '<div class="track-list">' + ex.results.map(function (s, i) { return trackRowHTML(s, i, { menu: true }); }).join('') + '</div>';
      }
    } else if (ex.results && ex.results.length) {
      html += '<div class="track-list">' + ex.results.map(function (s, i) { return trackRowHTML(s, i, { menu: true }); }).join('') + '</div>';
    } else {
      html += '<div class="empty">‘' + esc(ex.q) + '’ 검색 결과가 없어요.<br>다른 키워드로 찾아보세요.</div>';
    }
    return html;
  }

  function paintSearch() {
    var el = $('search-results');
    if (el) { el.innerHTML = searchResultsHTML(); return; }
    render();
  }

  function renderExplore() {
    var ex = state.explore;
    var html = '<h1 class="page-title">탐색</h1>';
    html += '<div class="searchbar"><div class="search-inner">' + ICON.search +
      '<input id="search-input" type="search" inputmode="search" enterkeyhint="search" placeholder="곡, 아티스트, 플레이리스트 검색" value="' + esc(ex.q) + '" autocomplete="off">' +
      (ex.q ? '<button class="clear" data-act="clear-search" aria-label="지우기">' + ICON.close + '</button>' : '') +
      '</div></div>';

    if (!state.settings.apiKey) {
      html += '<div class="banner"><div class="txt">설정에서 <b>무료 YouTube API 키</b>를 넣으면 전 세계 모든 곡을 실시간 검색할 수 있어요.</div>' +
        '<button data-act="open-settings">설정</button></div>';
    }

    if (ex.q) {
      html += '<div id="search-results">' + searchResultsHTML() + '</div>';
      return html;
    }

    var genres = state.data.genres || [];
    html += '<section class="sect">' + sectionHead('장르별 차트', '<span class="more">조회수 기준</span>') + '</section>';
    html += genres.map(function (g) {
      var rows = sortedByViews(allSongs().filter(function (s) { return s.genre === g; })).slice(0, 5);
      if (!rows.length) return '';
      return '<section class="sect">' + sectionHead(g, '<button class="more" data-act="genre-more" data-id="' + esc(g) + '">더보기</button>') +
        '<div class="track-list">' + rows.map(function (s, i) { return trackRowHTML(s, i, { menu: true }); }).join('') + '</div></section>';
    }).join('');

    if (state.route.genre && state.route.genre !== 'all') {
      var g = state.route.genre;
      var all = sortedByViews(allSongs().filter(function (s) { return s.genre === g; }));
      html += '<section class="sect">' + sectionHead(g + ' 전체') + '<div class="track-list">' +
        all.map(function (s, i) { return trackRowHTML(s, i, { menu: true }); }).join('') + '</div></section>';
    }
    return html;
  }

  function runSearch(q) {
    state.explore.q = q;
    state.explore.results = null;
    state.explore.error = '';
    if (!q) { state.explore.loading = false; state.explore.source = 'local'; render(); return; }
    var key = (state.settings.apiKey || '').trim();
    if (!key) {
      state.explore.source = 'local';
      state.explore.loading = false;
      state.explore.results = localSearch(q).slice(0, 60);
      paintSearch();
      return;
    }
    state.explore.source = 'api';
    state.explore.loading = true;
    paintSearch();
    apiSearch(q, key).then(function (rows) {
      if (state.explore.q !== q) return false;
      state.explore.loading = false;
      state.explore.results = rows;
      if (!rows.length) state.explore.error = '';
      paintSearch();
      return true;
    }).catch(function (err) {
      if (state.explore.q !== q) return false;
      state.explore.loading = false;
      state.explore.source = 'local';
      state.explore.results = localSearch(q).slice(0, 60);
      state.explore.error = 'API 검색 실패(' + (err && err.message ? err.message : '오류') + ') — 내장 라이브러리 결과를 보여드려요.';
      paintSearch();
      return false;
    });
  }

  function parseISODuration(iso) {
    var m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
    if (!m) return 0;
    return (parseInt(m[1] || 0, 10) * 86400) + (parseInt(m[2] || 0, 10) * 3600) +
      (parseInt(m[3] || 0, 10) * 60) + parseInt(m[4] || 0, 10);
  }

  function apiSearch(q, key) {
    var searchUrl = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video' +
      '&videoCategoryId=10&maxResults=20&regionCode=KR&relevanceLanguage=ko&q=' +
      encodeURIComponent(q) + '&key=' + encodeURIComponent(key);
    return fetch(searchUrl).then(function (r) {
      if (!r.ok) throw new Error('search ' + r.status);
      return r.json();
    }).then(function (data) {
      if (data.error) throw new Error(data.error.message || 'API 오류');
      var ids = (data.items || []).map(function (it) { return it.id && it.id.videoId; }).filter(Boolean);
      if (!ids.length) return [];
      var vUrl = 'https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status' +
        '&id=' + ids.join(',') + '&key=' + encodeURIComponent(key);
      return fetch(vUrl).then(function (r2) {
        if (!r2.ok) throw new Error('videos ' + r2.status);
        return r2.json();
      }).then(function (vdata) {
        var out = [];
        (vdata.items || []).forEach(function (it) {
          var st = it.status || {};
          if (st.embeddable === false) return;
          if (st.privacyStatus && st.privacyStatus !== 'public') return;
          var rr = (it.contentDetails || {}).regionRestriction;
          if (rr) {
            if (rr.blocked && rr.blocked.indexOf('KR') >= 0) return;
            if (rr.allowed && rr.allowed.indexOf('KR') < 0) return;
          }
          var sec = parseISODuration((it.contentDetails || {}).duration);
          if (!sec || sec > 3600) return;
          var sn = it.snippet || {};
          var thumbs = sn.thumbnails || {};
          out.push({
            videoId: it.id,
            title: sn.title || '',
            artist: sn.channelTitle || '',
            duration: fmtTime(sec),
            durationSec: sec,
            thumbnail: (thumbs.medium && thumbs.medium.url) || 'https://i.ytimg.com/vi/' + it.id + '/mqdefault.jpg',
            genre: '실시간 검색',
            playlist: 'YouTube 검색',
            moods: [],
            views: 0,
            source: 'api'
          });
        });
        return out;
      });
    });
  }

  function testApiKey(key) {
    var url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=music&key=' +
      encodeURIComponent(key);
    return fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      if (d.error) throw new Error(d.error.message || d.error.status || 'API 오류');
      return (d.items || []).length;
    });
  }

  /* =====================================================================
   * 9. 보관함
   * ===================================================================== */
  function likedSongs() {
    var ids = Object.keys(state.liked || {});
    return ids.map(function (id) { return songFromVideoId(id); }).filter(Boolean);
  }

  function renderLibrary() {
    var html = '<h1 class="page-title">보관함</h1>';
    var tab = state.libraryTab;
    html += '<div class="seg">' +
      '<button class="' + (tab === 'liked' ? 'on' : '') + '" data-act="lib-tab" data-id="liked">좋아요 ' + likedSongs().length + '</button>' +
      '<button class="' + (tab === 'playlists' ? 'on' : '') + '" data-act="lib-tab" data-id="playlists">재생목록 ' + state.playlists.length + '</button>' +
      '<button class="' + (tab === 'recent' ? 'on' : '') + '" data-act="lib-tab" data-id="recent">최근 감상</button>' +
      '</div>';

    if (tab === 'liked') {
      var likes = likedSongs();
      if (!likes.length) {
        html += '<div class="empty">아직 좋아요한 곡이 없어요.<br>플레이어에서 <b>♥</b>를 눌러 담아 보세요.</div>';
      } else {
        html += '<div style="display:flex;gap:8px;margin:10px 0 6px">' +
          '<button class="btn primary" data-act="play-liked" style="height:40px">전체 재생</button></div>';
        html += '<div class="track-list">' + likes.map(function (s, i) { return trackRowHTML(s, i, { menu: true }); }).join('') + '</div>';
      }
    } else if (tab === 'playlists') {
      html += '<button class="lib-row" data-act="new-playlist"><span class="cover">' + ICON.plus + '</span>' +
        '<span class="meta"><span class="t">새 재생목록 만들기</span><span class="a">내가 고른 곡으로 목록을 만들어요</span></span></button>';
      if (!state.playlists.length) {
        html += '<div class="empty" style="margin-top:12px">아직 만든 재생목록이 없어요.</div>';
      } else {
        html += '<div style="margin-top:8px">' + state.playlists.map(function (p) {
          var first = p.songIds && p.songIds.length ? songFromVideoId(p.songIds[0]) : null;
          return '<button class="lib-row" data-act="open-my-playlist" data-id="' + esc(p.id) + '">' +
            '<span class="cover">' + (first ? imgTag(first) : ICON.note) + '</span>' +
            '<span class="meta"><span class="t">' + esc(p.name) + '</span><span class="a">' + p.songIds.length + '곡</span></span>' +
            ICON.dots + '</button>';
        }).join('') + '</div>';
      }
    } else {
      var recents = (state.recent || []).map(function (r) { return songFromVideoId(r.videoId); }).filter(Boolean);
      if (!recents.length) {
        html += '<div class="empty">아직 감상 기록이 없어요.<br>곡을 재생하면 여기에 쌓여요.</div>';
      } else {
        html += '<div class="track-list">' + recents.map(function (s, i) { return trackRowHTML(s, i, { menu: true }); }).join('') + '</div>';
      }
    }
    return html;
  }

  /* =====================================================================
   * 10. 미니 플레이어
   * ===================================================================== */
  function renderMini() {
    var el = $('miniplayer');
    if (!el) return;
    var song = state.current;
    if (!song || state.screen === 'full' || state.screen === 'oled') { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    var pct = state.duration ? Math.min(100, (state.position / state.duration) * 100) : 0;
    el.innerHTML =
      '<div class="mp-progress"><i id="mp-bar" style="width:' + pct + '%"></i></div>' +
      '<button class="mp-thumb" data-act="open-player" aria-label="플레이어 열기">' + imgTag(song) + '</button>' +
      '<button class="mp-meta" data-act="open-player" style="text-align:left;background:none;border:0;padding:0">' +
      '<div class="t">' + esc(song.title) + '</div><div class="a">' + esc(song.artist) + '</div></button>' +
      '<button class="icon-btn" data-act="toggle-play" aria-label="재생/일시정지">' + (state.playing ? ICON.pause : ICON.play) + '</button>' +
      '<button class="icon-btn" data-act="next" aria-label="다음 곡">' + ICON.next + '</button>';
  }

  /* =====================================================================
   * 11. 풀 플레이어
   * ===================================================================== */
  function renderPlayer() {
    var el = $('player-screen');
    if (!el) return;
    var song = state.current;
    if (!song || state.screen === 'none' || state.screen === 'oled') { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.className = 'player-screen' + (state.mode === 'video' ? ' video-mode' : '');

    var g = gradientFor(song);
    el.style.setProperty('--glow-a', g[0]);
    el.style.setProperty('--glow-b', g[1]);

    var pct = state.duration ? Math.min(100, (state.position / state.duration) * 100) : 0;
    var likeOn = !!state.liked[song.videoId];
    var repeatIcon = state.repeat === 'one' ? ICON.repeatOne : ICON.repeat;
    var likeIcon = likeOn ? ICON.heart : ICON.heartOutline;

    el.innerHTML =
      '<div class="p-head">' +
      '<button class="icon-btn" data-act="close-player" aria-label="내리기">' + ICON.down + '</button>' +
      '<div class="p-source"><span class="k">재생 출처</span><span class="v">' + esc(song.playlist || 'YMUSIC') + '</span></div>' +
      '<div class="mode-toggle"><button class="' + (state.mode === 'song' ? 'on' : '') + '" data-act="mode" data-id="song">노래</button>' +
      '<button class="' + (state.mode === 'video' ? 'on' : '') + '" data-act="mode" data-id="video">동영상</button></div>' +
      '<button class="icon-btn" data-act="open-settings" aria-label="설정">' + ICON.gear + '</button>' +
      '</div>' +
      '<div class="p-main">' +
      '<div class="stage" id="stage"><div class="art">' + imgTag(song, { big: true }) + '</div></div>' +
      '<div class="p-right">' +
      '<div class="p-info" id="p-info"><div class="txt"><div class="t">' + esc(song.title) + '</div>' +
      '<div class="a">' + esc(song.artist) + (song.views ? ' · ' + fmtViews(song.views) : '') + '</div></div>' +
      '<button class="icon-btn like' + (likeOn ? ' on' : '') + '" data-act="toggle-like" data-id="' + esc(song.videoId) + '" aria-label="좋아요">' + likeIcon + '</button></div>' +
      '<div class="seek-row">' +
      '<span class="tm" id="t-cur">' + fmtTime(state.position) + '</span>' +
      '<input class="seek" id="seek" type="range" min="0" max="' + Math.max(1, Math.floor(state.duration)) + '" value="' + Math.floor(state.position) + '" step="1" style="--p:' + pct + '%" aria-label="재생 위치">' +
      '<span class="tm" id="t-dur">' + fmtTime(state.duration || song.durationSec) + '</span></div>' +
      '<div class="controls">' +
      '<button class="icon-btn' + (state.shuffle ? ' on' : '') + '" data-act="shuffle" aria-label="셔플">' + ICON.shuffle + '</button>' +
      '<button class="icon-btn" data-act="prev" aria-label="이전 곡">' + ICON.prev + '</button>' +
      '<button class="play-big" data-act="toggle-play" aria-label="재생/일시정지">' + (state.playing ? ICON.pause : ICON.play) + '</button>' +
      '<button class="icon-btn" data-act="next" aria-label="다음 곡">' + ICON.next + '</button>' +
      '<button class="icon-btn' + (state.repeat !== 'off' ? ' on' : '') + '" data-act="repeat" aria-label="반복">' + repeatIcon + '</button>' +
      '</div>' +
      '<div class="p-tabs">' +
      '<button data-act="open-queue">' + ICON.queue + '다음 트랙</button>' +
      '<button data-act="open-similar">' + ICON.music + '비슷한 곡</button>' +
      '<button data-act="open-quality">' + qualityLabelShort(state.settings.quality) + '</button>' +
      '<button class="oled-btn" data-act="open-oled" aria-label="OLED 절전 모드">' + ICON.moon + '</button>' +
      '</div></div></div>';

    layoutVideoHost();
    extractPalette(song);
  }

  /* =====================================================================
   * 12. 렌더 진입점
   * ===================================================================== */
  function render() {
    var view = $('view');
    if (view) {
      if (state.route.name === 'explore') view.innerHTML = renderExplore();
      else if (state.route.name === 'library') view.innerHTML = renderLibrary();
      else view.innerHTML = renderHome();
    }
    renderTopbar();
    renderTabbar();
    renderMini();
    renderPlayer();
  }

  /* =====================================================================
   * 13. 재생 (YouTube IFrame API)
   * ===================================================================== */
  function currentSong() {
    if (state.current) return state.current;
    if (state.index >= 0 && state.queue[state.index]) return state.queue[state.index];
    return null;
  }

  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) { state.ytReady = true; return; }
    if (document.getElementById('yt-iframe-api')) return;
    var s = document.createElement('script');
    s.id = 'yt-iframe-api';
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }

  function ensurePlayer(song) {
    if (!song) return;
    if (!window.YT || !window.YT.Player) {
      state.pendingSong = song;
      loadYouTubeApi();
      return;
    }
    if (state.yt) {
      try { state.yt.loadVideoById(song.videoId); } catch (e) {}
      return;
    }
    state.yt = new window.YT.Player('ytplayer', {
      width: '100%',
      height: '100%',
      videoId: song.videoId,
      playerVars: {
        autoplay: 1, controls: 0, playsinline: 1, modestbranding: 1,
        rel: 0, iv_load_policy: 3, fs: 0, disablekb: 1
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      }
    });
  }

  function qualityLabelShort(q) {
    if (q === 'hd720') return '고음질 720p';
    if (q === 'large') return '보통 480p';
    if (q === 'medium') return '절약 360p';
    if (q === 'auto') return '자동 음질';
    return '최고음질';
  }

  function applyAudioQuality(player) {
    if (!player || !player.setPlaybackQuality) return;
    try {
      var pref = state.settings.quality || 'highres';
      if (pref === 'highres') {
        var levels = player.getAvailableQualityLevels ? player.getAvailableQualityLevels() : [];
        player.setPlaybackQuality(levels && levels.length ? levels[0] : 'hd1080');
      } else {
        player.setPlaybackQuality(pref);
      }
    } catch (e) {}
  }

  function openQualitySheet() {
    var cur = state.settings.quality || 'highres';
    var opts = [
      ['highres', '최고음질 우선 (1080p+)', '가장 선명한 음질과 화질로 요청'],
      ['hd720', '고음질 (720p)', '모바일에서 안정적인 고음질'],
      ['large', '보통 (480p)', '데이터와 배터리 균형'],
      ['medium', '데이터 절약 (360p)', '와이파이 없는 환경 절약'],
      ['auto', '자동', '네트워크 상태에 따라 유튜브 자동']
    ];
    openSheet(
      '<h3>음질 · 화질 설정</h3>' +
      '<p class="hint" style="margin-bottom:10px">유튜브 스트림의 음질·화질 기준을 선택해요. (네트워크 상태에 따라 유튜브가 일시 조정할 수 있음)</p>' +
      '<div class="sheet-list">' +
      opts.map(function (o) {
        return '<button class="sheet-row' + (cur === o[0] ? ' on' : '') + '" data-act="set-quality" data-id="' + o[0] + '">' +
          '<div class="txt"><div class="t">' + o[1] + '</div><div class="a">' + o[2] + '</div></div>' +
          (cur === o[0] ? '<span class="badge-on">선택됨</span>' : '') +
          '</button>';
      }).join('') +
      '</div>'
    );
  }

  function onPlayerReady(ev) {
    state.ytReady = true;
    var song = state.pendingSong || currentSong();
    if (song) {
      state.pendingSong = null;
      try {
        if (state.playing) ev.target.loadVideoById(song.videoId);
        else ev.target.cueVideoById(song.videoId);
      } catch (e) {}
    }
    applyAudioQuality(ev.target);
    layoutVideoHost();
  }

  function onPlayerStateChange(ev) {
    var YTNS = window.YT || {};
    var S = YTNS.PlayerState || { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
    if (ev.data === S.PLAYING) {
      state.playing = true;
      applyAudioQuality(ev.target);
      requestWakeLock();
      startTick();
      refreshPlayIcons();
    } else if (ev.data === S.PAUSED) {
      state.playing = false;
      releaseWakeLock();
      stopTick();
      refreshPlayIcons();
    } else if (ev.data === S.ENDED) {
      handleEnded();
    } else if (ev.data === S.CUED) {
      state.playing = false;
      refreshPlayIcons();
    }
  }

  function onPlayerError(ev) {
    var code = ev && ev.data;
    toast(code === 101 || code === 150 ? '이 곡은 외부 재생이 막혀 있어요 — 다음 곡으로 넘어갑니다' : '재생할 수 없는 영상이에요 — 다음 곡으로 넘어갑니다');
    setTimeout(function () { next(); }, 700);
  }

  function handleEnded() {
    if (state.repeat === 'one') {
      try { state.yt.seekTo(0); state.yt.playVideo(); } catch (e) {}
      return;
    }
    if (state.index >= state.queue.length - 1 && state.repeat === 'off' && !state.shuffle) {
      state.playing = false;
      refreshPlayIcons();
      return;
    }
    next(true);
  }

  function startTick() {
    stopTick();
    state.tickTimer = setInterval(tick, 500);
  }
  function stopTick() {
    if (state.tickTimer) { clearInterval(state.tickTimer); state.tickTimer = null; }
  }

  function tick() {
    if (!state.yt || !state.yt.getCurrentTime) return;
    var t = 0, d = 0;
    try {
      t = state.yt.getCurrentTime() || 0;
      d = state.yt.getDuration() || 0;
    } catch (e) { return; }
    state.position = t;
    state.duration = d || state.duration || (state.current ? state.current.durationSec : 0);
    updateProgressDom();
  }

  function updateProgressDom() {
    var pct = state.duration ? Math.min(100, (state.position / state.duration) * 100) : 0;
    var bar = $('mp-bar');
    if (bar) bar.style.width = pct + '%';
    var seek = $('seek');
    if (seek && !state.seeking) {
      seek.max = String(Math.max(1, Math.floor(state.duration)));
      seek.value = String(Math.floor(state.position));
      seek.style.setProperty('--p', Math.round(pct) + '%');
    }
    var cur = $('t-cur');
    if (cur) cur.textContent = fmtTime(state.position);
    var dur = $('t-dur');
    if (dur) dur.textContent = fmtTime(state.duration);
  }

  function refreshPlayIcons() {
    renderMini();
    var p = $('player-screen');
    if (!p || p.hidden) return;
    var btn = p.querySelector('.play-big');
    if (btn) btn.innerHTML = state.playing ? ICON.pause : ICON.play;
    var miniBtn = $('miniplayer') ? $('miniplayer').querySelector('.icon-btn') : null;
    if (miniBtn) miniBtn.innerHTML = state.playing ? ICON.pause : ICON.play;
  }

  function setCurrent(song, queue, index) {
    state.current = song;
    rememberSong(song);
    if (queue && queue.length) { state.queue = queue.slice(); state.index = index; }
    else { state.queue = [song]; state.index = 0; }
    state.position = 0;
    state.duration = song.durationSec || 0;
    addRecent(song);
    extractPalette(song);
    if (state.oled) renderOled();
    updateMediaSession(song);
  }

  function playSong(song, queue, index) {
    if (!song) return;
    setCurrent(song, queue, index);
    state.playing = true;
    ensurePlayer(song);
    if (state.yt && state.yt.loadVideoById) {
      try { state.yt.loadVideoById(song.videoId); } catch (e) {}
    }
    render();
    startTick();
  }

  function playList(list, startIndex) {
    list = (list || []).filter(Boolean);
    if (!list.length) { toast('재생할 곡이 없어요'); return; }
    var idx = Math.max(0, Math.min(startIndex || 0, list.length - 1));
    playSong(list[idx], list, idx);
  }

  function togglePlay() {
    var song = currentSong();
    if (!song) { toast('먼저 곡을 선택해 주세요'); return; }
    if (!state.yt) { ensurePlayer(song); state.playing = true; render(); return; }
    try {
      if (state.playing) { state.yt.pauseVideo(); state.playing = false; releaseWakeLock(); stopTick(); }
      else { state.yt.playVideo(); state.playing = true; requestWakeLock(); startTick(); }
    } catch (e) {}
    refreshPlayIcons();
    if (state.oled) renderOled();
  }

  function next(auto) {
    if (!state.queue.length) return;
    if (state.shuffle) {
      var pick = Math.floor(Math.random() * state.queue.length);
      if (state.queue.length > 1 && pick === state.index) pick = (pick + 1) % state.queue.length;
      playSong(state.queue[pick], state.queue, pick);
      return;
    }
    var i = state.index + 1;
    if (i >= state.queue.length) {
      if (state.repeat === 'all' || auto) i = 0;
      else i = state.queue.length - 1;
    }
    playSong(state.queue[i], state.queue, i);
  }

  function prev() {
    if (!state.queue.length) return;
    if (state.yt && state.yt.getCurrentTime && state.yt.getCurrentTime() > 3) {
      try { state.yt.seekTo(0); } catch (e) {}
      return;
    }
    var i = state.index - 1;
    if (i < 0) i = state.repeat === 'all' ? state.queue.length - 1 : 0;
    playSong(state.queue[i], state.queue, i);
  }

  function seekTo(value) {
    var v = Number(value) || 0;
    state.position = v;
    if (state.yt && state.yt.seekTo) { try { state.yt.seekTo(v, true); } catch (e) {} }
    updateProgressDom();
  }

  function toggleShuffle() {
    state.shuffle = !state.shuffle;
    savePrefs();
    toast(state.shuffle ? '셔플 켜짐' : '셔플 꺼짐');
    renderPlayer();
  }

  function cycleRepeat() {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    savePrefs();
    toast(state.repeat === 'off' ? '반복 안 함' : state.repeat === 'all' ? '전체 반복' : '한 곡 반복');
    renderPlayer();
  }

  function setMode(mode) {
    state.mode = mode === 'video' ? 'video' : 'song';
    savePrefs();
    renderPlayer();
    layoutVideoHost();
    if (state.mode === 'video' && state.yt && state.yt.getPlayerState && state.playing) {
      try { state.yt.playVideo(); } catch (e) {}
    }
  }

  /* 유튜브 iframe 을 스테이지 위에 겹쳐 놓는다(동영상 모드). 노래 모드에선 화면 밖으로. */
  function layoutVideoHost() {
    var host = $('yt-host');
    var stage = $('stage');
    if (!host) return;
    if (!stage || state.screen !== 'full' || state.mode !== 'video') {
      host.classList.remove('live');
      host.style.left = '-9999px';
      host.style.top = '0px';
      host.style.width = '320px';
      host.style.height = '180px';
      host.style.borderRadius = '0';
      return;
    }
    var r = stage.getBoundingClientRect ? stage.getBoundingClientRect() : null;
    if (!r || !r.width) return;
    host.classList.add('live');
    host.style.left = r.left + 'px';
    host.style.top = r.top + 'px';
    host.style.width = r.width + 'px';
    host.style.height = r.height + 'px';
    host.style.borderRadius = '16px';
  }

  /* =====================================================================
   * 14. 화면 잠금 · 미디어 세션
   * ===================================================================== */
  function requestWakeLock() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    if (state.wakeLock) return;
    try {
      navigator.wakeLock.request('screen').then(function (lock) {
        state.wakeLock = lock;
        if (lock.addEventListener) {
          lock.addEventListener('release', function () { state.wakeLock = null; });
        }
      }).catch(function () {});
    } catch (e) {}
  }

  function releaseWakeLock() {
    if (state.wakeLock && state.wakeLock.release) {
      try { state.wakeLock.release(); } catch (e) {}
    }
    state.wakeLock = null;
  }

  function updateMediaSession(song) {
    if (!navigator.mediaSession || !song) return;
    try {
      if (window.MediaMetadata) {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: song.title,
          artist: song.artist,
          album: song.playlist || 'YMUSIC',
          artwork: [
            { src: thumb(song.videoId, false), sizes: '320x180', type: 'image/jpeg' },
            { src: thumb(song.videoId, true), sizes: '1280x720', type: 'image/jpeg' }
          ]
        });
      }
      navigator.mediaSession.setActionHandler('play', function () { if (!state.playing) togglePlay(); });
      navigator.mediaSession.setActionHandler('pause', function () { if (state.playing) togglePlay(); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { next(); });
      navigator.mediaSession.setActionHandler('previoustrack', function () { prev(); });
    } catch (e) {}
  }

  /* =====================================================================
   * 15. OLED 절전 모드
   * ===================================================================== */
  function openOled() {
    var el = $('oled');
    if (!el) return;
    state.prevScreen = state.screen;
    state.screen = 'oled';
    state.oled = true;
    if (document.body && document.body.classList) document.body.classList.add('no-scroll');
    el.hidden = false;
    renderOled();
    startClock();
  }

  function renderOled() {
    var el = $('oled');
    if (!el || el.hidden) return;
    var song = currentSong();
    el.innerHTML =
      '<div class="clock" id="oled-clock">' + clockText() + '</div>' +
      '<div class="line"></div>' +
      '<div class="t">' + esc(song ? song.title : '재생 중인 곡 없음') + '</div>' +
      '<div class="a">' + esc(song ? song.artist : '') + '</div>' +
      '<button class="oled-exit" data-act="close-oled">두 번 탭하거나 눌러서 절전 해제</button>' +
      '<button class="oled-play icon-btn" data-act="toggle-play" aria-label="재생/일시정지">' + (state.playing ? ICON.pause : ICON.play) + '</button>';
  }

  function clockText() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function startClock() {
    stopClock();
    state.clockTimer = setInterval(function () {
      var c = $('oled-clock');
      if (c) c.textContent = clockText();
    }, 10000);
  }
  function stopClock() {
    if (state.clockTimer) { clearInterval(state.clockTimer); state.clockTimer = null; }
  }

  function closeOled() {
    var el = $('oled');
    if (el) { el.hidden = true; el.innerHTML = ''; }
    state.oled = false;
    stopClock();
    state.screen = state.prevScreen === 'full' ? 'full' : 'none';
    if (state.screen === 'none' && document.body && document.body.classList) document.body.classList.remove('no-scroll');
    if (state.screen === 'none') {
      var ps = $('player-screen');
      if (ps) { ps.hidden = true; ps.innerHTML = ''; }
    }
    render();
  }

  /* =====================================================================
   * 16. 좋아요 · 최근 · 재생목록
   * ===================================================================== */
  function toggleLike(id) {
    var song = songFromVideoId(id) || (currentSong() && currentSong().videoId === id ? currentSong() : null);
    if (!song) return;
    if (state.liked[id]) delete state.liked[id];
    else { state.liked[id] = song; rememberSong(song); }
    saveLikes();
    indexCache();
    toast(state.liked[id] ? '좋아요에 추가했어요' : '좋아요에서 뺐어요');
    render();
    if (state.screen === 'full') renderPlayer();
  }

  function addRecent(song) {
    if (!song) return;
    state.recent = (state.recent || []).filter(function (r) { return r && r.videoId !== song.videoId; });
    rememberSong(song);
    state.recent.unshift({ videoId: song.videoId, at: Date.now(), song: song });
    state.recent = state.recent.slice(0, 40);
    saveRecent();
    indexCache();
  }

  function createPlaylist(name) {
    name = String(name || '').trim();
    if (!name) { toast('이름을 입력해 주세요'); return null; }
    var pl = { id: uid(), name: name, songIds: [], createdAt: Date.now() };
    state.playlists.unshift(pl);
    savePlaylists();
    toast('재생목록 “' + name + '”을 만들었어요');
    render();
    return pl;
  }

  function addToPlaylist(playlistId, songId) {
    var pl = null;
    for (var i = 0; i < state.playlists.length; i++) if (state.playlists[i].id === playlistId) pl = state.playlists[i];
    if (!pl) return false;
    if (!pl.songIds) pl.songIds = [];
    if (pl.songIds.indexOf(songId) >= 0) { toast('이미 들어 있는 곡이에요'); return false; }
    var song = songFromVideoId(songId);
    if (!song) return false;
    pl.songIds.push(songId);
    rememberSong(song);
    savePlaylists();
    toast('“' + pl.name + '”에 추가했어요');
    closeModal();
    render();
    return true;
  }

  function removeFromPlaylist(playlistId, songId) {
    for (var i = 0; i < state.playlists.length; i++) {
      var pl = state.playlists[i];
      if (pl.id === playlistId) {
        pl.songIds = (pl.songIds || []).filter(function (x) { return x !== songId; });
        savePlaylists();
        render();
        openMyPlaylist(playlistId);
        return true;
      }
    }
    return false;
  }

  function deletePlaylist(playlistId) {
    state.playlists = state.playlists.filter(function (p) { return p.id !== playlistId; });
    savePlaylists();
    closeSheet();
    render();
    toast('재생목록을 삭제했어요');
  }

  /* =====================================================================
   * 17. 시트 / 모달 / 토스트
   * ===================================================================== */
  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      el.classList.remove('show');
    }, 2200);
  }

  function openSheet(html, title) {
    var el = $('sheet');
    if (!el) return;
    el.innerHTML = '<div class="sheet-grip"></div>' +
      (title ? '<div class="sheet-head"><h3>' + esc(title) + '</h3><button class="icon-btn" data-act="close-sheet">' + ICON.close + '</button></div>' : '') +
      html;
    el.hidden = false;
    showBackdrop(true);
    state.sheet = title || 'open';
  }

  function closeSheet() {
    var el = $('sheet');
    if (el) { el.hidden = true; el.innerHTML = ''; }
    state.sheet = null;
    if (!state.modal) showBackdrop(false);
  }

  function openModal(html) {
    var el = $('modal');
    if (!el) return;
    el.innerHTML = html;
    el.hidden = false;
    showBackdrop(true);
    state.modal = 'open';
  }

  function closeModal() {
    var el = $('modal');
    if (el) { el.hidden = true; el.innerHTML = ''; }
    state.modal = null;
    if (!state.sheet) showBackdrop(false);
  }

  function showBackdrop(on) {
    var el = $('backdrop');
    if (el) el.hidden = !on;
  }

  function openQueue() {
    var rows = state.queue.map(function (s, i) {
      return '<button class="pl-item" data-act="queue-jump" data-id="' + i + '"' + (i === state.index ? ' style="color:var(--accent)"' : '') + '>' +
        '<span class="th" style="width:36px;height:36px;flex:0 0 36px;border-radius:6px;overflow:hidden">' + imgTag(s) + '</span>' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.title) + '</span>' +
        '<span style="color:var(--dim);font-size:11px">' + esc(s.duration || '') + '</span></button>';
    }).join('');
    openSheet(
      '<div class="result-note">' + state.queue.length + '곡 · 지금 ' + (state.index + 1) + '번째</div>' +
      '<div class="pl-list" style="max-height:52vh">' + (rows || '<div class="empty">대기열이 비어 있어요</div>') + '</div>' +
      '<div class="btn-row"><button class="btn" data-act="clear-queue">대기열 비우기</button>' +
      '<button class="btn primary" data-act="shuffle-all">셔플 재생</button></div>',
      '다음 트랙'
    );
  }

  function openSimilar() {
    var song = currentSong();
    var list = similarSongs(song, 16);
    var rows = list.map(function (s, i) { return trackRowHTML(s, i, { menu: true }); }).join('');
    openSheet('<div class="track-list">' + (rows || '<div class="empty">비슷한 곡을 찾지 못했어요</div>') + '</div>', '비슷한 곡');
  }

  function openPlaylistGroup(name) {
    var songs = sortedByViews(allSongs().filter(function (s) { return s.playlist === name; }));
    if (!songs.length) return;
    openSheet(
      '<div class="result-note">' + songs.length + '곡</div>' +
      '<div class="btn-row" style="margin-bottom:8px"><button class="btn primary" data-act="play-group" data-id="' + esc(name) + '">전체 재생</button></div>' +
      '<div class="track-list">' + songs.map(function (s, i) { return trackRowHTML(s, i, { menu: true }); }).join('') + '</div>',
      name
    );
  }

  function openMyPlaylist(id) {
    var pl = null;
    for (var i = 0; i < state.playlists.length; i++) if (state.playlists[i].id === id) pl = state.playlists[i];
    if (!pl) { toast('재생목록을 찾을 수 없어요'); return; }
    var songs = (pl.songIds || []).map(songFromVideoId).filter(Boolean);
    openSheet(
      '<div class="result-note">' + songs.length + '곡</div>' +
      '<div class="btn-row" style="margin-bottom:8px">' +
      '<button class="btn primary" data-act="play-mine" data-id="' + esc(id) + '">전체 재생</button>' +
      '<button class="btn ghost" data-act="delete-playlist" data-id="' + esc(id) + '">삭제</button></div>' +
      '<div class="track-list">' + (songs.length ? songs.map(function (s, i) { return trackRowHTML(s, i, { removePlaylist: true }); }).join('') : '<div class="empty">아직 곡이 없어요. 곡 옆 ⋮ 에서 추가할 수 있어요.</div>') + '</div>',
      pl.name
    );
  }

  function openAddToPlaylist(songId) {
    var song = songFromVideoId(songId);
    if (!song) return;
    var list = state.playlists.map(function (p) {
      return '<button class="pl-item" data-act="add-to" data-id="' + esc(p.id) + '" data-song="' + esc(songId) + '">' + ICON.queue +
        '<span style="flex:1">' + esc(p.name) + '</span><span style="color:var(--dim);font-size:11px">' + p.songIds.length + '곡</span></button>';
    }).join('');
    openModal(
      '<h3>재생목록에 추가</h3>' +
      '<p class="hint">' + esc(song.title) + ' — ' + esc(song.artist) + '</p>' +
      '<div class="pl-list">' + (list || '<div class="empty" style="padding:14px">아직 재생목록이 없어요</div>') + '</div>' +
      '<div class="field"><span>새 재생목록</span><input id="new-pl-name" type="text" placeholder="예: 밤 드라이브" maxlength="40"></div>' +
      '<div class="btn-row"><button class="btn ghost" data-act="close-modal">닫기</button>' +
      '<button class="btn primary" data-act="new-pl-add" data-id="' + esc(songId) + '">만들고 추가</button></div>'
    );
  }

  function openTrackMenu(songId) {
    var song = songFromVideoId(songId);
    if (!song) return;
    openSheet(
      '<div class="result-note">' + esc(song.title) + ' — ' + esc(song.artist) + '</div>' +
      '<div class="track-list">' +
      '<button class="lib-row" data-act="play-now" data-id="' + esc(songId) + '"><span class="cover">' + ICON.play + '</span><span class="meta"><span class="t">지금 재생</span></span></button>' +
      '<button class="lib-row" data-act="add-to-open" data-id="' + esc(songId) + '"><span class="cover">' + ICON.plus + '</span><span class="meta"><span class="t">재생목록에 추가</span></span></button>' +
      '<button class="lib-row" data-act="queue-add" data-id="' + esc(songId) + '"><span class="cover">' + ICON.queue + '</span><span class="meta"><span class="t">대기열 맨 뒤에 추가</span></span></button>' +
      '<button class="lib-row" data-act="toggle-like" data-id="' + esc(songId) + '"><span class="cover">' + (state.liked[songId] ? ICON.heart : ICON.heartOutline) + '</span><span class="meta"><span class="t">' + (state.liked[songId] ? '좋아요 해제' : '좋아요') + '</span></span></button>' +
      '</div>'
    );
  }

  function openSettings() {
    var key = state.settings.apiKey || '';
    openModal(
      '<h3>설정</h3>' +
      '<p class="hint">YouTube Data API v3 키를 넣으면 탐색 탭에서 <b>전 세계 모든 곡을 실시간 검색</b>할 수 있어요. 키는 이 기기의 localStorage 에만 저장됩니다.</p>' +
      '<label class="field"><span>YouTube Data API v3 키</span>' +
      '<input id="api-key-input" type="text" placeholder="AIza…" value="' + esc(key) + '" spellcheck="false" autocomplete="off"></label>' +
      '<div class="btn-row"><button class="btn ghost" data-act="test-key">연결 테스트</button>' +
      '<button class="btn primary" data-act="save-key">저장</button></div>' +
      '<div id="key-note"></div>' +
      '<div class="sect" style="margin-top:20px">' +
      '<div class="field"><span>내장 라이브러리</span>' +
      '<div class="hint" style="margin:0">' + (state.data.count || allSongs().length) + '곡 · ' + esc((state.data.generatedAt || '').slice(0, 10)) + ' 수집<br>' +
      'API 키가 없어도 이 목록으로 검색·재생됩니다.</div></div>' +
      '<div class="btn-row"><button class="btn" data-act="refresh-data">내장 데이터 새로고침</button></div>' +
      '<div class="btn-row" style="margin-top:8px"><button class="btn ghost" data-act="clear-cache">앱 캐시 비우기</button>' +
      '<button class="btn ghost" data-act="reset-app">저장 데이터 초기화</button></div>' +
      '</div>' +
      '<p class="hint" style="margin-top:16px;opacity:.6">YMUSIC v' + APP_VERSION + ' · YouTube IFrame 플레이어 기반 개인용 앱</p>' +
      '<div class="btn-row"><button class="btn" data-act="close-modal">닫기</button></div>'
    );
  }

  function openPlayer() {
    if (!currentSong()) return;
    state.screen = 'full';
    if (document.body && document.body.classList) document.body.classList.add('no-scroll');
    renderMini();
    renderPlayer();
    layoutVideoHost();
  }

  function closePlayer() {
    state.screen = 'none';
    if (document.body && document.body.classList) document.body.classList.remove('no-scroll');
    var el = $('player-screen');
    if (el) { el.hidden = true; el.innerHTML = ''; }
    layoutVideoHost();
    render();
  }

  /* =====================================================================
   * 18. 이벤트
   * ===================================================================== */
  function onClick(e) {
    var target = e.target;
    var el = target && target.closest ? target.closest('[data-act]') : null;
    if (!el) {
      if (target && target.id === 'sheet') closeSheet();
      return;
    }
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');

    switch (act) {
      case 'tab': go('#/' + id); break;
      case 'go-explore': go('#/explore'); break;
      case 'go-library':
        state.libraryTab = id || 'liked';
        go('#/library');
        break;
      case 'filter':
        state.homeFilter = id;
        render();
        break;
      case 'play-card': {
        var list = sortedByViews(filteredSongs());
        var idx = 0;
        for (var i = 0; i < list.length; i++) if (list[i].videoId === id) idx = i;
        playList(list, idx);
        break;
      }
      case 'play-track': {
        var song = songFromVideoId(id);
        if (!song) break;
        if (state.sheet) {
          var sheetList = sheetSongs();
          var si = 0;
          for (var j = 0; j < sheetList.length; j++) if (sheetList[j].videoId === id) si = j;
          playList(sheetList, si);
        } else if (state.explore.results && state.explore.results.length) {
          var ri = 0;
          for (var q = 0; q < state.explore.results.length; q++) if (state.explore.results[q].videoId === id) ri = q;
          playList(state.explore.results, ri);
        } else {
          playList([song], 0);
        }
        break;
      }
      case 'play-now': playList([songFromVideoId(id)], 0); closeSheet(); break;
      case 'toggle-play': togglePlay(); break;
      case 'next': next(); break;
      case 'prev': prev(); break;
      case 'shuffle': toggleShuffle(); break;
      case 'repeat': cycleRepeat(); break;
      case 'mode': setMode(id); break;
      case 'open-player': openPlayer(); break;
      case 'close-player': closePlayer(); break;
      case 'open-oled': openOled(); break;
      case 'close-oled': closeOled(); break;
      case 'oled-tap': {
        var now = Date.now();
        if (now - state.lastTap < 420) { closeOled(); }
        state.lastTap = now;
        break;
      }
      case 'toggle-like': toggleLike(id); break;
      case 'open-settings': openSettings(); break;
      case 'close-modal': closeModal(); break;
      case 'close-sheet': closeSheet(); break;
      case 'close-overlay':
        if (state.modal) closeModal();
        else if (state.sheet) closeSheet();
        break;
      case 'lib-tab': state.libraryTab = id; render(); break;
      case 'open-queue': openQueue(); break;
      case 'open-similar': openSimilar(); break;
      case 'open-quality': openQualitySheet(); break;
      case 'set-quality': {
        state.settings.quality = id || 'highres';
        saveSettings();
        applyAudioQuality(state.yt);
        toast('음질 설정: ' + qualityLabelShort(state.settings.quality));
        closeSheet();
        renderPlayer();
        break;
      }
      case 'open-playlist': openPlaylistGroup(id); break;
      case 'open-my-playlist': openMyPlaylist(id); break;
      case 'play-mine': {
        var pl = null;
        for (var k = 0; k < state.playlists.length; k++) if (state.playlists[k].id === id) pl = state.playlists[k];
        if (pl) playList((pl.songIds || []).map(songFromVideoId).filter(Boolean), 0);
        closeSheet();
        break;
      }
      case 'play-group': {
        var groupSongs = sortedByViews(allSongs().filter(function (s) { return s.playlist === id; }));
        playList(groupSongs, 0);
        closeSheet();
        break;
      }
      case 'add-to': addToPlaylist(id, el.getAttribute('data-song')); break;
      case 'add-to-open': closeSheet(); openAddToPlaylist(id); break;
      case 'new-playlist': {
        openModal('<h3>새 재생목록</h3><p class="hint">이름을 정해 주세요.</p>' +
          '<label class="field"><span>재생목록 이름</span><input id="new-pl-name" type="text" placeholder="예: 출근길" maxlength="40"></label>' +
          '<div class="btn-row"><button class="btn ghost" data-act="close-modal">취소</button>' +
          '<button class="btn primary" data-act="create-pl">만들기</button></div>');
        break;
      }
      case 'create-pl': {
        var inp = $('new-pl-name');
        if (createPlaylist(inp ? inp.value : '')) { closeModal(); state.libraryTab = 'playlists'; render(); }
        break;
      }
      case 'new-pl-add': {
        var inp2 = $('new-pl-name');
        var created = createPlaylist(inp2 ? inp2.value : '');
        if (created) addToPlaylist(created.id, id);
        break;
      }
      case 'delete-playlist': deletePlaylist(id); break;
      case 'pl-remove': {
        var currentPl = null;
        var sheetTitleEl = $('sheet') ? $('sheet').querySelector('h3') : null;
        var titleText = sheetTitleEl ? sheetTitleEl.textContent : '';
        for (var m = 0; m < state.playlists.length; m++) if (state.playlists[m].name === titleText) currentPl = state.playlists[m];
        if (currentPl) removeFromPlaylist(currentPl.id, id);
        break;
      }
      case 'queue-add': {
        var qs = songFromVideoId(id);
        if (qs) { state.queue.push(qs); toast('대기열에 추가했어요'); closeSheet(); }
        break;
      }
      case 'queue-jump': {
        var qi = parseInt(id, 10);
        if (!isNaN(qi) && state.queue[qi]) playSong(state.queue[qi], state.queue, qi);
        closeSheet();
        break;
      }
      case 'clear-queue': state.queue = state.playing && state.current ? [state.current] : []; state.index = state.queue.length - 1; closeSheet(); render(); break;
      case 'track-menu': openTrackMenu(id); break;
      case 'genre-more': go('#/explore?genre=' + encodeURIComponent(id)); break;
      case 'clear-search': state.explore.q = ''; state.explore.results = null; render(); break;
      case 'shuffle-all': {
        var pool = filteredSongs();
        for (var s = pool.length - 1; s > 0; s--) {
          var r = Math.floor(Math.random() * (s + 1));
          var tmp = pool[s]; pool[s] = pool[r]; pool[r] = tmp;
        }
        playList(pool, 0);
        if (state.sheet) closeSheet();
        break;
      }
      case 'play-liked': playList(likedSongs(), 0); break;
      case 'save-key': {
        var ki = $('api-key-input');
        state.settings.apiKey = ki ? ki.value.trim() : '';
        saveSettings();
        setKeyNote('키를 저장했어요. 탐색 탭에서 검색해 보세요.', true);
        render();
        break;
      }
      case 'test-key': {
        var kt = $('api-key-input');
        var key = kt ? kt.value.trim() : '';
        if (!key) { setKeyNote('키를 먼저 입력해 주세요.', false); break; }
        setKeyNote('확인 중…', true);
        testApiKey(key).then(function (n) {
          setKeyNote('연결 성공! 검색 API가 정상 동작합니다.', true);
        }).catch(function (err) {
          setKeyNote('연결 실패: ' + (err && err.message ? err.message : '키를 확인해 주세요'), false);
        });
        break;
      }
      case 'refresh-data': refreshData(); break;
      case 'clear-cache': clearAppCache(); break;
      case 'reset-app': resetApp(); break;
    }
  }

  function setKeyNote(msg, ok) {
    var el = $('key-note');
    if (!el) { toast(msg); return; }
    el.className = ok ? 'note-ok' : 'note-err';
    el.textContent = msg;
  }

  function sheetSongs() {
    var sheet = $('sheet');
    if (!sheet) return [];
    var ids = [];
    var nodes = sheet.querySelectorAll('[data-act="play-track"]');
    for (var i = 0; i < nodes.length; i++) {
      var sid = nodes[i].getAttribute('data-id');
      if (sid && ids.indexOf(sid) < 0) ids.push(sid);
    }
    return ids.map(songFromVideoId).filter(Boolean);
  }

  function onInput(e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'search-input') {
      var v = t.value;
      state.explore.q = v;
      if (!v) { state.explore.results = null; state.explore.loading = false; render(); return; }
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(function () { runSearch(v); }, 380);
    } else if (t.id === 'seek') {
      state.seeking = true;
      var val = Number(t.value) || 0;
      state.position = val;
      var pct = state.duration ? (val / state.duration) * 100 : 0;
      t.style.setProperty('--p', Math.round(pct) + '%');
      var cur = $('t-cur');
      if (cur) cur.textContent = fmtTime(val);
    }
  }

  function onChange(e) {
    var t = e.target;
    if (t && t.id === 'seek') {
      state.seeking = false;
      seekTo(t.value);
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (state.modal) closeModal();
      else if (state.sheet) closeSheet();
      else if (state.oled) closeOled();
      else if (state.screen === 'full') closePlayer();
    }
    if (e.code === 'Space' && state.screen === 'full' && e.target && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      togglePlay();
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible' && state.playing) requestWakeLock();
  }

  function onResize() { layoutVideoHost(); }

  /* =====================================================================
   * 19. 설정 동작
   * ===================================================================== */
  function refreshData() {
    toast('최신 목록을 받아오는 중…');
    loadData().then(function () {
      toast('내장 데이터를 새로고침했어요 · ' + (state.data.count || allSongs().length) + '곡');
      closeModal();
      render();
    }).catch(function () {
      toast('새로고침에 실패했어요 (오프라인일 수 있어요)');
    });
  }

  function clearAppCache() {
    if (!('caches' in window)) { toast('이 브라우저는 캐시를 지원하지 않아요'); return; }
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(function () { toast('앱 캐시를 비웠어요. 새로고침하면 다시 받아옵니다.'); });
  }

  function resetApp() {
    try {
      Object.keys(STORE).forEach(function (k) { localStorage.removeItem(STORE[k]); });
    } catch (e) {}
    state.liked = {};
    state.playlists = [];
    state.recent = [];
    state.settings = { apiKey: '' };
    closeModal();
    render();
    toast('저장된 데이터를 초기화했어요');
  }

  /* =====================================================================
   * 20. 데이터 로드 · 부트
   * ===================================================================== */
  function loadData() {
    return fetch('data/music.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('data ' + r.status);
      return r.json();
    }).then(function (json) {
      state.data = {
        songs: (json.songs || []),
        genres: (json.genres || []),
        count: json.count || (json.songs || []).length,
        generatedAt: json.generatedAt || '',
        sources: json.sources || []
      };
      indexCache();
      state.loaded = true;
      return state.data;
    });
  }

  function registerServiceWorker() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.register) return;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
      if (reg && reg.update) { try { reg.update(); } catch (e) {} }
      if (reg && reg.addEventListener) {
        reg.addEventListener('updatefound', function () {});
      }
    }).catch(function () {});
    if (navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (state.reloadedBySW) return;
        state.reloadedBySW = true;
        location.reload();
      });
    }
  }

  function bindEvents() {
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', function () { setTimeout(layoutVideoHost, 220); });
    window.addEventListener('hashchange', function () {
      state.route = parseHash();
      if (state.route.name === 'explore') {
        if (state.route.q) state.explore.q = state.route.q;
        state.route.genre = state.route.genre || 'all';
      }
      render();
    });
  }

  function boot() {
    loadPersisted();
    bindEvents();
    registerServiceWorker();
    state.route = parseHash();
    if (state.route.name === 'explore') {
      state.explore.q = state.route.q || '';
      state.explore.genre = state.route.genre || 'all';
    }
    loadData().then(function () {
      render();
      if (state.explore.q) runSearch(state.explore.q);
    }).catch(function () {
      render();
      toast('음악 목록을 불러오지 못했어요');
    });
  }

  /* YT IFrame API 콜백은 전역이어야 한다. */
  window.onYouTubeIframeAPIReady = function () {
    state.ytReady = true;
    var song = state.pendingSong || state.current;
    if (song) {
      state.pendingSong = null;
      ensurePlayer(song);
    }
  };

  /* 테스트 하네스에서 내부 함수를 호출할 수 있게 노출 */
  window.__ym = {
    state: state,
    boot: boot,
    render: render,
    renderHome: renderHome,
    renderExplore: renderExplore,
    renderLibrary: renderLibrary,
    renderPlayer: renderPlayer,
    renderMini: renderMini,
    renderOled: renderOled,
    localSearch: localSearch,
    runSearch: runSearch,
    searchResultsHTML: searchResultsHTML,
    paintSearch: paintSearch,
    apiSearch: apiSearch,
    parseISODuration: parseISODuration,
    playList: playList,
    playSong: playSong,
    togglePlay: togglePlay,
    next: next,
    prev: prev,
    seekTo: seekTo,
    setMode: setMode,
    toggleShuffle: toggleShuffle,
    cycleRepeat: cycleRepeat,
    toggleLike: toggleLike,
    addRecent: addRecent,
    createPlaylist: createPlaylist,
    addToPlaylist: addToPlaylist,
    removeFromPlaylist: removeFromPlaylist,
    deletePlaylist: deletePlaylist,
    openOled: openOled,
    closeOled: closeOled,
    openOledForce: function () { openOled(); },
    openQueue: openQueue,
    openSimilar: openSimilar,
    openSettings: openSettings,
    closeModal: closeModal,
    closeSheet: closeSheet,
    openPlayer: openPlayer,
    closePlayer: closePlayer,
    openAddToPlaylist: openAddToPlaylist,
    clockText: clockText,
    filteredSongs: filteredSongs,
    playlistGroups: playlistGroups,
    similarSongs: similarSongs,
    songById: songById,
    likedSongs: likedSongs,
    indexCache: indexCache,
    rememberSong: rememberSong,
    fmtTime: fmtTime,
    fmtViews: fmtViews,
    esc: esc,
    layoutVideoHost: layoutVideoHost,
    extractPalette: extractPalette,
    gradientFor: gradientFor,
    onClick: onClick,
    onInput: onInput,
    onKeydown: onKeydown,
    searchResultsHTML: searchResultsHTML,
    openPlaylistGroup: openPlaylistGroup,
    openTrackMenu: openTrackMenu
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
