# AI 코드 작업

상단 **AI 코드** → `/ai-code`. 기존 `/ai` 문서 정리, `/chat` 검색 채팅, `server.ts` 인증과 두 루프백 리스너는 유지한다. **Mac mini 본인 접속(`http://127.0.0.1:3000`)에서만** 쓸 수 있다. Mac 에서 프로그램(Codex·Claude·Git·검사)을 실행하는 기능이라 Tailscale(노트북·아이폰) 접속에서는 메뉴가 숨겨지고 화면·API 가 거부(403)된다.

## 준비와 실행

Mac mini에서 같은 사용자 계정으로 `codex login`, `claude auth login`을 완료한다. `codex exec --help`, `codex features list`, `claude --help`로 설치된 CLI가 이 문서의 플래그를 지원하는지 확인한다. 구버전은 실행 실패로 표시되며 권한 우회로 재시도하지 않는다.

기본 선택 폴더는 `~/code/my-hub`. 다른 저장소를 추가하려면 `.env.local`에 다음과 같이 지정하고 웹 서버를 재시작한다. 경로는 Git 저장소 루트여야 하며 등록은 서버 관리자가 한다. 웹에서 임의 경로를 입력할 수 없다.

```dotenv
HUB_AI_PROJECTS=["/Users/mh/code/my-hub","/Users/mh/code/other-project"]
# 서비스의 PATH에서 CLI를 찾지 못하는 경우에만 지정
# HUB_CODEX_BIN=/opt/homebrew/bin/codex
# HUB_CLAUDE_BIN=/Users/mh/.local/bin/claude
```

```bash
cd ~/code/my-hub
npm run dev
# 운영 모드
npm run build
# 이 작업 환경처럼 Turbopack 로컬 포트 생성이 막히면: npx next build --webpack
npm run start
# 기존에 LaunchAgent로 운영 중이면 기존 service:restart 절차 사용
```

`next dev`로 직접 실행하지 말고 기존 `server.ts`를 사용하는 npm 스크립트로 실행한다. 이미 실행 중인 서버와 같은 포트로 중복 실행하지 않는다. Tailscale Serve 설정과 3000/3001 바인딩 변경은 필요 없다.

## 사용

1. 프로젝트와 Codex/Claude를 선택하고 프롬프트를 입력해 실행한다.
2. 출력은 SSE로 스트리밍된다. JSON 이벤트에는 AI 응답, 파일 작업, 오류 등이 포함된다. 종료 상태와 종료 코드를 함께 확인한다.
3. 기록에서 작업을 선택하면 출력이 복원된다. **선택한 대화 이어가기**는 이전 요청과 마지막 출력 24,000자를 다음 요청에 전달한다. CLI 원본 세션을 재개하는 방식은 아니며, 긴 대화 전체를 보존해 전달하지 않는다.
4. **테스트 / 타입 검사 / 코드 검사**는 설치된 Vitest / TypeScript / ESLint를 Node로 직접 실행한다. 각각 `vitest run`, `tsc --noEmit --incremental false`, `eslint`에 해당한다. npm scripts와 사용자가 입력한 명령은 실행하지 않는다. 도구가 없는 프로젝트에서는 해당 버튼이 나타나지 않는다. 프로젝트의 검사 설정과 테스트 코드는 실행되므로 신뢰하는 저장소만 등록한다.
5. Git 영역에서 변경 파일 목록, 작업 폴더 diff, 스테이징 diff를 확인한다. 미추적 새 파일은 목록에 표시되지만 내용은 스테이징 전 diff에 표시되지 않는다. **Git commit**은 기존 스테이징 영역만 커밋한다. 먼저 Mac mini 터미널에서 원하는 파일만 `git add -- 파일경로`로 스테이징한다. 메시지를 입력하고 버튼을 누른다. 마지막 확인 이후 diff가 바뀌면 커밋은 거부된다. 자동 전체 스테이징과 push는 하지 않는다. 이 커밋은 Git hooks와 GPG 서명을 실행하지 않는다.
6. 진행 중 기록을 선택하면 **작업 중단** 버튼이 나타난다. 프로세스 그룹에 SIGTERM을 보낸 뒤 3초 후 SIGKILL로 종료한다. 창을 닫아도 작업은 서버에서 계속된다. 다시 열어 기록을 선택하면 출력이 재연결된다.

## 저장과 실행 제한

- 기록: 기존 `HUB_DATA_DIR` 아래 `ai-code/<UUID>.json`. 기본은 `~/Library/Application Support/my-hub/ai-code`. 폴더 700, 파일 600. 기존 DB 마이그레이션이 필요 없다. 프롬프트와 CLI 출력에는 프로젝트 내용이 포함될 수 있으며 기존 앱 인증을 통과한 사용자들이 이 기록을 공유한다.
- 출력은 1초마다 저장되고 종료 시 최종 저장된다. 서버 재시작 시 미완료 기록은 `interrupted`로 표시되며 자동 재실행하지 않는다.
- 프로젝트별 동시 작업 하나. 실행당 20분, 출력 2MiB 제한. 검사는 같은 제한과 중단 기능을 사용한다.
- 브라우저 요청은 프로젝트 ID, AI 종류, 프롬프트, 고정 검사 종류만 지정한다. `spawn`은 `shell: false`; 임의 executable/argv, 셸 입력, eval을 받는 API가 없다.
- Codex: workspace-write sandbox, 승인 never, 셸/PTY 실행, 코드 실행 도구, hooks, plugins, apps, 브라우저, 하위 에이전트 비활성화. 사용자 config/rules 무시. 프로젝트나 상위 폴더의 `.codex/config.toml`은 MCP 명령을 추가할 수 있어 실행을 거부한다. 무시되는 사용자 CODEX_HOME config는 이 검사에서 제외한다.
- Claude: `--restricted --safe-mode`, 빈 strict MCP, Read/Edit/Write/Glob/Grep만 제공하며 Bash 등 실행 도구를 제공하지 않는다. 파일 수정은 acceptEdits, 추가 승인은 거부한다.
- 엄격한 실행 제한 때문에 AI가 셸을 이용한 검색·테스트를 요청하면 사용할 수 없다. 특히 Codex는 셸을 차단하여 코드 탐색 능력이 제한될 수 있으므로 필요한 코드를 프롬프트에 함께 입력한다. 프로젝트 소스를 자동 수집·첨부하는 기능은 포함하지 않는다. 검사는 페이지 버튼으로 실행한다. 시스템에서 관리하는 CLI 정책/설정은 관리자가 신뢰해야 한다.
- 쓰기 API는 JSON + Origin을 필수로 확인한다. 기존 사용자 정의 서버의 인증과 신뢰 헤더를 사용한다. SSE/기록은 no-store.
- Git은 고정 status/diff/rev-parse/commit 작업만 실행하며 external diff/textconv/fsmonitor/hooks를 비활성화한다.

## 검증

```bash
npx vitest run tests/ai-code.test.ts tests/auth.test.ts tests/http.test.ts
npx tsc --noEmit --incremental false
npx eslint src/server/ai-code src/app/ai-code src/app/api/ai-code tests/ai-code.test.ts
npm run build
```

자동 테스트는 임시 Git 저장소와 가짜 CLI를 사용한다. 폴더/명령 거부, 프롬프트 셸 인젝션 차단, 기록과 후속 문맥, 동시 실행 제한, 중단, staged-only 커밋, 오래된 diff 거부, Origin 검사를 확인한다. 실제 모델 호출은 계정 로그인·네트워크·구독 상태가 필요하므로 별도 실제 사용 확인이 필요하다.

변경 파일: `src/server/ai-code/service.ts`, `src/app/api/ai-code/route.ts`, `src/app/ai-code/page.tsx`, `src/app/ai-code/workspace.tsx`, `src/components/app-header.tsx`, `tests/ai-code.test.ts`, `.env.example`, 이 문서. `server.ts`는 변경하지 않는다.

CLI 근거: [Codex 비대화형 실행](https://developers.openai.com/codex/noninteractive/), [Codex 설정](https://developers.openai.com/codex/config-reference/), [Claude CLI](https://code.claude.com/docs/en/cli-reference). 설치된 CLI 도움말로 제한 플래그도 확인했다.

## 이번 구현의 검증 결과

전체 테스트와 추가 SSE/기록 복원 테스트, 타입 검사, 변경 파일 ESLint를 통과했다. 기본 `npm run build`는 이 작업 환경에서 Turbopack 내부 포트 생성이 차단되어 실패했으며, `npx next build --webpack`은 운영 빌드에 성공했다. 실제 CLI 모델 호출과 브라우저 조작 확인은 수행하지 않았다. `server.ts`와 Tailscale 설정은 변경하지 않았다.

서버의 정상 종료(SIGINT/SIGTERM) 시 실행 중 프로세스 그룹도 종료하며, CLI에는 필요한 인증·환경 변수만 전달한다.

## 2026-10-06 실제 연결 확인

서비스 PATH에 `.local/bin`이 없어도 알려진 설치 폴더에서 CLI를 찾도록 수정했다. Codex의 실제 모델 요청이 `HUB_CONNECTION_OK`로 성공했다. Claude는 실제 요청에서 OAuth token revoked(401)가 반환되어 `claude auth login`으로 재로그인이 필요하다. 운영 Webpack 빌드는 성공했다. 실행 중인 서버가 이전 빌드를 읽어 Client Manifest 오류가 나므로 Mac mini 터미널에서 `launchctl kickstart -k gui/$(id -u)/com.myhub.web`으로 웹 서비스만 재시작해야 한다. 작업 환경의 시스템 권한 제한으로 자동 재시작은 수행하지 못했다.

후속 확인: 사용자가 웹 서비스를 재시작한 뒤 `/ai-code` 화면이 정상 표시됐다. Claude 재로그인 후 실제 응답도 `HUB_CONNECTION_OK`로 성공했다. Chrome 화면에서 Codex와 Claude 모두 completed/종료 코드 0, SSE 출력과 기록 생성을 확인했다. 페이지의 타입 검사도 종료 코드 0으로 통과했다.

최종 웹 검증: 서비스 환경의 테스트 실행 경로 문제를 테스트 fixture에서 수정했고, 페이지의 테스트 버튼으로 전체 181개 테스트가 통과했다. 새로고침 후 기록 목록이 유지되며 저장한 Codex 응답을 다시 열어 복원되는 것을 확인했다.
