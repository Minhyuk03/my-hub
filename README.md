# 나의 허브 (my-hub)

Mac mini에서 상시 실행되는 개인 통합 허브입니다. 외장 디스크·iCloud Drive·Obsidian 등 흩어진 작업물을 한 화면에서 검색하고, 프로젝트 단위로 묶습니다.

> 현재 단계: **Phase 0** (환경 점검, 한국어 검색 방식 검증, 기본 화면)

## 실행

```bash
npm install
npm run dev        # http://127.0.0.1:3000 (127.0.0.1에만 바인딩)
npm test           # 자동 테스트
npm run bench:korean  # 한국어 검색 방식 비교 (결과: docs/phase0-korean-search.md, /phase0 화면)
```

## 구조

```
src/app/            화면 (Next.js App Router)
  phase0/           환경 점검 + 한국어 검색 비교 결과
src/lib/config.ts   기본 경로·제외 규칙
src/lib/env-check.ts 경로·권한·외장 디스크(마운트 여부, 볼륨 UUID) 점검
src/lib/fs/         파일시스템 도우미 (iCloud 미다운로드 파일 판별 등)
scripts/phase0/     Phase 0 검증 스크립트
tests/              자동 테스트 (Vitest)
docs/               검증 결과 문서
```

## 데이터 위치

- 앱 데이터(SQLite DB): `~/Library/Application Support/my-hub` (내장 디스크, iCloud 동기화 대상 아님). `HUB_DATA_DIR`로 변경 가능.
- 프로젝트 폴더도 iCloud 동기화 대상(`~/Documents`) 밖에 둡니다.

## 알아둘 점

- **iCloud 미다운로드 파일**: 최신 macOS는 `.icloud` 파일 대신 `dataless` 플래그를 씁니다. 이런 파일을 읽으면 다운로드가 시작되므로, 인덱서는 먼저 플래그를 확인하고 메타데이터만 저장합니다(`cloud_only`).
- **한글 파일 이름**: macOS 파일 이름은 자모 분리형(NFD)인 경우가 많아, 모든 텍스트를 NFC로 정규화한 뒤 색인·검색합니다.
- **외장 디스크 분리**: 경로가 아니라 볼륨 UUID와 실제 마운트 여부로 연결 상태를 판단합니다.

## 작성 예정
- 백업·복원 방법 (Phase 1)
- 새 소스 커넥터 추가 방법 (Phase 1)
- 상시 실행(launchd)·Tailscale 접속 (Phase 2)
