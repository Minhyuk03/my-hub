# 나의 허브 (my-hub)

Mac mini에서 상시 실행되는 개인 통합 허브입니다. 외장 디스크·iCloud Drive·Obsidian 등 흩어진 작업물을 한 화면에서 검색하고, 프로젝트 단위로 묶습니다.

> 현재 단계: **Phase 3a** (Google Drive 연결)

## 실행

평소에는 launchd 서비스로 상시 실행됩니다 (로그인하면 자동 시작, 죽으면 10초 뒤 다시 시작).

```bash
npm run service:status     # 실행 상태와 최근 로그
npm run service:restart    # 코드 변경 후: 빌드 → DB 준비 → 다시 시작 (--no-build 로 빌드 생략)
npm run service:install    # 처음 등록 (빌드 포함)
npm run service:uninstall  # 등록 해제 (데이터·백업은 그대로)
```

- 로그: `~/Library/Logs/my-hub/web.log`, `worker.log`
- 실행 파일: 허브 전용 Node (`~/Library/Application Support/my-hub/runtime/current/bin/node`, nodejs.org 공식 서명본). 이 파일에 **전체 디스크 접근 권한**이 있어야 iCloud·문서·외장 디스크를 읽습니다. Homebrew node 와 무관합니다.
- **iCloud 에만 있는 파일**: launchd 로 실행된 프로세스는 iCloud 파일을 읽기만으로 내려받을 수 없습니다(오류 -11). 그래서 워커는 이런 파일을 읽지 않고 제목·정보만 저장하고, 사용자가 열거나 다운로드할 때 웹 서버가 도우미 `hub-materialize`(`native/materialize.c`, `npm run build:native`)로 내려받은 뒤 보냅니다. 오래 걸리면 "받아오는 중" 화면이 자동으로 다시 시도합니다.
- 변경 감지는 macOS FSEvents 재귀 감시(소스당 핸들 1개)를 씁니다.
- FileVault 가 켜져 있어 재부팅 후에는 한 번 로그인해야 허브가 시작됩니다. 계획된 재시동은 `sudo fdesetup authrestart` 를 쓰면 한 번 자동으로 잠금이 풀립니다.
- 개발할 때는 서비스를 멈추고(`npm run service:uninstall`) `npm run hub` 로 실행합니다. 포트가 겹칩니다.

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

## 접속과 인증

| 주소 | 누가 | 조건 |
|---|---|---|
| `http://127.0.0.1:3000` | Mac mini 본인 | 없음. Finder 열기·보안 설정은 여기서만 |
| `https://mh-macmini-1.taile87d89.ts.net` | 아이폰·노트북 (Tailscale) | 허용 목록의 Tailscale 계정 + 앱 패스코드 (기기마다 한 번, 90일 유지) |

- 웹 서버(`server.ts`)는 127.0.0.1 의 3000(본인)·3001(Tailscale 전용) 두 포트만 엽니다. `tailscale serve` 가 HTTPS 를 3001 로 넘깁니다. 공용 인터넷에는 공개하지 않습니다.
- 어느 포트로 들어왔는지는 서버가 소켓 기준으로 정합니다. 3000 으로 온 요청의 Tailscale 헤더는 지우고 무시합니다.
- 허용 목록·패스코드는 설정 화면(Mac mini 에서만 보임)에서 바꿉니다. 패스코드는 5번 틀리면 10분 잠깁니다.
- Tailscale 설정 되돌리기: `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve reset`

## 화면

| 주소 | 내용 |
|---|---|
| `/` | 최근 수정(오늘/이번 주/이번 달), 이어서 작업하기, 소스 상태 |
| ⌘K (어디서든) | 검색창. 전체 결과는 `/search` (소스·형식·날짜·태그 필터) |
| `/items/<id>` | 미리보기, 원본 다운로드, Obsidian에서 열기, Finder에서 보기(Mac mini 본인 접속만) |
| `/status` | 소스별 상태·진행률·오류·재시도, 외장 디스크, 백업 |
| `/settings` | 인덱싱 폴더 추가·해제, 외장 디스크에 새 폴더 만들기, 제외 규칙, 동작 설정 |
| `/projects` | 프로젝트 목록, 폴더 이름 기반 연결 제안(수락/거절), Obsidian 1. Projects 가져오기 |
| `/projects/<id>` | 연결된 모든 항목(소스별 필터), 폴더 연결·하위 폴더 포함·제외 항목, 최근 활동, 메모·상태 |
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

### 프로젝트
- 폴더 단위 연결이 기본입니다. `project_folders` 는 `folders.id` 를 가리키고, 폴더는 inode 로 추적되므로 이동·이름 변경에도 연결이 유지됩니다. 폴더 안의 새 파일은 자동 포함됩니다.
- 폴더 밖 항목은 개별 추가, 폴더 안 항목은 제외할 수 있습니다 (`project_items`).
- 연결 제안(`src/server/projects/suggest.ts`): 다른 소스끼리 이름이 같거나(정규화), 동의어 사전으로 같거나, 한글·영문 발음 뼈대가 같거나(블로그≈blog), 한 단어 이름이 다른 이름의 일부인 폴더를 근거와 함께 제안합니다. 전체 스캔 뒤 워커가 다시 계산하며, 거절한 제안은 다시 띄우지 않습니다.

### 주요 테이블
`sources`(소스) · `folders`(폴더, inode로 이동 추적) · `items`(파일) · `item_text`(색인 원문, NFC) · `items_fts`(trigram 색인) · `items_bigram`(2글자 색인) · `item_errors`(재시도) · `scan_jobs`(스캔 진행·재개 cursor) · `tags`/`item_tags` · `item_links`(위키링크) · `settings` · `commands`(웹→워커) · `backups` · `runtime`(워커 상태, 디스크·백업 기록) · `projects` · `project_folders` · `project_items` · `project_suggestions`

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

## Google Drive (Phase 3a)

- 읽기 전용(`drive.readonly`) OAuth "데스크톱 앱". `.env.local` 에 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (권한 600, git 제외).
- 연결: 설정 → Google Drive → "Google Drive 연결" (Mac mini 에서만. 돌아오는 주소가 `127.0.0.1:3000/api/gdrive/callback`).
  refresh token 은 **macOS 키체인**(`my-hub.google-drive`)에만 저장하고 출력하지 않는다. 연결 해제 시 키체인에서 지운다.
- 범위: 설정에서 고른 폴더만 (공유 드라이브 제외). 폴더마다 소스 하나.
- 경로 규칙: `gdrive:/<루트폴더ID>/이름#ID/이름#ID` — 같은 이름 파일도 겹치지 않고, 프로젝트 폴더 연결(경로 앞부분 비교)을 그대로 쓴다. 화면에는 `Google Drive/폴더/파일` 로 보인다.
- 동기화: 처음·주기적 전체 확인(폴더 단위로 중단 후 재개) + 5분마다 변경 목록(Changes API). 폴더·파일은 Drive ID 로 추적하므로 이동·이름 변경에도 같은 항목·같은 프로젝트 연결이 유지된다. 범위 안으로 옮겨 온 폴더는 안의 내용까지 가져온다.
- 본문: Google 문서·프레젠테이션은 텍스트, 스프레드시트는 CSV 로 받아 색인. PDF·DOCX·HWPX·텍스트는 크기 상한 안에서 받아 추출. 바뀌지 않은 파일은 다시 받지 않는다.
- 삭제: 전체 확인이 끝까지 성공했을 때, 또는 Drive 변경 목록이 삭제·휴지통·범위 밖 이동을 알려 줬을 때만. 토큰 만료·네트워크 끊김은 오프라인으로 표시하고 지우지 않는다. 요청 제한(429 등)은 1→2→4→8→16초 간격으로 다시 시도.
- 열기: "Google에서 열기"(원본 웹 주소, 아이폰에서도 가능), 다운로드(Google 문서류는 PDF 로 변환).
- 코드: `src/server/connectors/gdrive/` (client: API·OAuth, sync: 전체 확인·변경 반영, tokens: 키체인), 테스트 `tests/gdrive.test.ts`(가짜 Drive).

## 로컬 AI 자동 분류 (`/ai`, AI 정리)

- Ollama(이 Mac, `http://127.0.0.1:11434`) 만 사용. 외부로 아무것도 보내지 않는다. 모델 파일은 `/Volumes/Disk/ollama/models` (인덱싱 제외).
- 모델: 태그·요약 `exaone3.5:2.4b`, 임베딩 `bge-m3` (측정 결과: `scripts/ai/bench-models.ts`, 결과는 `data/ai/model-bench.md` — 노트 내용이 있어 git 제외).
- 워커가 인덱서가 쉬는 동안 1분마다 조금씩 실행: 임베딩 256개(32개씩 나눠 요청) → 프로젝트 제안(400개씩 나눠 훑음) → 태그·요약 10개.
- **프로젝트 제안**: 가장 비슷한 문서 7개 중 충분히 비슷한(0.6 이상) 이웃의 과반이 같은 프로젝트일 때만. (평균 벡터 비교는 한국어 문서끼리 기본 유사도가 높아 오탐이 많아 쓰지 않음) 본문이 없는 iCloud 파일도 제목·폴더 경로로 판단.
- **태그·요약**: 본문이 200자 이상인 문서만. 기존 태그는 정확히 맞을 때만, 일반적인 말·구조용 태그(para, daily, weekly)는 제외.
- 모두 **제안**이며 수락해야 적용. 수락한 태그는 `item_tags_manual`(허브 안에서만, Obsidian 파일은 바꾸지 않음), 검색·그래프·태그 목록은 `v_item_tags`(본문 태그 + 수락 태그) 뷰를 쓴다. 같은 내용에 대해 거절한 제안은 다시 만들지 않는다.
- 문서 내용은 `<document>` 구분자 안에 넣고, 문서 안의 지시는 따르지 않도록 시스템 지시에 명시(6장).
- 외장 디스크가 없으면 "모델 없음", Ollama 가 꺼져 있으면 "Ollama 꺼짐"으로 표시하고 기다린다.
- 항목 화면: AI 요약, 태그 제안, 붙인 태그 빼기, 비슷한 문서.

## 새 소스 커넥터 추가 방법

Google Drive 커넥터(`src/server/connectors/gdrive/`)가 실제 예시다.

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
