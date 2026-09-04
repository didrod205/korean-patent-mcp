/**
 * 대화형 설치. `npx korean-patent-mcp setup`
 *
 * API 키를 프롬프트로 받아 선택한 클라이언트 설정 파일에 서버를 등록한다.
 * 키는 설정 파일에 평문으로 들어가므로 파일 권한을 0600으로 조인다.
 */

import { createInterface } from "node:readline/promises"
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises"
import { existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { homedir, platform } from "node:os"
import { stdin, stdout } from "node:process"
import { KiprisClient } from "./lib/kipris-client.js"

const ESC = "\x1b["
const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  cyan: `${ESC}36m`,
}

interface ClientConfig {
  readonly name: string
  readonly configPath: string
  readonly format: "mcpServers" | "servers" | "context_servers"
}

function detectClients(): readonly ClientConfig[] {
  const home = homedir()
  const os = platform()
  const out: ClientConfig[] = []

  const claudeDesktop: Record<string, string> = {
    darwin: resolve(home, "Library/Application Support/Claude/claude_desktop_config.json"),
    win32: resolve(process.env["APPDATA"] ?? resolve(home, "AppData/Roaming"), "Claude/claude_desktop_config.json"),
    linux: resolve(home, ".config/Claude/claude_desktop_config.json"),
  }
  const cd = claudeDesktop[os]
  if (cd) out.push({ name: "Claude Desktop", configPath: cd, format: "mcpServers" })

  out.push({ name: "Claude Code (현재 디렉토리)", configPath: resolve(process.cwd(), ".mcp.json"), format: "mcpServers" })
  out.push({ name: "Cursor", configPath: resolve(home, ".cursor/mcp.json"), format: "mcpServers" })
  out.push({ name: "VS Code (현재 디렉토리)", configPath: resolve(process.cwd(), ".vscode/mcp.json"), format: "servers" })
  out.push({ name: "Windsurf", configPath: resolve(home, ".codeium/windsurf/mcp_config.json"), format: "mcpServers" })
  out.push({ name: "Gemini CLI", configPath: resolve(home, ".gemini/settings.json"), format: "mcpServers" })

  const zed: Record<string, string> = {
    darwin: resolve(home, ".zed/settings.json"),
    linux: resolve(home, ".config/zed/settings.json"),
    win32: resolve(home, ".zed/settings.json"),
  }
  const z = zed[os]
  if (z) out.push({ name: "Zed", configPath: z, format: "context_servers" })

  return out
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>
  } catch {
    throw new Error("기존 설정 파일이 올바른 JSON이 아닙니다. 직접 고친 뒤 다시 실행하세요.")
  }
}

async function writeJson(path: string, data: Record<string, unknown>): Promise<void> {
  const dir = dirname(path)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
  try {
    await chmod(path, 0o600)
  } catch { /* Windows 등에서 실패해도 설치를 막지 않는다 */ }
}

function entryFor(format: ClientConfig["format"], apiKey: string): Record<string, unknown> {
  const env: Record<string, string> = {}
  if (apiKey) env["KIPRIS_SERVICE_KEY"] = apiKey
  const base = { command: "npx", args: ["-y", "korean-patent-mcp@latest"], env }
  return format === "context_servers" ? { command: { path: "npx", args: base.args, env } } : base
}

/** 키가 진짜 먹는지 실제 호출로 확인한다. 설치 끝나고 나서 안 되는 것보다 낫다. */
async function verifyKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const client = new KiprisClient({ serviceKey: apiKey, cacheTtlSec: 0 })
    const { hits } = await client.search({ word: "반도체", numOfRows: 1, pageNo: 1 })
    return hits.length > 0
      ? { ok: true, message: `검색 응답 정상 (예: ${hits[0]?.inventionTitle ?? "제목 없음"})` }
      : { ok: true, message: "호출은 성공했으나 결과가 비었습니다. 키는 유효해 보입니다." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function runSetup(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout })
  const say = (s = "") => process.stdout.write(s + "\n")

  try {
    say(`\n${c.cyan}${c.bold}korean-patent-mcp${c.reset} ${c.dim}설치${c.reset}`)
    say(`${c.dim}특허가 지금 살아있는지 판정하는 MCP 서버. 도구 3개.${c.reset}\n`)

    // 1) API 키
    say(`${c.bold}[1/3] KIPRIS 서비스 키${c.reset}`)
    say(`${c.dim}  발급: https://plus.kipris.or.kr  (회원가입 > 서비스 신청)${c.reset}`)
    say(`${c.dim}  → 신청할 서비스: "특허실용신안 정보검색" (patUtiModInfoSearchSevice)${c.reset}`)
    say(`${c.dim}  공공데이터포털이 아니라 KIPRIS Plus에서 직접 신청합니다.${c.reset}`)
    say(`${c.dim}  발급받은 ServiceKey 값을 붙여넣으세요.${c.reset}`)
    say(`${c.dim}  Enter로 건너뛰면 나중에 환경변수 KIPRIS_SERVICE_KEY 로 설정할 수 있습니다.${c.reset}\n`)

    const apiKey = (await rl.question(`  ${c.cyan}>${c.reset} 서비스 키: `)).trim()

    if (apiKey) {
      say(`  ${c.dim}키 확인 중...${c.reset}`)
      const v = await verifyKey(apiKey)
      say(v.ok ? `  ${c.green}✓${c.reset} 키 정상 — ${v.message}` : `  ${c.red}✗${c.reset} 키 검증 실패 — ${v.message}`)
      if (!v.ok) {
        const go = (await rl.question(`  ${c.yellow}그래도 이 키로 설치할까요? (y/N)${c.reset} `)).trim().toLowerCase()
        if (go !== "y") {
          say(`\n  중단했습니다. 승인 상태를 확인하고 다시 실행하세요.\n`)
          return
        }
      }
    } else {
      say(`  ${c.yellow}-${c.reset} 건너뜀`)
    }

    // 2) 클라이언트 선택
    say(`\n${c.bold}[2/3] MCP 클라이언트 선택${c.reset}\n`)
    const clients = detectClients()
    clients.forEach((cl, i) => {
      const badge = existsSync(cl.configPath) ? ` ${c.green}[감지됨]${c.reset}` : ""
      say(`  ${c.cyan}${String(i + 1).padStart(2)}${c.reset}) ${cl.name}${badge}`)
    })
    say()
    const raw = (await rl.question(`  ${c.cyan}>${c.reset} 번호 (예: 1,2): `)).trim()

    const indices = raw
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10) - 1)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < clients.length)

    if (indices.length === 0) {
      say(`\n  ${c.yellow}선택 없음${c.reset} — 아래 JSON을 설정 파일의 mcpServers에 직접 추가하세요:\n`)
      say(`  ${c.cyan}"korean-patent"${c.reset}: ${JSON.stringify(entryFor("mcpServers", apiKey), null, 4)}\n`)
      return
    }

    // 3) 기록
    say(`\n${c.bold}[3/3] 설정 파일 업데이트${c.reset}\n`)
    for (const idx of indices) {
      const cl = clients[idx]
      if (!cl) continue
      try {
        const config = await readJson(cl.configPath)
        const servers = (config[cl.format] ?? {}) as Record<string, unknown>
        servers["korean-patent"] = entryFor(cl.format, apiKey)
        config[cl.format] = servers
        await writeJson(cl.configPath, config)
        say(`  ${c.green}✓${c.reset} ${cl.name} ${c.dim}${cl.configPath}${c.reset}`)
      } catch (e) {
        say(`  ${c.red}✗${c.reset} ${cl.name} ${c.dim}${e instanceof Error ? e.message : String(e)}${c.reset}`)
      }
    }

    say(`\n  ${c.green}${c.bold}설치 완료.${c.reset} 클라이언트를 재시작하면 도구 3개가 붙습니다.`)
    say(`  ${c.dim}rights_alive · verify_citations · search_ip${c.reset}`)
    if (!apiKey) say(`\n  ${c.yellow}!${c.reset} 키 미설정 — 설정 파일의 env.KIPRIS_SERVICE_KEY 를 채워야 동작합니다.`)
    say(`\n  ${c.dim}응답 진단이 필요하면: npx korean-patent-mcp probe${c.reset}\n`)
  } finally {
    rl.close()
  }
}
