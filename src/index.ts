#!/usr/bin/env node

/**
 * korean-patent-mcp
 *
 * 특허 출원번호나 등록번호를 넣으면 그 권리가 지금 살아있는지 판정해서 돌려주는 MCP 서버.
 *
 *   npx korean-patent-mcp          MCP 서버 (stdio)
 *   npx korean-patent-mcp setup    대화형 설치 — API 키 입력 + 클라이언트 자동 등록
 *   npx korean-patent-mcp probe    KIPRIS 응답 진단 — 소멸 구분 가능한지 / 갱신이 얼마나 밀리는지
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { KiprisClient } from "./lib/kipris-client.js"
import { registerTools } from "./tool-registry.js"
import { SERVER_NAME, VERSION } from "./version.js"

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args[0] === "setup") {
    const { runSetup } = await import("./setup.js")
    await runSetup()
    return
  }

  if (args[0] === "probe") {
    const { runProbe } = await import("./probe.js")
    await runProbe(args.slice(1))
    return
  }

  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write(`${VERSION}\n`)
    return
  }

  // stdio 모드: stdout은 JSON-RPC 전용이다. 어떤 로그도 stdout으로 나가면 프로토콜이 깨진다.
  const toStderr = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n")
  console.log = console.warn = console.info = console.debug = toStderr

  const client = new KiprisClient()
  if (!client.hasKey) {
    toStderr(
      "[korean-patent-mcp] KIPRIS_SERVICE_KEY 가 없습니다. 도구 호출은 키 오류를 반환합니다.\n" +
        "  발급: https://www.data.go.kr/data/15058788/openapi.do (특허실용신안 정보 검색 서비스)\n" +
        "  설정: npx korean-patent-mcp setup"
    )
  }

  const server = new Server(
    { name: SERVER_NAME, version: VERSION },
    { capabilities: { tools: {} } }
  )
  registerTools(server, client)
  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  process.stderr.write(`[korean-patent-mcp] 시작 실패: ${e instanceof Error ? e.stack : String(e)}\n`)
  process.exit(1)
})
