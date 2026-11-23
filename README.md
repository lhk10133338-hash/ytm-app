# YMUSIC — YouTube Music 스타일 개인 음악 앱 (PWA)

YouTube Music 의 다크 UI 를 그대로 옮긴 **개인용 음악 스트리밍 PWA** 입니다.
HYBE · SM · JYP · YG · Warner Music Korea · Dingo Music · Lofi Girl 등 **공식 채널의
재생목록**에서 한국에서 임베드 재생 가능한 곡 **436곡**을 미리 모아 두었고,
`.json` 목록 + YouTube IFrame 플레이어만으로 동작합니다(서버·계정 불필요).

- **갤럭시 Z 폴드** 커버 화면(≤390px) → 펼친 화면(≥680px) → 가로 모드까지 대응
- 설치하면 홈 화면 앱처럼 실행 (manifest + service worker)
- 좋아요·재생목록·최근 감상은 `localStorage` 에 영구 저장

## 화면과 기능

### 홈
- 분위기/장르 **필터 칩** (전체 · K-POP · 발라드 · 힙합·R&B · 팝송 · 드라이브 · OST · 로파이·집중 + #신나는 #잔잔한 #새벽 #집중 …)
- **최근 감상** 가로 스크롤
- **빠른 선곡** — 커버 2열(커버 화면)·4열(펼친 화면) 그리드
- **인기 차트** — 조회수 기준 상위 12곡
- **추천 플레이리스트** — 수집한 공식 재생목록별 카드 가로 스크롤

### 탐색
- 상단 실시간 검색창
- **YouTube Data API v3 키가 저장되어 있으면** 실제 YouTube 를 실시간 검색
  (`search` → `videos` 로 `status.embeddable` · `regionRestriction`(KR) 확인 후 재생 가능한 곡만 표시)
- 키가 없으면 내장 436곡 검색 + “설정에서 무료 YouTube API 키를 넣으면…” 안내 배너
- 검색어가 없을 때는 **장르별 차트**

### 보관함
- **좋아요** 한 곡 / **내가 만든 재생목록**(생성 · 곡 추가 · 곡 삭제 · 목록 삭제) / **최근 감상**
- 모든 변경은 즉시 `localStorage` 에 저장되고, API 로 검색한 곡도 스냅샷으로 함께 저장됩니다

### 플레이어
- **미니 플레이어**: 탭바 바로 위 고정 — 썸네일 · 곡명 · 아티스트 · 재생/일시정지 · 다음 곡 · 진행바. 탭하면 풀스크린
- **풀스크린 플레이어**
  - 상단: 내리기 · 재생 출처 · **`노래`/`동영상` 토글** · 설정(⚙️)
  - 노래 모드: 큰 정사각형 앨범 아트(썸네일 색감 그라데이션 배경) / 동영상 모드: 16:9 YouTube 영상
  - 좋아요(♥) · 시크바 + 현재/전체 시간 · **셔플 · 이전 · 큰 재생/일시정지 · 다음 · 반복(끔/전체/1곡)**
  - 하단 탭: **다음 트랙**(대기열 편집) / **비슷한 곡** / **OLED 절전**
  - `ENDED` 이벤트에서 **다음 곡 자동 재생**
  - **Wake Lock**: 재생 중 화면 꺼짐 방지, 일시정지·백그라운드 전환 시 해제, 복귀 시 재획득
  - Media Session(잠금화면 곡 정보·이전/다음) 연동
- **OLED 블랙 절전 모드**: 화면을 `#000000` 으로 덮고 현재 시각 + 곡 제목·아티스트만 은은하게(번인 방지 미세 드리프트).
  **화면 두 번 탭** 또는 ‘절전 해제’ 버튼으로 풀스크린 플레이어 복귀

### 설정
- YouTube Data API v3 키 입력 · 저장 · **연결 테스트**
- 내장 라이브러리 곡 수·수집일 안내, **내장 데이터 새로고침**, 앱 캐시 비우기, 저장 데이터 초기화

## 폴더 구조

```
ytm-app/
├── index.html                 # 앱 셸(컨테이너만)
├── css/style.css              # 다크 테마 + 폴드 반응형 + 플레이어/OLED
├── js/app.js                  # 상태·라우터·화면·플레이어·localStorage (바닐라 JS)
├── data/
│   ├── music.json             # 수집 결과(436곡) — 앱이 읽는 데이터
│   └── probe_cache.json       # 임베드/지역/조회수 검증 캐시
├── icons/                     # 원형 재생 아이콘 (SVG + PNG 192/512/maskable/apple)
├── manifest.json              # PWA 매니페스트 (name/short_name: YMUSIC)
├── sw.js                      # 서비스 워커(네트워크 우선 + 오프라인 폴백)
├── scripts/fetch_music.py     # 수집 스크립트(파이썬 표준 라이브러리만)
├── tools/smoke_test.py        # 화면·로직 스모크 테스트(quickjs)
└── README.md
```

## 데이터 수집

```bash
python3 scripts/fetch_music.py                # 전체 수집 + 임베드 검증
python3 scripts/fetch_music.py --no-probe     # 임베드 검증 생략(빠른 확인)
python3 scripts/fetch_music.py --limit 5      # 소스당 5곡만(테스트)
python3 scripts/fetch_music.py --fill-views   # 기존 데이터의 빈 조회수만 다시 채움
```

동작 순서

1. 공식 채널 재생목록 페이지의 `ytInitialData` 파싱(continuation 으로 2페이지까지)
2. 곡이 아닌 영상 제외 — 티저·예고·직캠·안무·인터뷰·메들리·쇼츠·라이브클립 등 + 길이 필터(70초~10분, 로파이는 예외)
3. **임베드 검증**
   - 시청 페이지의 `ytInitialPlayerResponse.playabilityStatus` → `playableInEmbed`, `availableCountries`(KR 포함)
   - 봇 확인(LOGIN_REQUIRED)으로 플레이어 응답이 막히면 **oEmbed 200/401** 로 보조 판정
4. 조회수는 시청 페이지 HTML 의 `"viewCount"` 에서 수집(인기 차트 정렬에 사용)
5. 제목·아티스트 정리 — `아티스트 '곡명' MV` / `아티스트 - 곡명 Official Video` 등에서 곡명만 남기고,
   `- Topic`·`VEVO`·프로그램 태그(`[이슬라이브]`) 제거, 같은 곡의 버전 중복은 1곡만 유지
6. `data/music.json` 저장 (`videoId`, `title`, `artist`, `duration`, `durationSec`, `thumbnail`,
   `genre`, `playlist`, `moods`, `views`, `embedOk`, `embedCheck` …)

수집원(24개 재생목록)

| 장르 | 재생목록 |
| --- | --- |
| K-POP | NewJeans · LE SSERAFIM · BOYNEXTDOOR · aespa · Stray Kids · ITZY · NMIXX · BLACKPINK · YG MUSIC VIDEOS · 기분전환이 필요할 때 |
| 발라드 | 잔잔한 새벽감성 가요 · 이슬라이브 (Tipsy Live) |
| 힙합·R&B | 턴업하기 좋은 국내 힙합 |
| 팝송 | Dua Lipa · Benson Boone · Tones And I · Melanie Martinez · GAYLE |
| OST | 최애 드라마 속 그 노래 |
| 드라이브 | 밤 드라이브 신스웨이브 · 시원하고 청량한 느낌의 가요 |
| 로파이·집중 | relaxing piano · relaxing jazz · lofi hip hop |

## 실행 · 배포

로컬에서 확인:

```bash
cd ytm-app
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000
```

> `index.html` 을 파일로 바로 열면 `fetch` 가 막혀 목록이 비어 보입니다. 반드시 http 로 열어 주세요.

GitHub Pages:

1. 이 폴더를 저장소 루트로 올립니다.
2. **Settings → Pages → Source: Deploy from a branch → `main` / root**.
3. `https://<사용자>.github.io/<저장소>/` 접속 → 크롬 메뉴 → **홈 화면에 추가**.
4. 데이터 갱신은 `python3 scripts/fetch_music.py` 를 돌린 뒤 `data/music.json` 을 커밋합니다
   (이 저장소에는 GitHub Actions 워크플로를 두지 않았습니다).

## YouTube API 키 (선택)

1. [Google Cloud Console](https://console.cloud.google.com/) → 프로젝트 생성
2. **API 및 서비스 → 라이브러리 → YouTube Data API v3** 사용 설정
3. **사용자 인증 정보 → API 키 만들기**
4. 앱의 **설정(⚙️) → YouTube Data API v3 키** 에 붙여 넣고 **연결 테스트 → 저장**

키는 이 기기의 `localStorage` 에만 저장되며 서버로 전송되지 않습니다. 무료 할당량은 하루 10,000 units
(검색 1회 ≈ 100 units)이라 개인 사용에는 충분합니다.

## 스모크 테스트

```bash
python3 tools/smoke_test.py
```

quickjs 로 `js/app.js` 를 실제 실행해 확인합니다.

- JS 문법/로딩, 데이터 436곡의 필수 필드·중복·길이·임베드 상태
- HTML/CSS 정합성(필수 id, 미디어쿼리, `data-act` ↔ JS 핸들러), PWA(manifest·아이콘·SW)
- 홈 · 탐색 · 보관함 · 풀플레이어 · OLED 화면 렌더
- 내장 검색 / API 검색(임베드 불가·한국 차단 제외) / 좋아요 / 재생목록 CRUD / 최근 감상
- 대기열 다음·이전, 셔플, 반복(끔→전체→1곡), 노래↔동영상 모드, 절전 진입·복귀

## 알려진 한계

- YouTube 약관상 공식 IFrame 플레이어로만 재생합니다(오디오만 따로 추출하지 않음).
  영상 자체가 임베드를 막은 경우 앱이 자동으로 다음 곡으로 넘어갑니다.
- 조회수·임베드 여부는 수집 시점 기준입니다. 오래 쓰면 `--fill-views`/재수집으로 갱신하세요.
- iOS/Safari 는 백그라운드 오디오 지속을 보장하지 않습니다(화면이 켜져 있을 때 가장 안정적).
- API 키를 넣지 않으면 내장 436곡 안에서만 검색됩니다.
