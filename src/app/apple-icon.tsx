import { ImageResponse } from "next/og";
import { HubIcon } from "./hub-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** 아이폰 홈 화면 아이콘 (iOS 가 모서리를 둥글린다) */
export default function AppleIcon() {
  return new ImageResponse(<HubIcon size={180} rounded={false} />, size);
}
