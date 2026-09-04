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
        "1) https://www.data.go.kr/data/15058125/openapi.do 에서 활용신청 (무료, 승인 대기 있음)",
        '2) 승인 후 "일반 인증키(Decoding)" 값을 복사',
        "3) 환경변수 KIPRIS_SERVICE_KEY 에 설정하거나 `npx korean-patent-mcp setup` 실행",
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
