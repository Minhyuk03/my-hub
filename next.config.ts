import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
