/**
 * 배포될 tarball을 실제로 만들어서 열어본다.
 *
 * `files` 필드를 잘못 건드리면 build/가 통째로 빠진 패키지가 올라가고,
 * 반대로 .env 같은 걸 흘리면 키가 레지스트리에 박힌다. 둘 다 되돌릴 수 없다.
 * npm publish 전에 여기서 막는다.
 */

import { execFileSync } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"

const pkg = JSON.parse(readFileSync("package.json", "utf-8"))
const problems = []
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  problems.push(m)
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
}

console.log(`\nverify-package — ${pkg.name}@${pkg.version}\n`)

// 1) 실제로 pack 해서 파일 목록을 얻는다. --dry-run 은 디스크를 안 건드린다.
const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf-8" })
const [report] = JSON.parse(raw)
const files = report.files.map((f) => f.path)

// 2) 반드시 있어야 하는 것
const required = ["build/index.js", "README.md", "LICENSE", "package.json"]
for (const f of required) {
  if (files.includes(f)) ok(`포함: ${f}`)
  else bad(`빠짐: ${f}`)
}

// 3) bin 이 가리키는 파일이 실제로 들어 있는지
for (const [name, target] of Object.entries(pkg.bin ?? {})) {
  const rel = target.replace(/^\.\//, "")
  if (files.includes(rel)) ok(`bin "${name}" → ${rel}`)
  else bad(`bin "${name}" 이 가리키는 ${rel} 이 tarball에 없음`)
}

// 4) 절대 들어가면 안 되는 것 — 키 유출과 소스 유출
const forbidden = [
  { re: /(^|\/)\.env$/, why: "환경변수 파일(키 유출)" },
  { re: /(^|\/)\.npmrc$/, why: "npm 인증 토큰" },
  { re: /^src\//, why: "소스(빌드 산출물만 배포한다)" },
  { re: /\.test\.(ts|js)$/, why: "테스트 파일" },
  { re: /(^|\/)node_modules\//, why: "의존성 트리" },
]
for (const { re, why } of forbidden) {
  const hits = files.filter((f) => re.test(f))
  if (hits.length === 0) ok(`제외 확인: ${why}`)
  else bad(`${why} 가 포함됨: ${hits.slice(0, 5).join(", ")}`)
}

// 5) 빌드 산출물이 현재 소스 버전과 맞는지 — 빌드를 잊고 배포하는 사고를 막는다
try {
  const compiled = readFileSync("build/version.js", "utf-8")
  if (compiled.includes(`"${pkg.version}"`)) ok(`build/version.js 가 ${pkg.version} 과 일치`)
  else bad(`build/version.js 가 package.json(${pkg.version}) 과 불일치 — npm run build 를 다시 하세요`)
} catch {
  bad("build/version.js 를 읽을 수 없음 — 빌드하지 않았습니다")
}

// 6) 크기 급증 감시. 갑자기 커졌다면 뭔가 딸려 들어간 것이다.
const mb = report.unpackedSize / 1024 / 1024
if (mb < 5) ok(`전개 크기 ${mb.toFixed(2)} MB (${files.length}개 파일)`)
else bad(`전개 크기가 ${mb.toFixed(2)} MB 입니다 — 의도치 않게 딸려 들어간 파일이 없는지 확인하세요`)

rmSync(`${pkg.name}-${pkg.version}.tgz`, { force: true })

console.log()
if (problems.length > 0) {
  console.error(`\x1b[31m${problems.length}건의 문제로 배포를 막습니다.\x1b[0m\n`)
  process.exit(1)
}
console.log("\x1b[32m패키지 검증 통과.\x1b[0m\n")
