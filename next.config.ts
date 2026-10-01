import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 네이티브 확장(.dylib)을 불러오므로 번들하지 않는다
  serverExternalPackages: ["sqlite-vec", "better-sqlite3"],
  experimental: {
    serverActions: {
      // 홈 배경 이미지(15MB)·북마크 파일 업로드
      bodySizeLimit: "21mb",
      // tailscale serve 로 들어온 요청의 Origin
      allowedOrigins: ["mh-macmini-1.taile87d89.ts.net"],
    },
  },
};

export default nextConfig;
