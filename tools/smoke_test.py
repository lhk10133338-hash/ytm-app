#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YMUSIC 스모크 테스트 (개발용, 배포물 아님).

quickjs 로 js/app.js 를 실제로 실행해
  · JS 문법/로딩
  · 홈·탐색·보관함·풀플레이어·OLED 화면 렌더
  · 내장 검색 / API 키 실시간 검색(모의 응답) 로직
  · 좋아요·재생목록 생성/추가/삭제·최근 감상
  · 대기열 다음/이전·셔플·반복, 노래/동영상 모드, 절전 모드 진입·복귀
  · HTML/CSS 정합성, 데이터(music.json) 품질, PWA 구성
를 확인한다.

실행: python3 tools/smoke_test.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import quickjs

ROOT = Path(__file__).resolve().parent.parent
APP = (ROOT / "js" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "css" / "style.css").read_text(encoding="utf-8")
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
SW = (ROOT / "sw.js").read_text(encoding="utf-8")
DATA = json.loads((ROOT / "data" / "music.json").read_text(encoding="utf-8"))

API_SEARCH = {
    "items": [
        {"id": {"videoId": "aaa111"}},
        {"id": {"videoId": "bbb222"}},
        {"id": {"videoId": "ccc333"}},
        {"id": {"videoId": "ddd444"}},
    ]
}
API_VIDEOS = {
    "items": [
        {"id": "aaa111", "snippet": {"title": "테스트 곡 A", "channelTitle": "테스트 아티스트",
                                     "thumbnails": {"medium": {"url": "https://i.ytimg.com/vi/aaa111/mqdefault.jpg"}}},
         "contentDetails": {"duration": "PT3M21S"}, "status": {"embeddable": True, "privacyStatus": "public"}},
        {"id": "bbb222", "snippet": {"title": "임베드 불가 곡", "channelTitle": "X",
                                     "thumbnails": {}},
         "contentDetails": {"duration": "PT4M1S"}, "status": {"embeddable": False, "privacyStatus": "public"}},
        {"id": "ccc333", "snippet": {"title": "한국 차단 곡", "channelTitle": "Y",
                                     "thumbnails": {}},
         "contentDetails": {"duration": "PT2M30S"},
         "status": {"embeddable": True, "privacyStatus": "public"},
         "contentDetails_region": {"regionRestriction": {"blocked": ["KR"]}}},
        {"id": "ddd444", "snippet": {"title": "짧은 곡 D", "channelTitle": "테스트 아티스트",
                                     "thumbnails": {}},
         "contentDetails": {"duration": "PT2M5S"}, "status": {"embeddable": True, "privacyStatus": "public"}},
    ]
}
# regionRestriction 은 contentDetails 안에 들어간다 — 위 항목을 실제 구조로 보정
API_VIDEOS["items"][2]["contentDetails"]["regionRestriction"] = {"blocked": ["KR"]}
API_VIDEOS["items"][2].pop("contentDetails_region", None)

STUBS = r"""
globalThis.window = globalThis;
window.innerWidth = 390;
window.innerHeight = 820;
window.addEventListener = function(){};
window.scrollTo = function(){};

var __store = {};
globalThis.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(__store, k) ? __store[k] : null; },
  setItem: function (k, v) { __store[k] = String(v); },
  removeItem: function (k) { delete __store[k]; }
};

function styleObj() {
  return { setProperty: function (k, v) { this[k] = v; }, removeProperty: function (k) { delete this[k]; } };
}

function El(id) {
  this.id = id || '';
  this.innerHTML = '';
  this.textContent = '';
  this.hidden = false;
  this.className = '';
  this.style = styleObj();
  this.dataset = {};
  this._attrs = {};
  this.children = [];
  var self = this;
  this.classList = {
    _s: {},
    add: function (c) { this._s[c] = 1; self.className += ' ' + c; },
    remove: function (c) { delete this._s[c]; self.className = self.className.split(' ').filter(function (x) { return x !== c; }).join(' '); },
    contains: function (c) { return (' ' + self.className + ' ').indexOf(' ' + c + ' ') >= 0; },
    toggle: function (c) { if (this.contains(c)) this.remove(c); else this.add(c); }
  };
}
El.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); this['_' + k] = v; };
El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; };
El.prototype.addEventListener = function () {};
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.removeChild = function () {};
El.prototype.remove = function () {};
El.prototype.querySelector = function () { return null; };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.closest = function () { return null; };
El.prototype.focus = function () {};
El.prototype.getBoundingClientRect = function () { return { left: 10, top: 100, width: 300, height: 300 }; };

var __els = {};
function el(id) { if (!__els[id]) __els[id] = new El(id); return __els[id]; }

globalThis.document = {
  readyState: 'loading',
  visibilityState: 'visible',
  hidden: false,
  addEventListener: function () {},
  getElementById: function (id) {
    if (id === 'view' || id === 'topbar' || id === 'tabbar' || id === 'miniplayer' ||
        id === 'player-screen' || id === 'sheet' || id === 'modal' || id === 'oled' ||
        id === 'toast' || id === 'yt-host' || id === 'ytplayer' || id === 'stage') return el(id);
    return null;
  },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function (tag) { return new El(tag); },
  head: { appendChild: function () {} },
  body: new El('body')
};

globalThis.location = { hash: '#/home', origin: 'https://example.github.io', reload: function () {} };
globalThis.history = { replaceState: function () {}, pushState: function () {} };
globalThis.navigator = {
  serviceWorker: { register: function () { return thenable({}); }, addEventListener: function () {} },
  wakeLock: { request: function () { return thenable({ release: function () {}, addEventListener: function () {} }); } }
};
globalThis.caches = { keys: function () { return thenable([]); }, delete: function () { return thenable(true); }, open: function () { return thenable({ put: function () {}, addAll: function () {} }); }, match: function () { return thenable(null); } };
globalThis.MediaMetadata = function (o) { this.o = o; };

var __timers = [];
globalThis.setInterval = function (fn) { __timers.push(fn); return __timers.length; };
globalThis.clearInterval = function () {};
globalThis.setTimeout = function (fn) { return 1; };
globalThis.clearTimeout = function () {};

function thenable(value) {
  return {
    then: function (fn) {
      var out;
      try { out = fn ? fn(value) : value; } catch (e) { return { then: function () { return this; }, catch: function (f) { f(e); return this; } }; }
      if (out && typeof out.then === 'function') return out;
      return thenable(out);
    },
    catch: function () { return this; }
  };
}

globalThis.fetch = function (url) {
  var u = String(url);
  if (u.indexOf('googleapis.com/youtube/v3/search') >= 0) {
    return thenable({ ok: true, status: 200, json: function () { return thenable(API_SEARCH); } });
  }
  if (u.indexOf('googleapis.com/youtube/v3/videos') >= 0) {
    return thenable({ ok: true, status: 200, json: function () { return thenable(API_VIDEOS); } });
  }
  return thenable({ ok: true, status: 200, json: function () { return thenable(DATA_JSON); } });
};
"""


def run_js(ctx, code):
    return ctx.eval(code)


def main() -> int:
    problems = []
    notes = []

    # ---------- 1) 데이터 품질 ----------
    songs = DATA.get("songs", [])
    notes.append(f"수집 곡 수: {len(songs)}")
    if len(songs) < 100:
        problems.append(f"곡이 100곡 미만입니다 ({len(songs)})")

    required = ["videoId", "title", "artist", "duration", "durationSec", "thumbnail", "genre", "playlist"]
    missing = 0
    ids = set()
    dupes = 0
    bad_dur = 0
    bad_embed = 0
    for s in songs:
        for field in required:
            if s.get(field) in (None, ""):
                missing += 1
        if s.get("videoId") in ids:
            dupes += 1
        ids.add(s.get("videoId"))
        if not (30 <= int(s.get("durationSec") or 0) <= 4000):
            bad_dur += 1
        if s.get("embedOk") is False:
            bad_embed += 1
    if missing:
        problems.append(f"필수 필드 누락 {missing}건")
    if dupes:
        problems.append(f"videoId 중복 {dupes}건")
    if bad_dur:
        problems.append(f"비정상 길이 {bad_dur}건")
    if bad_embed:
        problems.append(f"임베드 불가 곡이 포함됨 {bad_embed}건")

    genres = DATA.get("genres", [])
    notes.append("장르: " + ", ".join(genres))
    if len(genres) < 5:
        problems.append("장르 종류가 5개 미만입니다")

    # ---------- 2) HTML / CSS / PWA 정합성 ----------
    for el_id in ["view", "topbar", "tabbar", "miniplayer", "player-screen", "sheet", "modal", "oled", "toast", "yt-host", "ytplayer"]:
        if f'id="{el_id}"' not in HTML:
            problems.append(f"index.html 에 #{el_id} 없음")

    if CSS.count("{") != CSS.count("}"):
        problems.append("CSS 중괄호 불일치")
    for selector in ["@media (max-width: 390px)", "@media (min-width: 680px)", ".player-screen", ".oled", ".miniplayer", ".tabbar", "#ff0033", "#030303"]:
        if selector not in CSS:
            problems.append(f"CSS 에 {selector} 규칙 없음")
    if "orientation: landscape" not in CSS and "orientation:landscape" not in CSS:
        problems.append("CSS 가로모드 대응 없음")

    if MANIFEST.get("name") != "YMUSIC" or MANIFEST.get("short_name") != "YMUSIC":
        problems.append("manifest.json 의 name/short_name 이 YMUSIC 이 아님")
    for icon in MANIFEST.get("icons", []):
        if not (ROOT / icon["src"]).exists():
            problems.append(f"아이콘 파일 없음: {icon['src']}")
    if (ROOT / "icons" / "icon.svg").exists() is False:
        problems.append("icons/icon.svg 없음")

    if "updateViaCache: 'none'" not in APP:
        problems.append("serviceWorker 등록에 updateViaCache: 'none' 없음")
    if "controllerchange" not in APP:
        problems.append("controllerchange 자동 리로드 처리 없음")
    if "caches" not in SW or "addEventListener('fetch'" not in SW:
        problems.append("sw.js 네트워크 우선 캐시 처리 없음")

    # data-act 일관성: 마크업에서 쓰는 액션이 JS switch 에 있는지
    actions = set(re.findall(r'data-act="([a-z\-]+)"', APP + HTML))
    cases = set(re.findall(r"case '([a-z\-]+)':", APP))
    unknown = sorted(actions - cases - {"oled-tap"} if "oled-tap" not in cases else actions - cases)
    if unknown:
        problems.append("처리되지 않는 data-act: " + ", ".join(unknown))

    # ---------- 3) quickjs 로 앱 실행 ----------
    ctx = quickjs.Context()
    ctx.eval("var DATA_JSON = " + json.dumps(DATA, ensure_ascii=False) + ";")
    ctx.eval("var API_SEARCH = " + json.dumps(API_SEARCH, ensure_ascii=False) + ";")
    ctx.eval("var API_VIDEOS = " + json.dumps(API_VIDEOS, ensure_ascii=False) + ";")
    ctx.eval(STUBS)
    try:
        ctx.eval(APP)
    except quickjs.JSException as exc:  # noqa: BLE001
        print("APP LOAD FAILED:", str(exc)[:1500])
        return 1

    try:
        ctx.eval("__ym.boot();")
    except quickjs.JSException as exc:  # noqa: BLE001
        print("BOOT FAILED:", str(exc)[:1500])
        return 1

    def js(expr):
        return ctx.eval(expr)

    def text_of(expr):
        return str(js(expr))

    if js("__ym.state.loaded") is not True:
        problems.append("데이터 로드 실패(__ym.state.loaded)")
    if js("__ym.state.data.songs.length") != len(songs):
        problems.append("앱이 읽은 곡 수가 JSON 과 다름")

    # ---------- 4) 화면 렌더 ----------
    screens = []
    for name, setup, check in [
        ("home", "__ym.state.route={name:'home',q:'',genre:'all'}; __ym.render();", ["인기 차트", "빠른 선곡", "추천 플레이리스트"]),
        ("explore", "__ym.state.route={name:'explore',q:'',genre:'all'}; __ym.state.explore.q=''; __ym.render();", ["탐색", "search-input", "장르"]),
        ("library", "__ym.state.route={name:'library'}; __ym.toggleLike(__ym.state.data.songs[0].videoId); __ym.render();", ["보관함", "좋아요", "재생목록"]),
    ]:
        try:
            js(setup)
            html = text_of("document.getElementById('view').innerHTML")
        except quickjs.JSException as exc:  # noqa: BLE001
            problems.append(f"{name} 렌더 예외: {str(exc)[:300]}")
            continue
        if len(html) < 300:
            problems.append(f"{name} 렌더 결과가 너무 짧음 ({len(html)}자)")
        for token in check:
            if token not in html:
                problems.append(f"{name} 화면에 '{token}' 없음")
        screens.append((name, len(html)))

    # 장르별 칩 필터
    first_genre = genres[0]
    js(f"__ym.state.homeFilter = {json.dumps(first_genre)};")
    filtered = js("__ym.filteredSongs().length")
    if int(filtered) < 1:
        problems.append("장르 필터 결과 없음")
    js("__ym.state.homeFilter = 'all';")

    # ---------- 5) 내장 검색 ----------
    sample_title = songs[0]["title"]
    key = sample_title[:3]
    hits = js("__ym.localSearch(" + json.dumps(key) + ").length")
    if int(hits) < 1:
        problems.append(f"내장 검색 실패: {key}")
    js("__ym.runSearch(" + json.dumps(key) + ");")
    res_len = js("__ym.state.explore.results ? __ym.state.explore.results.length : 0")
    if int(res_len) < 1:
        problems.append("설정 없는 상태의 검색 결과 없음")

    # ---------- 6) API 검색(모의 응답) ----------
    js("__ym.state.settings.apiKey='TEST_KEY'; __ym.state.explore.q=''; __ym.render();")
    js("__ym.runSearch('아이유');")
    api_rows = js("__ym.state.explore.results ? __ym.state.explore.results.length : -1")
    api_ids = js("(__ym.state.explore.results||[]).map(function(s){return s.videoId;}).join(',')")
    if int(api_rows) != 2:
        problems.append(f"API 검색 필터 결과가 2곡이 아님 ({api_rows}) — embeddable/지역 필터 확인")
    if "aaa111" not in str(api_ids) or "bbb222" in str(api_ids) or "ccc333" in str(api_ids):
        problems.append("API 검색의 임베드/지역 필터가 잘못 동작")
    notes.append(f"API 검색 필터 결과: {api_rows}곡 (임베드불가·한국차단 제외)")

    # ---------- 7) 좋아요 · 최근 감상 ----------
    vid = songs[0]["videoId"]
    js("__ym.state.liked = {};")
    js(f"__ym.toggleLike('{vid}');")
    if not js(f"!!__ym.state.liked['{vid}']"):
        problems.append("좋아요 추가 실패")
    if js("__ym.likedSongs().length") < 1:
        problems.append("좋아요 목록 비어 있음")
    js(f"__ym.toggleLike('{vid}');")
    if js(f"!!__ym.state.liked['{vid}']"):
        problems.append("좋아요 해제 실패")
    js(f"__ym.toggleLike('{vid}');")

    js("__ym.state.recent=[];")
    js("__ym.addRecent(__ym.state.data.songs[1]);")
    if js("__ym.state.recent.length") != 1:
        problems.append("최근 감상 기록 실패")

    # ---------- 8) 재생목록 ----------
    js("__ym.state.playlists=[];")
    pl_id = js("__ym.createPlaylist('테스트 목록').id")
    js(f"__ym.addToPlaylist('{pl_id}', '{vid}');")
    if js(f"__ym.state.playlists[0].songIds.length") != 1:
        problems.append("재생목록 곡 추가 실패")
    js(f"__ym.removeFromPlaylist('{pl_id}', '{vid}');")
    if js("__ym.state.playlists[0].songIds.length") != 0:
        problems.append("재생목록 곡 삭제 실패")
    js(f"__ym.addToPlaylist('{pl_id}', '{vid}');")
    js(f"__ym.deletePlaylist('{pl_id}');")
    if js("__ym.state.playlists.length") != 0:
        problems.append("재생목록 삭제 실패")

    # API 검색 곡도 새로고침 후 유지되는지(곡 스냅샷 저장)
    js("__ym.state.recent = [];")
    js("__ym.playSong(__ym.state.explore.results[0], __ym.state.explore.results, 0);")
    js("__ym.boot();")   # 앱 재시작 시뮬레이션
    kept = js("(__ym.state.recent[0] && __ym.state.recent[0].song) ? __ym.state.recent[0].song.title : ''")
    resolved = js("(__ym.songById('aaa111')||{}).title || ''")
    if not kept or not resolved:
        problems.append("API 검색 곡이 재시작 후 사라짐(곡 스냅샷 저장 실패)")

    # localStorage 영구 저장 확인
    persisted = js("localStorage.getItem('ymusic.likes.v1')")
    if not persisted:
        problems.append("좋아요가 localStorage 에 저장되지 않음")

    # ---------- 9) 플레이어 ----------
    js("__ym.playList(__ym.state.data.songs.slice(0,3), 0);")
    if js("__ym.state.current ? __ym.state.current.videoId : ''") != songs[0]["videoId"]:
        problems.append("재생 시작 실패")
    if js("__ym.state.queue.length") != 3:
        problems.append("대기열 구성 실패")
    js("__ym.next();")
    if js("__ym.state.index") != 1:
        problems.append("다음 곡 이동 실패")
    js("__ym.prev();")
    if js("__ym.state.index") != 0:
        problems.append("이전 곡 이동 실패")

    js("__ym.toggleShuffle();")
    if not js("__ym.state.shuffle"):
        problems.append("셔플 토글 실패")
    js("__ym.toggleShuffle();")
    js("__ym.cycleRepeat();")
    if js("__ym.state.repeat") != "all":
        problems.append("반복 모드 전환 실패")
    js("__ym.cycleRepeat();")
    if js("__ym.state.repeat") != "one":
        problems.append("한 곡 반복 전환 실패")
    js("__ym.cycleRepeat();")

    # 풀 플레이어 렌더
    js("__ym.openPlayer();")
    phtml = text_of("document.getElementById('player-screen').innerHTML")
    if js("document.getElementById('player-screen').hidden"):
        problems.append("풀 플레이어가 열리지 않음")
    for token in ["mode-toggle", "id=\"seek\"", "play-big", "다음 트랙", "비슷한 곡"]:
        if token not in phtml and token.replace('\\"', '"') not in phtml:
            problems.append(f"풀 플레이어에 {token} 없음")
    if "seek" not in phtml:
        problems.append("풀 플레이어 시크바 없음")

    # 노래 / 동영상 모드
    js("__ym.setMode('video');")
    if "video-mode" not in str(js("document.getElementById('player-screen').className")):
        problems.append("동영상 모드 전환 실패")
    js("__ym.setMode('song');")
    if "video-mode" in str(js("document.getElementById('player-screen').className")):
        problems.append("노래 모드 복귀 실패")

    # 시크
    js("__ym.seekTo(42);")
    if js("__ym.state.position") != 42:
        problems.append("시크 동작 실패")

    # 미니 플레이어
    js("__ym.closePlayer(); __ym.render();")
    if js("document.getElementById('miniplayer').hidden"):
        problems.append("미니 플레이어가 보이지 않음")
    mini = text_of("document.getElementById('miniplayer').innerHTML")
    if "mp-bar" not in mini:
        problems.append("미니 플레이어 진행바 없음")

    # 대기열 / 비슷한 곡 시트
    js("__ym.openQueue();")
    sheet = text_of("document.getElementById('sheet').innerHTML")
    if "다음 트랙" not in sheet:
        problems.append("대기열 시트 렌더 실패")
    js("__ym.closeSheet();")
    js("__ym.openSimilar();")
    if "비슷한 곡" not in text_of("document.getElementById('sheet').innerHTML"):
        problems.append("비슷한 곡 시트 렌더 실패")
    js("__ym.closeSheet();")

    # ---------- 10) OLED 절전 모드 ----------
    js("__ym.openPlayer(); __ym.openOled();")
    oled = text_of("document.getElementById('oled').innerHTML")
    if js("document.getElementById('oled').hidden"):
        problems.append("OLED 절전 화면이 열리지 않음")
    if not re.search(r"\d{2}:\d{2}", oled):
        problems.append("OLED 절전 화면에 시계가 없음")
    if songs[0]["title"][:5] not in oled:
        problems.append("OLED 절전 화면에 곡 제목이 없음")
    if "close-oled" not in oled:
        problems.append("OLED 절전 해제 버튼 없음")
    js("__ym.closeOled();")
    if not js("document.getElementById('oled').hidden"):
        problems.append("OLED 절전 해제 실패")
    if js("__ym.state.screen") != "full":
        problems.append("절전 해제 후 풀 플레이어로 복귀하지 않음")

    # ---------- 11) 설정/클릭 핸들러 ----------
    js("__ym.openSettings();")
    settings = text_of("document.getElementById('modal').innerHTML")
    for token in ["api-key-input", "연결 테스트", "내장 데이터 새로고침"]:
        if token not in settings:
            problems.append(f"설정 모달에 '{token}' 없음")
    js("__ym.closeModal();")

    # 클릭 디스패치(재생 카드)
    try:
        ctx.eval("""
          var fakeEl = new El('card');
          fakeEl.setAttribute('data-act','play-card');
          fakeEl.setAttribute('data-id', __ym.state.data.songs[2].videoId);
          var fakeTarget = { closest: function(){ return fakeEl; } };
          __ym.onClick({ target: fakeTarget });
        """)
        if js("__ym.state.current.videoId") != songs[2]["videoId"]:
            problems.append("재생 카드 클릭 디스패치 실패")
    except quickjs.JSException as exc:  # noqa: BLE001
        problems.append("클릭 디스패치 예외: " + str(exc)[:200])

    # ---------- 12) 나머지 화면·핸들러 경로 ----------
    ctx.eval("""
      globalThis.clickAct = function (act, id, extra) {
        var e = new El('x');
        e.setAttribute('data-act', act);
        if (id !== undefined && id !== null) e.setAttribute('data-id', String(id));
        if (extra) { for (var k in extra) e.setAttribute('data-' + k, String(extra[k])); }
        __ym.onClick({ target: { closest: function () { return e; } } });
      };
    """)

    first_group = js("__ym.playlistGroups()[0].name")
    try:
        js(f"clickAct('open-playlist', {json.dumps(first_group)});")
        if "전체 재생" not in text_of("document.getElementById('sheet').innerHTML"):
            problems.append("플레이리스트 시트 열기 실패")
        js("clickAct('close-sheet');")

        js(f"clickAct('track-menu', '{vid}');")
        if "재생목록에 추가" not in text_of("document.getElementById('sheet').innerHTML"):
            problems.append("곡 메뉴 시트 실패")
        js(f"clickAct('add-to-open', '{vid}');")
        if "재생목록에 추가" not in text_of("document.getElementById('modal').innerHTML"):
            problems.append("재생목록 추가 모달 실패")
        js("clickAct('close-modal');")

        js("clickAct('new-playlist');")
        if "새 재생목록" not in text_of("document.getElementById('modal').innerHTML"):
            problems.append("새 재생목록 모달 실패")
        js("clickAct('close-modal');")

        # 내 재생목록 시트
        js("__ym.state.playlists=[];")
        new_id = js("__ym.createPlaylist('드라이브 모음').id")
        js(f"__ym.addToPlaylist('{new_id}', '{vid}');")
        js(f"clickAct('open-my-playlist', '{new_id}');")
        if "드라이브 모음" not in text_of("document.getElementById('sheet').innerHTML"):
            problems.append("내 재생목록 시트 실패")
        js(f"clickAct('play-mine', '{new_id}');")
        if js("__ym.state.current.videoId") != vid:
            problems.append("내 재생목록 전체 재생 실패")
        js("clickAct('close-sheet');")

        # 설정 액션 경로
        js("clickAct('test-key');")
        js("clickAct('refresh-data');")
        js("clickAct('clear-cache');")
        js("clickAct('reset-app');")
        if js("__ym.state.playlists.length") != 0:
            problems.append("저장 데이터 초기화 실패")
        notes.append("설정 액션(연결 테스트·데이터 새로고침·캐시·초기화) 실행 경로 확인")
    except quickjs.JSException as exc:  # noqa: BLE001
        problems.append("화면/핸들러 경로 예외: " + str(exc)[:300])

    # ---------- 결과 ----------
    for name, size in screens:
        print(f"  [OK] {name:8} 렌더 ({size}자)")
    for note in notes:
        print("  · " + note)
    if problems:
        print("\n발견된 문제:")
        for p in problems:
            print("  [FAIL] " + p)
        print("\nSMOKE TEST: CHECK NEEDED")
        return 1
    print("\n  [OK] 데이터/HTML/CSS/PWA 정합성")
    print("  [OK] 홈·탐색·보관함·풀플레이어·OLED 렌더")
    print("  [OK] 검색(내장/API 필터)·좋아요·재생목록·최근 감상·대기열·모드·절전 로직")
    print("\nSMOKE TEST: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
