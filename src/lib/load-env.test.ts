import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { loadEnvFiles, userEnvPath } from "./load-env.js"

const KEY = "KIPRIS_TEST_ONLY_KEY"

describe("loadEnvFiles", () => {
  let dir: string
  let cwd: string

  beforeEach(() => {
    cwd = process.cwd()
    dir = mkdtempSync(resolve(tmpdir(), "kpm-env-"))
    process.chdir(dir)
    delete process.env[KEY]
  })

  afterEach(() => {
    process.chdir(cwd)
    rmSync(dir, { recursive: true, force: true })
    delete process.env[KEY]
  })

  it("cwd의 .env를 읽는다", () => {
    writeFileSync(".env", `${KEY}=abc123\n`)
    loadEnvFiles()
    expect(process.env[KEY]).toBe("abc123")
  })

  it("주석과 빈 줄을 건너뛴다", () => {
    writeFileSync(".env", `# 주석\n\n${KEY}=v1\n`)
    loadEnvFiles()
    expect(process.env[KEY]).toBe("v1")
  })

  it("따옴표로 감싼 값을 벗긴다", () => {
    writeFileSync(".env", `${KEY}="quoted+value/=="\n`)
    loadEnvFiles()
    expect(process.env[KEY]).toBe("quoted+value/==")
  })

  it("값에 = 가 들어 있어도 자르지 않는다 (base64 키가 흔하다)", () => {
    writeFileSync(".env", `${KEY}=aGVsbG8=\n`)
    loadEnvFiles()
    expect(process.env[KEY]).toBe("aGVsbG8=")
  })

  it("이미 설정된 환경변수를 파일이 덮어쓰지 않는다", () => {
    process.env[KEY] = "from-shell"
    writeFileSync(".env", `${KEY}=from-file\n`)
    loadEnvFiles()
    expect(process.env[KEY]).toBe("from-shell")
  })

  it("빈 값은 무시한다 — .env.example을 그대로 복사해 둔 경우", () => {
    writeFileSync(".env", `${KEY}=\n`)
    loadEnvFiles()
    expect(process.env[KEY]).toBeUndefined()
  })

  it("파일이 없어도 던지지 않는다", () => {
    expect(() => loadEnvFiles()).not.toThrow()
  })

  it("읽은 파일 경로를 돌려준다", () => {
    writeFileSync(".env", `${KEY}=x\n`)
    // macOS에서 /var 는 /private/var 심볼릭 링크라 mkdtemp 경로와 cwd가 다르다.
    // 로더는 cwd 기준으로 해석하므로 비교도 cwd 기준으로 한다.
    expect(loadEnvFiles()).toContain(resolve(process.cwd(), ".env"))
  })
})

describe("userEnvPath", () => {
  it("홈 아래 고정 경로를 가리킨다", () => {
    expect(userEnvPath()).toMatch(/\.config\/korean-patent-mcp\/\.env$/)
  })
})
