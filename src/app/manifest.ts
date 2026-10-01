import type { MetadataRoute } from "next";

/** 아이폰 "홈 화면에 추가" 용 앱 정보 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "나의 허브",
    short_name: "허브",
    description: "흩어진 작업물을 한곳에서 찾는 개인 허브",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    lang: "ko",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
