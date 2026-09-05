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

/**
 * 설정 파일을 쓰는 앱이 켜져 있는지 본다.
 *
 * Claude Desktop은 이 파일을 자기 preferences 저장소로도 쓴다.
 * 앱이 켜진 상태에서 파일을 고치면, 앱이 종료하면서 메모리 상태로 덮어써
 * 방금 추가한 mcpServers 가 조용히 사라진다. 실제로 그렇게 날아갔다.
 * 그러면 사용자는 "설치했는데 서버가 안 보인다"를 겪고 원인을 못 찾는다.
 */
async function runningClients(): Promise<string[]> {
  const { execFile } = await import("node:child_process")
  const { promisify } = await import("node:util")
  const exec = promisify(execFile)

  // macOS에서 이 감지는 두 번 틀렸다. 기록해 둔다.
  //
  //  1) pgrep -x 는 못 잡는다. Electron 앱의 프로세스명이 전체 경로로 잡혀
  //     정확매칭이 실패한다.
  //  2) 메인 프로세스(예: /Applications/Claude.app/Contents/MacOS/Claude)는
  //     pgrep -f 에도 안 보인다. macOS가 그 프로세스의 argv 읽기를 막는다.
  //     보이는 건 헬퍼 프로세스뿐이고 경로가
  //     "Claude Helper.app/Contents/MacOS/Claude Helper" 라 실행 파일명으로는 안 맞는다.
  //
  // 그래서 헬퍼까지 공통으로 갖는 번들 경로 조각으로 잡는다.
  const macBundles: ReadonlyArray<readonly [string, string]> = [
    ["Claude.app/Contents", "Claude Desktop"],
    ["Cursor.app/Contents", "Cursor"],
    ["Visual Studio Code.app/Contents", "VS Code"],
    ["Windsurf.app/Contents", "Windsurf"],
    ["Zed.app/Contents", "Zed"],
  ]
  const otherNames: ReadonlyArray<readonly [string, string]> = [
    ["claude", "Claude Desktop"],
    ["cursor", "Cursor"],
    ["code", "VS Code"],
    ["windsurf", "Windsurf"],
    ["zed", "Zed"],
  ]

  const os = platform()
  // Windows에는 pgrep이 없다. 감지 실패는 설치를 막지 않는다 — 경고를 못 낼 뿐이다.
  if (os === "win32") return []

  const targets = os === "darwin" ? macBundles : otherNames
  const flag = os === "darwin" ? "-f" : "-x"
  const found: string[] = []
  for (const [pattern, label] of targets) {
    try {
      await exec("pgrep", [flag, pattern])
      if (!found.includes(label)) found.push(label)
    } catch {
      // pgrep은 못 찾으면 exit 1 — 안 켜져 있다는 뜻이다
    }
  }
  return found
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

    // 3) 기록 — 그 전에 실행 중인 앱이 있으면 멈춘다
    const running = await runningClients()
    if (running.length > 0) {
      say(`\n  ${c.yellow}${c.bold}!${c.reset} ${running.join(", ")} 이(가) 실행 중입니다.`)
      say(`  ${c.dim}이 앱들은 설정 파일을 자기 저장소로도 씁니다. 켜진 채로 고치면${c.reset}`)
      say(`  ${c.dim}앱이 종료할 때 덮어써서 방금 추가한 서버가 조용히 사라집니다.${c.reset}`)
      say(`  ${c.dim}완전히 종료(Cmd+Q)한 뒤 계속하세요.${c.reset}\n`)
      const go = (await rl.question(`  ${c.cyan}>${c.reset} 종료했으면 Enter, 그대로 진행하려면 y: `))
        .trim()
        .toLowerCase()
      if (go !== "y") {
        const still = await runningClients()
        if (still.length > 0) {
          say(`\n  ${c.red}${c.bold}✗${c.reset} ${still.join(", ")} 이(가) 아직 실행 중입니다. 종료 후 다시 실행하세요.\n`)
          return
        }
        say(`  ${c.green}✓${c.reset} 모두 종료 확인`)
      }
    }

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
    say(`  ${c.dim}최초 실행은 npx가 패키지를 받느라 30초쯤 걸립니다.${c.reset}`)
    say(`  ${c.dim}그 사이 "연결 실패"로 보이면 클라이언트를 한 번 더 재시작하세요.${c.reset}`)
    say(`  ${c.dim}rights_alive · verify_citations · search_ip${c.reset}`)
    if (!apiKey) say(`\n  ${c.yellow}!${c.reset} 키 미설정 — 설정 파일의 env.KIPRIS_SERVICE_KEY 를 채워야 동작합니다.`)
    say(`\n  ${c.dim}응답 진단이 필요하면: npx korean-patent-mcp probe${c.reset}\n`)
  } finally {
    rl.close()
  }
}
