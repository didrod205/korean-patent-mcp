/**
 * .env 로더 (의존성 없음).
 *
 * .env.example을 만들어 두고 정작 .env를 안 읽으면, 사용자는 파일에 키를 넣고
 * "왜 안 되지"를 한참 한다. 그 구멍을 막는다.
 *
 * 탐색 순서 — 먼저 찾은 쪽이 이긴다:
 *   1. 이미 설정된 실제 환경변수 (항상 최우선. 파일이 덮어쓰지 않는다)
 *   2. ./.env                              (프로젝트에서 직접 실행할 때)
 *   3. ~/.config/korean-patent-mcp/.env    (MCP 클라이언트가 띄울 때)
 *
 * 3번이 필요한 이유: MCP 클라이언트는 서버를 임의의 작업 디렉토리에서 띄운다.
 * cwd 기준 .env만 보면 Claude Desktop에서 실행될 때 못 찾는다.
 */

import { readFileSync, existsSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { homedir } from "node:os"

/** 사용자 홈의 설정 파일 경로. setup·문서에서 같은 값을 써야 하므로 export한다. */
export function userEnvPath(): string {
  return resolve(homedir(), ".config/korean-patent-mcp/.env")
}

function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    let value = line.slice(eq + 1).trim()
    // 따옴표로 감싼 값 허용 — 키에 특수문자가 있을 때 셸 습관대로 감싸는 사람이 많다
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * .env 파일들을 읽어 process.env에 채운다. 이미 있는 값은 건드리지 않는다.
 * @returns 실제로 읽은 파일 경로들
 */
export function loadEnvFiles(): string[] {
  const candidates = [resolve(process.cwd(), ".env"), userEnvPath()]
  const loaded: string[] = []

  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      if (!statSync(path).isFile()) continue
      const vars = parse(readFileSync(path, "utf-8"))
      let used = false
      for (const [k, v] of Object.entries(vars)) {
        // 실제 환경변수가 이긴다 — 일회성 오버라이드를 파일이 막으면 디버깅이 지옥이 된다
        if (process.env[k] === undefined && v !== "") {
          process.env[k] = v
          used = true
        }
      }
      if (used) loaded.push(path)
    } catch {
      // 읽기 실패는 치명적이지 않다. 환경변수로 넣었을 수도 있으므로 계속 간다.
    }
  }

  return loaded
}
