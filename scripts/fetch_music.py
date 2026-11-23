#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YMUSIC 초기 음악 데이터 수집기 (Python 표준 라이브러리만 사용).

공식 유튜브 음악 채널( HYBE · SM · JYP · YG · Warner Music Korea · Dingo Music ·
Lofi Girl 등 )의 재생목록에서 곡을 모아, 각 곡이 **한국(KR)에서 임베드 재생
가능한지** 확인한 뒤 ``data/music.json`` 으로 저장한다.

임베드 확인은 두 단계로 한다.
  1) 시청 페이지의 ``ytInitialPlayerResponse.playabilityStatus``
     → ``playableInEmbed`` / ``playableInEmbed=true`` + ``availableCountries``(KR 포함)
  2) 봇 차단(LOGIN_REQUIRED 등)으로 1)이 막히면 oEmbed 응답으로 보조 판정
     (200 = 외부 임베드 허용, 401/403/404 = 임베드 불가/비공개)

실행 예:
    python3 scripts/fetch_music.py                # 전체 수집 + 임베드 검증
    python3 scripts/fetch_music.py --no-probe     # 임베드 검증 생략(빠른 확인)
    python3 scripts/fetch_music.py --limit 10 --verbose
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://www.youtube.com"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": UA,
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
OUT_PATH = os.path.join(DATA_DIR, "music.json")
CACHE_PATH = os.path.join(DATA_DIR, "probe_cache.json")

# ---------------------------------------------------------------------------
# 수집 소스: 공식 채널의 재생목록
#   genre    : 앱에서 쓰는 장르(대분류)
#   playlist : 앱에 표시할 플레이리스트/차트 이름
#   moods    : 홈 필터 칩에 쓰는 분위기 태그
# ---------------------------------------------------------------------------
SOURCES = [
    # ---------------- K-POP ----------------
    {"key": "newjeans", "playlistId": "PL_Cqw69_m_ywY88NJ5SlpuaO_rmpKXO0D",
     "playlist": "NewJeans", "genre": "K-POP", "moods": ["신나는", "청량"], "maxVideos": 26},
    {"key": "lesserafim", "playlistId": "PL_Cqw69_m_yy38oAByQnsdPfst3IgOMxL",
     "playlist": "LE SSERAFIM", "genre": "K-POP", "moods": ["신나는", "운동"], "maxVideos": 30},
    {"key": "boynextdoor", "playlistId": "PL_Cqw69_m_yzndHP69oTCny_i7bt3Tn-M",
     "playlist": "BOYNEXTDOOR", "genre": "K-POP", "moods": ["신나는", "청량"], "maxVideos": 24},
    {"key": "aespa", "playlistId": "PLA91TLEzZINvfD-ToXanRYXVlcVdy4CDI",
     "playlist": "aespa", "genre": "K-POP", "moods": ["신나는"], "maxVideos": 30},
    {"key": "straykids", "playlistId": "PL9K3xwFkFqWEUOC39i3GD1mio7QMGveuU",
     "playlist": "Stray Kids", "genre": "K-POP", "moods": ["신나는", "운동"], "maxVideos": 30},
    {"key": "itzy", "playlistId": "PL9K3xwFkFqWGd22jO7bhQ6u80Ge9WUrpD",
     "playlist": "ITZY", "genre": "K-POP", "moods": ["신나는", "운동"], "maxVideos": 24},
    {"key": "nmixx", "playlistId": "PL9K3xwFkFqWGb216xwT5kbHQBDNGEWVJE",
     "playlist": "NMIXX", "genre": "K-POP", "moods": ["신나는"], "maxVideos": 20},
    {"key": "blackpink", "playlistId": "PLuWI86ItS2gH_xUTgC8xgiq03StltmpMk",
     "playlist": "BLACKPINK", "genre": "K-POP", "moods": ["신나는"], "maxVideos": 26},
    {"key": "yg-mv", "playlistId": "PLuWI86ItS2gFlU--LK6bV5RZ_VNIQ6Op3",
     "playlist": "YG MUSIC VIDEOS", "genre": "K-POP", "moods": ["신나는"], "maxVideos": 20},
    {"key": "warner-kpop", "playlistId": "PLX3cI5NYkjAjWvqLI9z9i4tthI0yihRyc",
     "playlist": "기분전환이 필요할 때", "genre": "K-POP", "moods": ["신나는", "청량"], "maxVideos": 24},
    # ---------------- 발라드 ----------------
    {"key": "warner-3am", "playlistId": "PLX3cI5NYkjAjOv3GWtV5rtV4FH8zdhw67",
     "playlist": "잔잔한 새벽감성 가요", "genre": "발라드", "moods": ["잔잔한", "새벽", "이별"], "maxVideos": 40},
    {"key": "dingo-tipsy", "playlistId": "PLmxVF8ick5cS8ywQrE-4l6871ZfRxSDj_",
     "playlist": "이슬라이브 (Tipsy Live)", "genre": "발라드", "moods": ["잔잔한", "새벽"], "maxVideos": 30},
    # ---------------- 힙합·R&B ----------------
    {"key": "warner-khiphop", "playlistId": "PLX3cI5NYkjAhseGCrJdRVy7JjnzIn7IZP",
     "playlist": "턴업하기 좋은 국내 힙합", "genre": "힙합·R&B", "moods": ["신나는", "운동"], "maxVideos": 34},
    # ---------------- 팝송 ----------------
    {"key": "pop-dualipa", "playlistId": "PLX3cI5NYkjAj0UNFRBUC5XSznu_L5CqWA",
     "playlist": "Dua Lipa 필청 트랙", "genre": "팝송", "moods": ["신나는"], "maxVideos": 20},
    {"key": "pop-benson", "playlistId": "PLX3cI5NYkjAgeOQCrJj94fCd1BDWE8k6g",
     "playlist": "Benson Boone 필청 트랙", "genre": "팝송", "moods": ["잔잔한"], "maxVideos": 14},
    {"key": "pop-tones", "playlistId": "PLX3cI5NYkjAhBk_0b277LXEzbHw4RtQ1t",
     "playlist": "Tones And I 필청 트랙", "genre": "팝송", "moods": ["신나는"], "maxVideos": 12},
    {"key": "pop-melanie", "playlistId": "PLX3cI5NYkjAh2BOZBNhwsq6klIi6UnODd",
     "playlist": "Melanie Martinez 필청 트랙", "genre": "팝송", "moods": ["잔잔한"], "maxVideos": 12},
    {"key": "pop-gayle", "playlistId": "PLX3cI5NYkjAjwkxDgpDVMMvhCEz04TeqD",
     "playlist": "GAYLE 필청 트랙", "genre": "팝송", "moods": ["신나는"], "maxVideos": 10},
    # ---------------- OST ----------------
    {"key": "warner-ost", "playlistId": "PLX3cI5NYkjAhDT1dpeflfbjOKTVrqNnLD",
     "playlist": "최애 드라마 속 그 노래", "genre": "OST", "moods": ["감성", "이별"], "maxVideos": 40},
    # ---------------- 드라이브 ----------------
    {"key": "lofi-synthwave", "playlistId": "PLY1Ew7TDxB6U",
     "playlist": "밤 드라이브 신스웨이브", "genre": "드라이브", "moods": ["밤", "드라이브"], "maxVideos": 16,
     "longOk": True},
    {"key": "warner-cool", "playlistId": "PLX3cI5NYkjAhVs2tn7fVS0TbPoD1TBqE5",
     "playlist": "시원하고 청량한 느낌의 가요", "genre": "드라이브", "moods": ["청량", "드라이브"], "maxVideos": 24},
    # ---------------- 로파이·집중 ----------------
    {"key": "lofi-piano", "playlistId": "PLBXAKheXvsAM",
     "playlist": "relaxing piano", "genre": "로파이·집중", "moods": ["집중", "잔잔한"], "maxVideos": 22,
     "longOk": True},
    {"key": "lofi-jazz", "playlistId": "PLHrcPWoDSB4c",
     "playlist": "relaxing jazz", "genre": "로파이·집중", "moods": ["집중", "잔잔한"], "maxVideos": 18,
     "longOk": True},
    {"key": "lofi-hiphop", "playlistId": "PLHD44KRu8Ods",
     "playlist": "lofi hip hop", "genre": "로파이·집중", "moods": ["집중"], "maxVideos": 18,
     "longOk": True},
]

GENRE_ORDER = ["K-POP", "발라드", "힙합·R&B", "팝송", "드라이브", "OST", "로파이·집중"]

# 소스별 공식 채널명(제목에서 아티스트를 못 뽑을 때의 대체값)
SOURCE_CHANNELS = {
    "newjeans": "NewJeans",
    "lesserafim": "LE SSERAFIM",
    "boynextdoor": "BOYNEXTDOOR",
    "aespa": "aespa",
    "straykids": "Stray Kids",
    "itzy": "ITZY",
    "nmixx": "NMIXX",
    "blackpink": "BLACKPINK",
    "yg-mv": "YG ENTERTAINMENT",
    "warner-kpop": "Warner Music Korea",
    "warner-3am": "Warner Music Korea",
    "dingo-tipsy": "딩고 뮤직",
    "warner-khiphop": "Warner Music Korea",
    "pop-dualipa": "Dua Lipa",
    "pop-benson": "Benson Boone",
    "pop-tones": "Tones And I",
    "pop-melanie": "Melanie Martinez",
    "pop-gayle": "GAYLE",
    "warner-ost": "Warner Music Korea",
    "lofi-synthwave": "Lofi Girl",
    "warner-cool": "Warner Music Korea",
    "lofi-piano": "Lofi Girl",
    "lofi-jazz": "Lofi Girl",
    "lofi-hiphop": "Lofi Girl",
}

# 곡이 아닌 영상(티저·예고·직캠·인터뷰 등) 제외 키워드
EXCLUDE_WORDS = [
    "teaser", "티저", "예고", "선공개", "trailer", "트레일러", "highlight", "하이라이트",
    "behind", "비하인드", "making", "메이킹", "interview", "인터뷰", "reaction", "리액션",
    "dance practice", "안무", "choreography", "직캠", "fancam", "concert", "콘서트",
    "live clip", "라이브 클립", "full album", "정규앨범", "compilation", "모음집", "메들리",
    "medley", "shorts", "쇼츠", "광고", "게임", "movie", "영화 예고",
    "stage", "무대", "커버", "cover", "remix", "리믹스", "sped up", "slowed", "8d",
    "mashup", "매시업", "skzflix", "documentary", "다큐", "vlog", "브이로그",
    "jacket", "concept photo", "spoiler", "캐스팅", "현장", "리허설", "unveil",
    "loading", "track video", "special clip", "preview", "미리보기", "무대 영상",
]
# 쇼/프로그램 이름(제목 앞에 붙는 태그) — 아티스트가 아니므로 떼어낸다.
SHOW_NAMES = [
    "이슬라이브", "킬링보이스", "킬링 플레이리스트", "세로라이브", "딩고라이브", "텐션업",
    "tipsy live", "killing voice", "sero live", "dingo live", "dingo music", "100초",
]
ARTIST_NOISE = re.compile(
    r"(\d+\s*(?:st|nd|rd|th)?\s*(?:ep|single|album|mini)|\bep\b|\bsingle\b|\balbum\b|\bver\.?\b|"
    r"official|playlist|music video|\bm/?v\b|visuali[sz]er|audio|lyric)",
    re.I,
)
# 재생목록 영상 제목에서 떼어낼 꼬리표
TITLE_SUFFIX_RE = re.compile(
    r"\s*[\(\[]?\s*(?:official\s*)?(?:m/?v|music\s*video|뮤직비디오|official\s*video|"
    r"official\s*music\s*video|lyric\s*video|가사|audio|오디오|performance\s*video|"
    r"performance\s*ver\.?|dance\s*practice|choreography|full\s*ver\.?|visuali[sz]er|"
    r"official\s*visuali[sz]er|color\s*coded\s*(?:lyrics?)?|han/?rom/?eng|4k|hd|uhd)\s*[\)\]]?\s*$",
    re.I,
)
DURATION_RE = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$")
VIEW_RE = re.compile(r"(?:조회수|views?)\s*([\d,\.]*\s*[억만천]?)\s*(?:회|views)?", re.I)
LABEL_CHANNELS = {
    "hybe labels", "smtown", "jyp entertainment", "yg entertainment", "warner music korea",
    "1thek (원더케이)", "1thek", "stone music entertainment", "dingo music", "lofi girl",
    "killing voice", "dingo", "genie music", "kakao entertainment", "wanner music korea",
}

_LOCK = threading.Lock()
_REQ_COUNT = [0]

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def http_get(url: str, retries: int = 3, timeout: int = 40) -> str:
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
            with _LOCK:
                _REQ_COUNT[0] += 1
            return raw.decode("utf-8", "replace")
        except urllib.error.HTTPError as err:
            last_err = err
            if err.code in (400, 401, 403, 404, 410):
                raise
            time.sleep(1.5 * (attempt + 1))
        except Exception as err:  # noqa: BLE001
            last_err = err
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"request failed: {url} ({last_err})")


_JSON_DECODER = json.JSONDecoder()


def extract_json_var(html: str, var_name: str):
    for needle in (f"var {var_name} = ", f"{var_name} = "):
        idx = html.find(needle)
        if idx >= 0:
            try:
                obj, _ = _JSON_DECODER.raw_decode(html[idx + len(needle):])
                return obj
            except ValueError:
                continue
    return None


def walk_key(obj, key):
    stack = [obj]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            for k, v in cur.items():
                if k == key:
                    yield v
                if isinstance(v, (dict, list)):
                    stack.append(v)
        elif isinstance(cur, list):
            stack.extend(x for x in cur if isinstance(x, (dict, list)))


def find_continuation(obj):
    tokens = []
    for cc in walk_key(obj, "continuationCommand"):
        if isinstance(cc, dict) and cc.get("token"):
            if cc.get("request") in ("CONTINUATION_REQUEST_TYPE_BROWSE", None):
                tokens.append(cc["token"])
    return tokens


def page_context(html: str) -> dict:
    visitor = re.search(r'"VISITOR_DATA":"(.*?)"', html)
    cver = re.search(r'"INNERTUBE_CLIENT_VERSION":"(.*?)"', html)
    return {
        "client": {
            "clientName": "WEB",
            "clientVersion": cver.group(1) if cver else "2.20260101.00.00",
            "hl": "ko",
            "gl": "KR",
            "visitorData": visitor.group(1) if visitor else "",
        },
        "user": {"lockedSafetyMode": False},
    }


def browse_continuation(token: str, ctx: dict) -> dict:
    client = ctx.get("client", {})
    headers = {
        "User-Agent": UA,
        "Content-Type": "application/json",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Origin": BASE,
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": client.get("clientVersion", ""),
        "X-Goog-Visitor-Id": client.get("visitorData", ""),
    }
    body = json.dumps({"context": ctx, "continuation": token}).encode()
    req = urllib.request.Request(
        f"{BASE}/youtubei/v1/browse?prettyPrint=false", data=body, headers=headers
    )
    with urllib.request.urlopen(req, timeout=40) as resp:
        with _LOCK:
            _REQ_COUNT[0] += 1
        return json.loads(resp.read().decode("utf-8", "replace"))


# ---------------------------------------------------------------------------
# lockup(카드) 파싱
# ---------------------------------------------------------------------------


def iter_lockups(data):
    for lv in walk_key(data, "lockupViewModel"):
        if isinstance(lv, dict) and lv.get("contentId"):
            yield lv


def lockup_title(lv: dict) -> str:
    meta = (lv.get("metadata") or {}).get("lockupMetadataViewModel") or {}
    return ((meta.get("title") or {}).get("content") or "").strip()


def lockup_thumbnail(lv: dict) -> str:
    image = lv.get("contentImage") or {}
    collection = image.get("collectionThumbnailViewModel")
    if collection:
        image = ((collection.get("primaryThumbnail") or {}).get("thumbnailViewModel") or {}).get("image") or {}
    else:
        image = (image.get("thumbnailViewModel") or {}).get("image") or {}
    sources = image.get("sources") or []
    return sources[-1].get("url", "") if sources else ""


def lockup_badges(lv: dict):
    out = []
    for badge in walk_key(lv, "thumbnailBadgeViewModel"):
        if isinstance(badge, dict) and badge.get("text"):
            out.append(badge["text"])
    return out


def lockup_meta_parts(lv: dict):
    rows = (((lv.get("metadata") or {}).get("lockupMetadataViewModel") or {}).get("metadata") or {})
    parts = []
    for row in ((rows.get("contentMetadataViewModel") or {}).get("metadataRows") or []):
        for part in row.get("metadataParts") or []:
            value = ((part.get("text") or {}).get("content") or "").strip()
            if value:
                parts.append(value)
    return parts


def parse_duration_seconds(text: str) -> int:
    m = DURATION_RE.match((text or "").strip())
    if not m:
        return 0
    a, b, c = m.group(1), m.group(2), m.group(3)
    if c is not None:
        return int(a) * 3600 + int(b) * 60 + int(c)
    return int(a) * 60 + int(b)


def fmt_duration(sec: int) -> str:
    sec = max(0, int(sec))
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


_UNIT = {"억": 100_000_000, "만": 10_000, "천": 1_000}


def parse_views(text: str) -> int:
    m = VIEW_RE.search(text or "")
    if not m:
        return 0
    raw = m.group(1).replace(",", "").replace(" ", "")
    unit = 1
    for u, mult in _UNIT.items():
        if raw.endswith(u):
            raw, unit = raw[:-1], mult
            break
    try:
        return int(float(raw) * unit) if raw else 0
    except ValueError:
        return 0


# ---------------------------------------------------------------------------
# 재생목록 → 영상
# ---------------------------------------------------------------------------


def fetch_playlist_videos(pid: str, max_pages: int = 2, verbose: bool = False) -> dict:
    url = f"{BASE}/playlist?list={pid}&hl=ko&gl=KR"
    html = http_get(url)
    data = extract_json_var(html, "ytInitialData")
    if not data:
        return {"title": "", "videos": []}
    meta = (data.get("metadata") or {}).get("playlistMetadataRenderer") or {}
    title = (meta.get("title") or "").strip()

    videos, seen = [], set()

    def collect(page):
        for lv in iter_lockups(page):
            if lv.get("contentType") != "LOCKUP_CONTENT_TYPE_VIDEO":
                continue
            vid = lv["contentId"]
            if vid in seen:
                continue
            seen.add(vid)
            badges = lockup_badges(lv)
            dur_text = next((b for b in badges if DURATION_RE.match((b or "").strip())), "")
            views = 0
            for part in lockup_meta_parts(lv):
                if VIEW_RE.search(part):
                    views = parse_views(part)
                    break
            videos.append(
                {
                    "videoId": vid,
                    "title": lockup_title(lv),
                    "durationText": dur_text,
                    "durationSec": parse_duration_seconds(dur_text),
                    "thumbnail": lockup_thumbnail(lv),
                    "views": views,
                }
            )

    collect(data)
    ctx = page_context(html)
    queue = find_continuation(data)
    used = set()
    for _ in range(max_pages - 1):
        token = next((t for t in queue if t not in used), None)
        if not token:
            break
        used.add(token)
        try:
            page = browse_continuation(token, ctx)
        except Exception:  # noqa: BLE001
            break
        collect(page)
        queue.extend(t for t in find_continuation(page) if t not in used)
    if verbose:
        print(f"    재생목록 {pid}: {title} ({len(videos)}개 영상)", file=sys.stderr)
    return {"title": title, "videos": videos}


# ---------------------------------------------------------------------------
# 임베드 검증
# ---------------------------------------------------------------------------


def probe_watch(video_id: str):
    """시청 페이지에서 playableInEmbed/지역/조회수/제목 정보를 확인한다.

    봇 확인(LOGIN_REQUIRED)으로 플레이어 응답이 비어 있어도 페이지에는
    제목·조회수가 남아 있으므로 함께 수집한다.
    """
    out = {"ok": None, "status": "blocked", "source": "player"}
    for attempt in range(1):
        try:
            url = f"{BASE}/watch?v={video_id}&hl=ko&gl=KR" + ("&has_verified=1" if attempt else "")
            html = http_get(url)
            views = re.search(r'"viewCount":"([\d,]+)"', html)
            if views:
                out["views"] = int(views.group(1).replace(",", ""))
            initial = extract_json_var(html, "ytInitialData")
            if initial:
                for node in walk_key(initial, "videoPrimaryInfoRenderer"):
                    if isinstance(node, dict):
                        runs = (node.get("title") or {}).get("runs") or []
                        if runs:
                            out["title"] = "".join(r.get("text", "") for r in runs)
                        break
                for node in walk_key(initial, "videoOwnerRenderer"):
                    if isinstance(node, dict):
                        runs = (node.get("title") or {}).get("runs") or []
                        if runs:
                            out["author"] = "".join(r.get("text", "") for r in runs)
                        break
            pr = extract_json_var(html, "ytInitialPlayerResponse")
            if not pr:
                continue
            status = (pr.get("playabilityStatus") or {}).get("status")
            details = pr.get("videoDetails") or {}
            mf = (pr.get("microformat") or {}).get("playerMicroformatRenderer") or {}
            countries = mf.get("availableCountries")
            if status in ("OK", "PLAYABLE"):
                return {
                    **out,
                    "ok": bool((pr.get("playabilityStatus") or {}).get("playableInEmbed", True)),
                    "status": status,
                    "source": "player",
                    "countries": len(countries) if countries else None,
                    "kr": ("KR" in countries) if countries else None,
                    "title": details.get("title") or out.get("title", ""),
                    "author": details.get("author") or out.get("author", ""),
                    "length": int(details.get("lengthSeconds") or 0),
                    "family": mf.get("isFamilySafe"),
                }
            out["status"] = status or out["status"]
            time.sleep(0.6)
        except Exception:  # noqa: BLE001
            time.sleep(0.6)
    return out


def probe_oembed(video_id: str):
    url = f"{BASE}/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=25) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8", "replace"))
                return {
                    "ok": True,
                    "status": "oembed",
                    "source": "oembed",
                    "title": data.get("title", ""),
                    "author": data.get("author_name", ""),
                    "length": 0,
                }
    except urllib.error.HTTPError as err:
        if err.code in (401, 403, 404):
            return {"ok": False, "status": f"oembed-{err.code}", "source": "oembed"}
    except Exception:  # noqa: BLE001
        pass
    return {"ok": None, "status": "unknown", "source": "oembed"}


def probe_video(video_id: str, verbose: bool = False) -> dict:
    result = probe_watch(video_id)
    if result.get("ok") is None:
        alt = probe_oembed(video_id)
        if alt.get("ok") is not None:
            for k, v in alt.items():
                if v not in ("", None, 0):
                    result.setdefault(k, v)
            result["ok"] = alt["ok"]
            result["source"] = "player+" + alt["source"] if result.get("title") else alt["source"]
            result["status"] = result.get("status") or alt.get("status")
    if verbose:
        print(f"    probe {video_id}: {result.get('ok')} ({result.get('status')}) views={result.get('views')}", file=sys.stderr)
    return result


def load_cache():
    try:
        with open(CACHE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_cache(cache):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as fh:
        json.dump(cache, fh, ensure_ascii=False, indent=1)


# ---------------------------------------------------------------------------
# 제목/아티스트 정리
# ---------------------------------------------------------------------------

_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\u2190-\u21FF\u2300-\u23FF\u25A0-\u27BF\u2B00-\u2BFF\uFE0F\u200D]+\uFE0F?"
)
_HANGUL_RE = re.compile(r"[가-힣]")
_LATIN_RE = re.compile(r"[A-Za-z]")
_QUOTE_RE = re.compile(r"['\"\u2018\u2019\u201c\u201d\u300c\u300d]([^'\"\u2018\u2019\u201c\u201d\u300c\u300d]{1,120})['\"\u2018\u2019\u201c\u201d\u300c\u300d]")


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text or "")
    text = _EMOJI_RE.sub(" ", text)
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[【】\[\]「」『』<>《》{}〈〉＜＞（）]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean_artist(raw: str) -> str:
    text = normalize_text(raw).strip(" -–—·•|:,")
    text = re.sub(r"\s*-\s*Topic$", "", text, flags=re.I)
    text = re.sub(r"\s*VEVO$", "", text, flags=re.I)
    text = re.sub(r"\s*[\(\[](?:feat\.?|ft\.?|with)[^\)\]]*[\)\]]", "", text, flags=re.I)
    # "[이슬라이브] 버즈" 처럼 프로그램 태그가 앞에 붙으면 떼어낸다.
    for show in SHOW_NAMES:
        if text.lower().startswith(show.lower()):
            text = text[len(show):].strip(" -–—·•|:,")
        text = re.sub(r"^\[?" + re.escape(show) + r"\]?\s*[-–—:]?\s*", "", text, flags=re.I)
    for junk in ("최초 공개", "단독 공개", "선공개"):
        if text.startswith(junk):
            text = text[len(junk):].strip(" -–—·•|:,")
    # "크리스 메인 (Kris Main)" → "Kris Main" / "Pink Sweat$, P1Harmony (피원하모니)" → 앞부분 유지
    parens = list(re.finditer(r"[\(\[]([^\)\]]+)[\)\]]", text))
    if parens:
        p = parens[-1]
        outer = (text[: p.start()] + " " + text[p.end():]).strip()
        inner = p.group(1).strip()
        outer_hangul = bool(_HANGUL_RE.search(outer))
        outer_latin = bool(_LATIN_RE.search(outer))
        inner_hangul = bool(_HANGUL_RE.search(inner))
        inner_latin = bool(_LATIN_RE.search(inner))
        if outer and inner_latin and not inner_hangul and outer_hangul and not outer_latin:
            text = inner
        elif outer and outer_latin and inner_hangul:
            text = outer
        elif outer and outer_latin and not inner_hangul:
            text = outer if len(outer) >= len(inner) else inner
    # 따옴표 잔여물 및 한글+영문 중복 표기 정리(예: "aespa 에스파" → "aespa")
    text = text.strip("'\"‘’“” -–—·•|:,")
    if _HANGUL_RE.search(text) and _LATIN_RE.search(text):
        stripped = re.sub(r"[가-힣][가-힣\s]*", lambda m: "" if len(m.group(0).strip()) <= 10 else m.group(0), text)
        stripped = re.sub(r"\s{2,}", " ", stripped).strip(" ,-–—·•|:'\"")
        if stripped and _LATIN_RE.search(stripped):
            text = stripped
    return text.strip("'\"‘’“” -–—·•|:,")


def clean_title_text(raw: str) -> str:
    text = normalize_text(raw)
    for _ in range(3):
        new = TITLE_SUFFIX_RE.sub("", text).strip(" -–—·•|:")
        if new == text:
            break
        text = new
    # "Official Music Video ENG/CHN/…", "ㅣ Tipsy Live" 같은 꼬리표
    text = re.sub(r"\s*[|ㅣ]\s*(?:tipsy\s*live|이슬라이브|킬링보이스|live)\s*$", "", text, flags=re.I)
    text = re.sub(r"\s*[\[(\(]?\s*official\s+(?:music\s+)?video\b.*$", "", text, flags=re.I)
    text = re.sub(r"\s*[\(\[](?:feat\.?|ft\.?)[^\)\]]*[\)\]]", lambda m: m.group(0), text, flags=re.I)
    return text.strip(" -–—·•|:")


def artist_is_noise(name: str) -> bool:
    if not name or len(name) > 46:
        return True
    if ARTIST_NOISE.search(name):
        return True
    if name.lower().strip() in LABEL_CHANNELS:
        return True
    if "playlist" in name.lower() or "beats to" in name.lower():
        return True
    return False


def split_title(raw: str, channel: str = "", fallback_artist: str = ""):
    """원본 제목에서 (곡명, 아티스트) 를 뽑는다."""
    text = normalize_text(raw)
    artist, title = "", ""

    quotes = list(_QUOTE_RE.finditer(text))
    if quotes:
        best = max(quotes, key=lambda m: len(m.group(1)))
        title = clean_title_text(best.group(1))
        artist = clean_artist(text[: best.start()])
    if not title:
        for sep in (" - ", " – ", " — ", " | ", " : "):
            if sep in text:
                left, right = text.split(sep, 1)
                artist = clean_artist(left)
                title = clean_title_text(right)
                break
    if not title:
        title = clean_title_text(text)

    ch = clean_artist(channel or "")
    if artist_is_noise(artist):
        artist = ""
    if not artist and not artist_is_noise(ch):
        artist = ch

    # 제목이 아티스트 이름으로 시작하면 떼어낸다. ("NMIXX A Midsummer …")
    for name in (artist, ch, fallback_artist):
        if name and len(name) >= 2 and title.lower().startswith(name.lower() + " "):
            title = clean_title_text(title[len(name):])
            break

    if not artist:
        artist = clean_artist(fallback_artist)
    if not artist or artist_is_noise(artist):
        artist = "Various Artists"
    if not title:
        title = clean_title_text(text)
    return title, artist


def title_key(title: str) -> str:
    key = re.sub(r"\([^\)]*(?:ver\.?|version|inst\.?|instrumental|karaoke)[^\)]*\)", "", title.lower())
    key = re.sub(r"[\(\)\[\]\{\}]", " ", key)
    key = re.sub(r"\s+", " ", key).strip()
    return key


# ---------------------------------------------------------------------------
# 수집
# ---------------------------------------------------------------------------


def is_excluded(title: str) -> bool:
    low = " " + normalize_text(title).lower() + " "
    return any(word in low for word in EXCLUDE_WORDS)


def collect_source(src: dict, cache: dict, probe: bool, verbose: bool = False):
    try:
        data = fetch_playlist_videos(src["playlistId"], max_pages=2, verbose=verbose)
    except Exception as err:  # noqa: BLE001
        print(f"  ! {src['key']} 재생목록 실패: {err}", file=sys.stderr)
        return [], []

    long_ok = bool(src.get("longOk"))
    picked, rejected = [], []

    for video in data["videos"]:
        dur = video["durationSec"]
        if dur <= 0:  # 길이 정보가 없는 영상(라이브 등)은 제외
            rejected.append((video, "no-duration"))
            continue
        if long_ok:
            if dur < 45 or dur > 4000:
                rejected.append((video, "short"))
                continue
        else:
            if dur < 70 or dur > 600:
                rejected.append((video, "duration"))
                continue
        if is_excluded(video["title"]):
            rejected.append((video, "keyword"))
            continue
        picked.append(video)
        if len(picked) >= src.get("maxVideos", 40):
            break

    if probe:
        todo = [v["videoId"] for v in picked
                if not cache.get(v["videoId"]) or cache[v["videoId"]].get("ok") is None]
        if todo:
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda vid: (vid, probe_video(vid, verbose=verbose)), todo))
            for vid, info in results:
                cache[vid] = {**info, "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
            save_cache(cache)

    songs = []
    for video in picked:
        vid = video["videoId"]
        info = cache.get(vid) or {}
        if probe and info.get("ok") is False:
            rejected.append((video, "not-embeddable"))
            continue
        if probe and info.get("kr") is False:
            rejected.append((video, "region-kr"))
            continue

        raw_title = info.get("title") or video["title"]
        channel = info.get("author") or SOURCE_CHANNELS.get(src["key"], "") or ""
        title, artist = split_title(raw_title, channel, SOURCE_CHANNELS.get(src["key"], ""))
        if not title:
            rejected.append((video, "no-title"))
            continue
        dur_sec = int(info.get("length") or video["durationSec"])
        songs.append(
            {
                "videoId": vid,
                "title": title,
                "artist": artist,
                "duration": fmt_duration(dur_sec),
                "durationSec": dur_sec,
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "genre": src["genre"],
                "playlist": src["playlist"],
                "moods": list(src.get("moods") or []),
                "views": int(info.get("views") or video.get("views") or 0),
                "channel": channel,
                "rawTitle": raw_title,
                "embedOk": info.get("ok"),
                "embedCheck": info.get("source", "unverified"),
            }
        )
    return songs, rejected


def fetch_view_count(video_id: str):
    """시청 페이지 HTML 에서 조회수만 뽑는다(봇 확인과 무관하게 남아 있다)."""
    try:
        html = http_get(f"{BASE}/watch?v={video_id}&hl=ko&gl=KR")
    except Exception:  # noqa: BLE001
        return None
    m = re.search(r'"viewCount":"([\d,]+)"', html)
    if not m:
        return None
    try:
        return int(m.group(1).replace(",", ""))
    except ValueError:
        return None


def fill_views(path: str = OUT_PATH, verbose: bool = False) -> int:
    """조회수가 비어 있는 곡들의 조회수를 채워 넣는다(인기 차트 정렬용)."""
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    songs = data.get("songs", [])
    targets = [s for s in songs if not s.get("views")]
    print(f"조회수 보강 대상: {len(targets)}곡", file=sys.stderr)
    filled = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda s: (s, fetch_view_count(s["videoId"])), targets))
    for song, views in results:
        if views:
            song["views"] = views
            filled += 1
            if verbose:
                print(f"  {song['videoId']} → {views:,}", file=sys.stderr)

    order = {g: i for i, g in enumerate(GENRE_ORDER)}
    songs.sort(key=lambda s: (order.get(s["genre"], 99), -s.get("views", 0), s["title"]))
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print(f"조회수 {filled}곡 보강 완료", file=sys.stderr)
    return filled


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="YMUSIC 음악 데이터 수집")
    parser.add_argument("--no-probe", action="store_true", help="임베드 검증 생략")
    parser.add_argument("--limit", type=int, default=0, help="소스당 최대 곡 수(테스트용)")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--out", default=OUT_PATH)
    parser.add_argument("--fill-views", action="store_true", help="기존 데이터의 빈 조회수를 다시 채운다")
    args = parser.parse_args(argv)

    os.makedirs(DATA_DIR, exist_ok=True)
    if getattr(args, "fill_views", False):
        fill_views(args.out, verbose=args.verbose)
        return 0
    cache = load_cache()
    sources = SOURCES
    if args.limit:
        sources = [dict(s, maxVideos=args.limit) for s in sources]

    all_songs, seen_ids, seen_keys = [], set(), set()
    report = []

    for i, src in enumerate(sources, 1):
        print(f"[{i}/{len(sources)}] {src['playlist']} ({src['genre']}) …", file=sys.stderr)
        songs, rejected = collect_source(src, cache, probe=not args.no_probe, verbose=args.verbose)
        added = 0
        for song in songs:
            key = (song["artist"].lower(), title_key(song["title"]))
            if song["videoId"] in seen_ids or key in seen_keys:
                continue
            seen_ids.add(song["videoId"])
            seen_keys.add(key)
            all_songs.append(song)
            added += 1
        report.append(
            {
                "key": src["key"],
                "playlist": src["playlist"],
                "genre": src["genre"],
                "playlistId": src["playlistId"],
                "found": len(songs),
                "added": added,
                "rejected": len(rejected),
            }
        )
        print(f"    → {added}곡 추가 (누적 {len(all_songs)}곡)", file=sys.stderr)

    save_cache(cache)

    order = {g: i for i, g in enumerate(GENRE_ORDER)}
    all_songs.sort(key=lambda s: (order.get(s["genre"], 99), -s.get("views", 0), s["title"]))

    payload = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "count": len(all_songs),
        "genres": [g for g in GENRE_ORDER if any(s["genre"] == g for s in all_songs)],
        "sources": report,
        "songs": all_songs,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    print(f"\n저장 완료: {args.out} — {len(all_songs)}곡", file=sys.stderr)
    for row in report:
        print(f"  {row['genre']:8} {row['playlist'][:32]:34} {row['added']:3}곡", file=sys.stderr)
    return 0 if all_songs else 1


if __name__ == "__main__":
    sys.exit(main())
