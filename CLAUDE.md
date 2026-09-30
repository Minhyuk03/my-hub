@AGENTS.md

# 프로젝트 규칙
- UI 문구는 한국어.
- 앱 데이터(DB)는 `~/Library/Application Support/my-hub`(내장 디스크). iCloud(~/Documents 포함)나 외장 디스크에 두지 않는다.
- iCloud 파일은 읽기 전에 `isDataless()`로 확인한다. dataless 파일을 읽으면 다운로드가 시작된다.
- 색인·검색하는 모든 텍스트(파일 이름 포함)는 NFC로 정규화한다.
- 외장 디스크는 경로가 아니라 `isMountPoint()` + 볼륨 UUID로 연결 여부를 판단한다.
- 동기화·AI 정책·인증·백업 규칙은 자동 테스트로 검증한다.
