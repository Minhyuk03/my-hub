/*
 * hub-materialize: iCloud 에만 있는(dataless) 파일을 내려받게 한다.
 * launchd 로 실행된 프로세스는 기본적으로 dataless 파일을 읽을 수 없어(EDEADLK) 이 도우미가
 * 자기 프로세스의 I/O 정책을 "내려받기 허용"으로 바꾼 뒤 파일을 1바이트 읽는다.
 * 사용: hub-materialize <파일>...   (사용자가 직접 열거나 다운로드할 때만 호출)
 */
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/resource.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (setiopolicy_np(IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES, IOPOL_SCOPE_PROCESS, IOPOL_MATERIALIZE_DATALESS_FILES_ON) != 0) {
    perror("setiopolicy_np");
    return 2;
  }
  int rc = 0;
  for (int i = 1; i < argc; i++) {
    int fd = open(argv[i], O_RDONLY);
    if (fd < 0) {
      fprintf(stderr, "%s: %s\n", argv[i], strerror(errno));
      rc = 1;
      continue;
    }
    char b[1];
    if (read(fd, b, 1) < 0) {
      fprintf(stderr, "%s: %s\n", argv[i], strerror(errno));
      rc = 1;
    }
    close(fd);
  }
  return rc;
}
