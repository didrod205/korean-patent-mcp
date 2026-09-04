/**
 * 오류를 MCP 도구 응답으로 바꾸는 자리.
 *
 * 원칙: 실패했으면 실패했다고 말한다. 빈 결과를 "해당 없음"으로 위장하지 않는다.
 * 이 서버는 "권리가 살아있는지"를 답하는데, API 실패를 조용히 삼키면
 * 죽은 권리를 살아있다고 하는 것과 같은 종류의 사고가 난다.
 */

export class KiprisError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    readonly cause_?: unknown
  ) {
    super(message)
    this.name = "KiprisError"
  }
}

export class MissingKeyError extends KiprisError {
  constructor() {
    super(
      "KIPRIS 서비스 키가 설정되지 않았습니다.",
      [
        "1) https://plus.kipris.or.kr 회원가입 후 \"특허실용신안 정보검색\" 서비스 신청",
        "   (공공데이터포털이 아니라 KIPRIS Plus에서 직접 신청합니다)",
        "2) 발급된 ServiceKey 복사",
        "3) 아래 중 하나로 설정:",
        "   - npx korean-patent-mcp setup   (MCP 클라이언트 설정에 기록)",
        "   - ~/.config/korean-patent-mcp/.env 에 KIPRIS_SERVICE_KEY=... 한 줄",
        "   - 환경변수 export KIPRIS_SERVICE_KEY=...",
      ].join("\n")
    )
    this.name = "MissingKeyError"
  }
}

export interface ToolError {
  error: string
  hint?: string
  checked_at: string
}

export function toToolError(e: unknown): ToolError {
  const checked_at = new Date().toISOString().slice(0, 10)
  if (e instanceof KiprisError) {
    return { error: e.message, ...(e.hint ? { hint: e.hint } : {}), checked_at }
  }
  if (e instanceof Error) return { error: e.message, checked_at }
  return { error: String(e), checked_at }
}
