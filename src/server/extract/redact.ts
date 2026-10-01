/**
 * 대화 기록 등에 섞여 있을 수 있는 비밀 값(API 키·토큰·비밀번호·개인 키)을 색인 전에 가린다.
 * 검색·미리보기·AI 로 원문 비밀이 퍼지지 않게 한다. (완벽하지 않으므로 대화 기록 소스는 외부 AI 전송도 기본 금지)
 */
const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, // Anthropic·OpenAI
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\b(?:ntn|secret)_[A-Za-z0-9]{30,}/g, // Notion
  /\bfigd_[A-Za-z0-9_-]{20,}/g, // Figma
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\bya29\.[0-9A-Za-z_-]{20,}/g, // Google access token
  /\bGOCSPX-[0-9A-Za-z_-]{20,}/g, // Google OAuth client secret
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\b(Bearer)\s+[A-Za-z0-9._~+/-]{20,}=*/g,
];
/** KEY=값, "password": "값" 같은 줄 */
const ASSIGN = /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)(\s*[:=]\s*)(["']?)[^\s"']{6,}\3/gi;

export function redactSecrets(text: string): string {
  let s = text;
  for (const re of PATTERNS) s = s.replace(re, (m, g1) => (g1 === "Bearer" ? "Bearer [가림]" : "[가림]"));
  s = s.replace(ASSIGN, (_m, k, sep) => `${k}${sep}[가림]`);
  return s;
}
