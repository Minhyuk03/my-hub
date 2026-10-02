# 나의 허브 (my-hub)

외장 디스크, iCloud Drive, Obsidian, Google Drive, Notion, GitHub, AI 대화 기록처럼 **여러 곳에 흩어진 작업물을 한 화면에서 찾고 프로젝트로 묶는** 개인용 웹 앱입니다.
Mac mini 에서 상시 실행되고, 노트북·아이폰에서는 Tailscale 로만 접속합니다. 공용 인터넷에는 열지 않습니다.

- **검색**: 한국어 키워드 검색(2글자 검색어 포함)과 로컬 AI 의미 검색을 섞어서 씁니다.
- **프로젝트**: 여러 소스의 폴더를 하나의 프로젝트로 묶습니다. 새 파일은 자동으로 포함됩니다.
- **AI 채팅**: 내 자료를 근거로 답하고 출처를 붙입니다. 기본은 이 Mac 안의 로컬 AI 만 씁니다.
- **유료 서비스가 필요 없습니다.** 외부 AI(Claude·ChatGPT)는 원할 때만 켭니다.

## 주요 기능

| 기능 | 내용 |
|---|---|
| 통합 검색 | ⌘K 어디서든. 소스·형식·날짜·프로젝트·태그 필터. 키워드 / 의미 / 섞어서 |
| 홈 | 즐겨찾기 타일, 북마크 바, 아래 서랍에 일정(Mac 캘린더)·이어서 작업하기·최근 수정 |
| 항목 보기 | 미리보기(MD·PDF·이미지·코드), 원본 다운로드, Obsidian·Google·Notion 에서 열기, Finder 에서 보기(Mac mini 본인만) |
| 프로젝트 | 폴더 단위 연결, 이름이 비슷한 폴더 묶기 제안, Obsidian `1. Projects` 가져오기, 쉬고 있는 프로젝트 알림 |
| 그래프 | Obsidian 처럼 노트·위키링크·태그를 점과 선으로. 태그 있는 모든 파일, AI 제안 태그(점선)까지 |
| 로컬 AI 정리 | 태그·요약·프로젝트 제안, Obsidian PARA 정리 제안. **모두 제안이고, 수락해야 적용** |
| AI 채팅 | 전체·프로젝트·문서 범위, 출처 번호와 답할 때의 원문 보관, 요약·현황 정리·할 일 뽑기 |
| 외부 전송 금지 🔒 | 소스·폴더·프로젝트·항목 단위. 서버가 강제하고, 보낸 내용은 기록 |
| 중복 파일 | 내용이 같은 파일을 묶어 보여 주기만 합니다 (지우지 않음) |
| 동기화 상태 | 소스별 진행률·오류·재시도, 외장 디스크, 백업 |
| 아이폰 앱 | 홈 화면에 추가하면 앱처럼 열림 (PWA) |

## 지원하는 소스

| 소스 | 연결 방식 | 비고 |
|---|---|---|
| 외장 디스크 · 로컬 폴더 | 파일시스템 + FSEvents | 디스크를 빼면 "오프라인"으로 표시하고 색인은 유지 |
| iCloud Drive · Obsidian | 파일시스템 | 내려받지 않은 파일은 제목·정보만. 열 때 내려받음. `[[위키링크]]`·태그 |
| Google Drive | OAuth (읽기 전용) | 고른 폴더만. 문서·시트는 텍스트로 색인 |
| Notion | 내부 통합 (읽기 전용) | 고른 페이지와 하위 페이지·데이터베이스 |
| GitHub | Fine-grained PAT (읽기 전용) | README·최근 커밋·이슈·PR |
| Figma | 개인 액세스 토큰 | 팀·프로젝트 등록 방식 (선택) |
| AI 대화 기록 | Claude Code 세션, claude.ai·ChatGPT 내보내기 파일 | 비밀 값은 가린 뒤 저장, 외부 AI 전송 기본 금지 |
| Mac 캘린더 | EventKit 도우미 앱 | 홈에 일정만 표시 (검색·AI 에는 넣지 않음) |

추출하는 문서 형식: Markdown, 텍스트, 코드, PDF, DOCX, HWPX, PPTX, XLSX, Jupyter 노트북. 이미지·영상은 정보만 저장합니다.

## 기술 스택

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · SQLite (better-sqlite3, Drizzle, FTS5, sqlite-vec) · Ollama (`bge-m3` 임베딩, `gemma3:4b` 대화, `exaone3.5:2.4b` 태그) · launchd · Tailscale · Vitest

## 요구 사항

- macOS (Apple Silicon, 16GB 에서 측정), Xcode Command Line Tools (네이티브 도우미 빌드용)
- Node.js 26 (nodejs.org 공식 버전 권장. 상시 실행용으로 허브 전용 사본을 둡니다)
- 선택: [Tailscale](https://tailscale.com) (다른 기기에서 접속), [Ollama](https://ollama.com) + 모델 (AI 기능)

## 설치

먼저 상시 실행에 쓸 **허브 전용 Node** 를 둡니다. 전체 디스크 접근 권한을 이 파일 하나에만 주기 위해서이고, Homebrew node 와는 상관이 없습니다.

```bash
mkdir -p ~/Library/Application\ Support/my-hub/runtime && cd ~/Library/Application\ Support/my-hub/runtime
curl -fLO https://nodejs.org/dist/v26.10.0/node-v26.10.0-darwin-arm64.tar.xz
curl -fLO https://nodejs.org/dist/v26.10.0/SHASUMS256.txt
grep darwin-arm64.tar.xz SHASUMS256.txt | shasum -a 256 -c -   # "OK" 가 나와야 한다
tar -xf node-v26.10.0-darwin-arm64.tar.xz && ln -sfn node-v26.10.0-darwin-arm64 current
```

그다음 허브를 받아 설치합니다.

```bash
git clone https://github.com/Minhyuk03/my-hub.git ~/code/my-hub
cd ~/code/my-hub
npm install
cp .env.example .env.local && chmod 600 .env.local   # 쓸 서비스의 값만 채운다
npm run build:native                                 # iCloud 내려받기·캘린더 도우미
npm run service:install                              # 빌드 → DB 준비 → launchd 등록
```

> 프로젝트는 `~/Documents` 밖에 두세요. `~/Documents` 는 iCloud 로 동기화되어 개발 파일이 올라갑니다.

설치 뒤에 할 일:

1. **전체 디스크 접근 권한**: 시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한에 허브 전용 Node(`~/Library/Application Support/my-hub/runtime/current/bin/node`)를 추가합니다. iCloud·문서·외장 디스크를 읽는 데 필요합니다.
2. 브라우저에서 `http://127.0.0.1:3000` → **설정**에서 인덱싱할 폴더를 추가합니다.
3. (다른 기기에서 쓰려면) 설정 → 외부 접속에서 허용할 Tailscale 계정과 **앱 패스코드**를 정한 뒤:
   ```bash
   tailscale serve --bg http://127.0.0.1:3001
   ```
4. (AI 기능) Ollama 를 설치하고 모델을 받습니다:
   ```bash
   ollama pull bge-m3 && ollama pull gemma3:4b && ollama pull exaone3.5:2.4b
   ```
   그다음 AI 정리 화면에서 켭니다.

### 환경 변수 (`.env.local`)

| 이름 | 용도 |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Drive (OAuth 데스크톱 앱, `drive.readonly`) |
| `NOTION_TOKEN` | Notion 내부 통합 |
| `GITHUB_TOKEN` | GitHub fine-grained PAT (읽기 전용) |
| `FIGMA_TOKEN` | Figma 개인 액세스 토큰 |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | AI 채팅 외부 모델 (선택, 설정에서 "외부 AI 사용" 을 켜야 쓰임) |

토큰은 `.env.local`(권한 600, git 제외) 또는 macOS 키체인(Google refresh token)에만 두고, 로그·화면에 출력하지 않습니다.

## 실행과 운영

평소에는 launchd 서비스로 상시 실행됩니다. 로그인하면 자동으로 시작하고, 죽으면 10초 뒤 다시 시작합니다.

| 명령 | 하는 일 |
|---|---|
| `npm run service:status` | 실행 상태와 최근 로그 |
| `npm run service:restart` | 코드 변경 후: 빌드 → DB 준비 → 다시 시작 (`--no-build` 로 빌드 생략) |
| `npm run service:install` / `service:uninstall` | 서비스 등록 / 해제 (데이터·백업은 그대로) |
| `npm run hub` | 개발용: 웹과 워커를 터미널에서 실행 (서비스를 먼저 해제. 포트가 겹침) |
| `npm run backup` | 지금 바로 백업 |
| `npm run restore -- --list` | 백업 목록 |

- 로그: `~/Library/Logs/my-hub/web.log`, `worker.log`
- 데이터: `~/Library/Application Support/my-hub/` (DB, 세션 키, 가져온 파일 임시 보관)
- FileVault 가 켜져 있으면 재부팅 뒤 한 번 로그인해야 허브가 시작됩니다. 계획된 재시동은 `sudo fdesetup authrestart` 를 쓰면 한 번 자동으로 잠금이 풀립니다.

## 접속과 보안

| 주소 | 누가 | 조건 |
|---|---|---|
| `http://127.0.0.1:3000` | Mac mini 본인 | 기본은 없음. 설정에서 "Mac mini 에서 접속할 때도 패스코드 요구"를 켜면 패스코드 필요. Finder 열기·보안 설정은 여기서만 |
| `https://<기기>.<tailnet>.ts.net` | 노트북·아이폰 (Tailscale) | 허용 목록의 Tailscale 계정 + 앱 패스코드 (기기마다 한 번, 90일 유지) |

- 서버는 `127.0.0.1` 에만 바인딩합니다. 외부 접속은 `tailscale serve`(HTTPS, tailnet 전용)뿐입니다.
- 어느 포트로 들어왔는지는 서버가 소켓 기준으로 정합니다. Tailscale 사용자 헤더는 3001(serve 전용)로 온 요청에서만 믿습니다.
- 패스코드는 5번 틀리면 10분 잠깁니다.
- Host·Origin 을 확인해 DNS rebinding·CSRF 를 막습니다.
- 보안 헤더(`X-Frame-Options`, `nosniff`, `Referrer-Policy`)와 nonce 기반 CSP 를 씁니다.
- Tailscale 주소는 서버가 `tailscale status` 로 읽으므로, 기기·tailnet 이름을 바꿔도 코드는 그대로입니다. `tailscale serve` 만 다시 설정하면 됩니다.

### AI 와 개인정보 (서버에서 강제)

- 기본은 **로컬 전용**입니다. Claude·ChatGPT 요청은 서버가 막습니다.
- 외부 AI 를 켜도 🔒 금지 자료(소스·폴더·프로젝트·항목. 하나라도 금지면 금지)는 서버가 빼고 보냅니다. 금지 자료에서 나온 답·조각·인용도 같은 규칙을 따릅니다.
- 외부로 보낸 요청은 어떤 문서·조각을 보냈는지 기록하고 화면에서 확인할 수 있습니다.
- 문서 내용은 구분자로 감싸고, 문서 안의 지시는 따르지 않습니다. 근거가 없으면 "근거가 부족합니다"라고 답합니다.

## 백업과 복원

- 매일 정한 시각(기본 4시)에 실행 중인 DB 를 `VACUUM INTO` 로 백업하고 무결성 검사를 합니다. 보관 정책은 날짜별 14개 + 주별 8개입니다.
- 위치는 외장 디스크(기본 `/Volumes/Disk/hub-backups`)입니다. 디스크가 없으면 내장 디스크에 두었다가 디스크가 연결되면 옮깁니다.

```bash
npm run service:uninstall                       # 1. 허브를 멈춘다
npm run restore -- --list                       # 2. 백업 목록을 본다
npm run restore -- <백업 파일 경로>               # 3. 복원 (현재 DB 는 hub.db.before-restore-<시각> 으로 남음)
npm run service:install                         # 4. 다시 시작
```

## 개발

```bash
npm test           # 자동 테스트 (동기화 규칙, 검색·추출, 커넥터, AI 정책, 인증, 백업 등)
npm run lint
npm run bench:hub  # 10만 개 합성 데이터 성능 측정 → docs/phase1-performance.md
```

- 동작 원리, 동기화 규칙, 커넥터별 세부 사항, AI 채팅 정책, **새 소스 커넥터 추가 방법**은 [docs/architecture.md](docs/architecture.md) 에 있습니다.
- 마이그레이션은 `drizzle/` 에 있습니다 (스키마를 바꾼 뒤 `npx drizzle-kit generate`). FTS·sqlite-vec 같은 가상 테이블은 직접 쓴 SQL 입니다.

## 만든 순서

| 단계 | 내용 |
|---|---|
| Phase 0 | 환경 점검, 한국어 검색 방식 비교 ([결과](docs/phase0-korean-search.md)) |
| Phase 1 | 파일시스템 동기화·검색·미리보기, 백업·복원 |
| Phase 2 | 프로젝트, launchd 상시 실행, Tailscale 접속·패스코드 |
| Phase 3 | Google Drive · Notion · GitHub · Figma |
| Phase 4 | AI 대화 기록 가져오기, 의미 검색 + 하이브리드 ([측정](docs/phase4-semantic.md)) |
| Phase 5 | 6장 정책을 적용한 AI 채팅 (로컬 AI · Claude · ChatGPT) |
| Phase 6 | 로컬 전용 모드, 중복 파일, PARA 정리 제안, 캘린더, PWA, 보안 헤더 ([측정](docs/phase6-performance.md)) |

개인 프로젝트입니다.
