"use client";

import { useState } from "react";

/** 표지·사진: 불러오지 못하면(클라우드 연결 만료 등) 깨진 그림 대신 회색 칸 */
/** position: 칸에 맞춰 자를 때 남길 부분 (CSS object-position, 예 "50% 20%") */
export function CoverImage({ src, alt = "", className = "", position }: { src: string; alt?: string; className?: string; position?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className={`bg-muted ${className}`} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 허브 파일·외부 주소라 next/image 최적화를 쓰지 않는다
    <img
      src={src}
      alt={alt}
      className={`object-cover ${className}`}
      style={position ? { objectPosition: position } : undefined}
      onError={() => setFailed(true)}
      // 화면이 준비되기 전에 이미 실패한 그림은 onError 가 오지 않으므로 붙을 때 한 번 확인
      ref={(el) => {
        if (el?.complete && el.naturalWidth === 0) setFailed(true);
      }}
    />
  );
}
