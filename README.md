# 나의 허브 (my-hub)

Mac mini에서 상시 실행되는 개인 통합 허브입니다. 외장 디스크·iCloud Drive·Obsidian 등 흩어진 작업물을 한 화면에서 검색하고, 프로젝트 단위로 묶습니다.

> 현재 단계: **Phase 1** (세 소스 인덱싱, 키워드 검색, 최근 목록, 동기화 상태, 백업·복원)

## 실행

```bash
npm install
npm run hub          # 웹(http://127.0.0.1:3000) + 인덱서 워커 함께 실행. 멈출 때는 Ctrl+C
```

| 명령 | 하는 일 |
|---|---|
| `npm run hub` | DB 준비 → 웹 서버와 인덱서 워커를 함께 실행 |
| `npm run dev` / `npm run worker` | 웹 / 워커만 따로 실행 |
| `npm test` | 자동 테스트 (동기화 규칙, 검색, 추출, 백업·복원, 접속 판별) |
| `npm run backup` | 지금 바로 백업 |
| `npm run restore -- --list` | 백업 목록 보기 |
| `npm run restore -- <백업 파일>` | 백업에서 복원 (허브를 먼저 멈춤) |
| `npm run bench:hub` | 10만 개 합성 데이터 성능 측정 → `docs/phase1-performance.md` |
| `npm run bench:korean` | 한국어 검색 방식 비교 → `docs/phase0-korean-search.md` |

서버는 `127.0.0.1`에만 바인딩합니다. 외부 접속(Tailscale)은 Phase 2에서 추가합니다.

## 화면

| 주소 | 내용 |
|---|---|
| `/` | 최근 수정(오늘/이번 주/이번 달), 이어서 작업하기, 소스 상태 |
| ⌘K (어디서든) | 검색창. 전체 결과는 `/search` (소스·형식·날짜·태그 필터) |
| `/items/<id>` | 미리보기, 원본 다운로드, Obsidian에서 열기, Finder에서 보기(Mac mini 본인 접속만) |
| `/status` | 소스별 상태·진행률·오류·재시도, 외장 디스크, 백업 |
| `/settings` | 인덱싱 폴더 추가·해제, 외장 디스크에 새 폴더 만들기, 제외 규칙, 동작 설정 |
| `/phase0` | 환경 점검, 한국어 검색 방식 비교 결과 |

## 구조

```
                ┌───────────── 웹 (Next.js, 127.0.0.1:3000) ─────────────┐
 브라우저 ──────▶│ 화면(src/app) · 검색 API · 파일 전송 · 서버 액션          │
                └───────────────┬──────────────────────────────────────┘
                                │ 읽기 + 명령(commands 테이블)
                        ┌───────▼────────┐
                        │ SQLite (WAL)   │ ~/Library/Application Support/my-hub/hub.db
                        └───────▲────────┘
                                │ 쓰기
                ┌───────────────┴──────────── 인덱서 워커 (worker/index.ts) ─┐
                │ 스캔 · 변경 감지(chokidar) · 디스크 연결 감지 · 재시도 · 백업   │
                └──────────────────────────────────────────────────────────┘
```

```
src/app/                 화면과 API (Next.js App Router)
src/proxy.ts             Host·Origin 확인 (DNS rebinding·CSRF 방어)
src/server/db/           스키마(Drizzle)와 연결. 마이그레이션은 drizzle/
src/server/sync/         스캔·삭제 판단·이동 추적·재시도 (동기화 규칙의 핵심)
src/server/sources/      소스 추가 규칙, 연결 확인(마운트·볼륨 UUID), 소스 관리
src/server/extract/      텍스트 추출 (MD, TXT, 코드, PDF, DOCX, HWPX)
src/server/search/       B2 검색 (trigram + 2글자 bigram 색인)
src/server/backup.ts     백업·보관 정책·복원
worker/index.ts          인덱서 워커
tests/                   자동 테스트 (Vitest)
scripts/                 마이그레이션, 백업·복원, 성능 측정
docs/                    검증·측정 결과
```

### 주요 테이블
`sources`(소스) · `folders`(폴더, inode로 이동 추적) · `items`(파일) · `item_text`(색인 원문, NFC) · `items_fts`(trigram 색인) · `items_bigram`(2글자 색인) · `item_errors`(재시도) · `scan_jobs`(스캔 진행·재개 cursor) · `tags`/`item_tags` · `item_links`(위키링크) · `settings` · `commands`(웹→워커) · `backups` · `runtime`(워커 상태)

## 동기화 규칙 (요약)

- **삭제 판단**: 소스가 정상 연결된 상태에서 스캔이 끝까지 성공했을 때만 `deleted`로 표시합니다. 읽지 못한 폴더 아래는 판단하지 않습니다. `deleted` 항목은 30일 보관 후 지웁니다. 폴더 기록은 지우지 않습니다(프로젝트 연결의 "폴더 없음" 경고용).
- **오프라인**: 외장 디스크는 경로가 아니라 실제 마운트 여부와 볼륨 UUID로 판단합니다. 분리되면 소스를 오프라인으로 표시하고 인덱스는 유지합니다. 검색 결과에도 "오프라인"이 표시됩니다.
- **iCloud에만 있는 파일**: 읽으면 다운로드가 시작되므로 제목·정보만 저장합니다(`cloud_only`). 사용자가 항목 화면에서 직접 요청할 때만 받아옵니다.
- **이동·이름 변경**: 같은 볼륨 안에서는 inode로, 볼륨이 다르면 내용 해시로 같은 항목을 이어 갑니다.
- **재시도**: 1분 → 5분 → 30분 → 6시간. 이후에는 오류 목록에 남습니다.
- **중단 후 재개**: 스캔 진행 위치(cursor)를 저장해 두고 다음 실행 때 이어서 합니다.
- **변경 감지 + 주기적 재검사**: 파일 변경은 바로 반영하고, 삭제는 해당 폴더를 다시 확인한 뒤 반영합니다. 전체 재검사 주기는 설정할 수 있습니다(기본 6시간).
- **중복 방지**: 소스는 실제 경로로 등록합니다. 다른 소스 안에 등록된 폴더는 더 구체적인 소스만 인덱싱합니다.
- **제외**: 숨김 파일·폴더, `node_modules`, `.git`, `*.app`, 비밀 파일(`.env*`, `*.pem`, `*.key` 등), 제외 폴더(`/Volumes/Disk/Nikon`, 백업 폴더)는 인덱싱하지 않습니다.

## 백업과 복원

- 워커가 매일 설정한 시각(기본 4시) 이후에 한 번 백업합니다. 실행 중인 DB를 파일 복사하지 않고 `VACUUM INTO`로 만든 뒤 무결성 검사를 합니다.
- 위치: `/Volumes/Disk/hub-backups` (첫 백업 때 만듭니다). 외장 디스크가 없으면 `~/Library/Application Support/my-hub/backups-pending`에 두었다가 디스크가 연결되면 옮깁니다.
- 보관: 날짜별 최근 14개 + 주별 최근 8개.

### 복원 순서
```bash
# 1. 허브를 멈춘다 (npm run hub 를 실행한 터미널에서 Ctrl+C)
# 2. 백업 목록을 본다
npm run restore -- --list
# 3. 복원한다. 현재 DB는 hub.db.before-restore-<시각> 으로 남는다
npm run restore -- /Volumes/Disk/hub-backups/hub-YYYYMMDD-HHMMSS.db
# 4. 허브를 다시 시작한다
npm run hub
```

## 새 소스 커넥터 추가 방법

지금은 파일시스템 커넥터 하나를 외장 디스크·iCloud·Obsidian이 같이 씁니다. Google Drive·Notion 같은 새 소스는 아래 순서로 추가합니다(Phase 3).

1. **소스 종류 추가**: `src/server/db/schema.ts`의 `SourceKind`에 종류를 추가하고, `src/lib/labels.ts`에 한국어 이름을, `src/components/hub-ui.tsx`의 `SourceIcon`에 아이콘을 추가합니다.
2. **커넥터 작성**: `src/server/connectors/<이름>.ts`에 아래를 구현합니다.
   - `checkAvailability(source)`: 토큰 만료·네트워크 끊김이면 `offline`을 돌려줍니다. 이때는 절대 삭제 판단을 하지 않습니다.
   - `fullScan(source, job)`: 전체 목록을 돌면서 항목마다 `items`에 upsert하고 `seenScanId = job.id`를 기록합니다. `scan_jobs.cursor`에 페이지 토큰 등을 저장해 재개할 수 있게 합니다.
   - `incremental(source)`: 변경 API(예: Drive Changes API, Notion `last_edited_time`)로 바뀐 항목만 반영합니다.
   - 원본 웹 주소는 `items.path`에 URL로 저장하고, 원본 식별자(파일 ID·페이지 ID)는 `fileId` 대신 별도 열에 둡니다. 폴더 ID도 `folders`에 저장하면 이동해도 프로젝트 연결이 유지됩니다.
3. **색인**: 본문은 `writeItemText()`로 넣습니다. NFC 정규화와 2글자 색인은 이 함수가 처리합니다.
4. **삭제 판단**: 전체 스캔이 끝까지 성공했을 때만 `seenScanId`가 이번 작업이 아닌 항목을 `deleted`로 표시합니다. `finalizeDeletions`와 같은 규칙을 따릅니다.
5. **워커 등록**: `worker/index.ts`의 `runQueue`에서 소스 종류에 따라 커넥터를 호출합니다.
6. **테스트**: `tests/sync.test.ts`처럼 오프라인·중단·삭제·재시도 규칙을 커넥터별로 테스트합니다. 가짜 API 응답을 주입합니다.
7. **토큰**: `.env.local`(권한 600, git 제외)에 두고, 값은 로그·화면에 출력하지 않습니다.

## 알아둘 점

- **한글 파일 이름**: macOS 파일 이름은 자모 분리형(NFD)인 경우가 많아, 모든 텍스트를 NFC로 정규화한 뒤 색인·검색합니다. 디스크 경로는 원래 모양 그대로 보관합니다.
- **프로젝트 폴더 위치**: `~/Documents`는 iCloud로 동기화되므로, 이 프로젝트는 `~/code/my-hub`에 둡니다.
- **검색 결과가 아주 많을 때**: 후보 2만 건 안에서만 정렬하고 결과 수에 "+"를 표시합니다.
