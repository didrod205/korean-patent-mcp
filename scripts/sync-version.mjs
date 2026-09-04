/**
 * package.json 버전을 src/version.ts에 반영한다.
 *
 * npm version 의 `version` 라이프사이클에서 돌며, 결과를 스테이징까지 한다.
 * 그래서 버전 번호가 한 군데에서만 바뀐다.
 *
 * 이게 없던 동안 실제로 세 번 어긋났다. verify:package 가 그걸 잡아주긴 하지만,
 * 잡는 것보다 애초에 안 생기게 하는 편이 낫다.
 */

import { readFileSync, writeFileSync } from "node:fs"

const { version } = JSON.parse(readFileSync("package.json", "utf-8"))
const path = "src/version.ts"
const before = readFileSync(path, "utf-8")
const after = before.replace(/export const VERSION = "[^"]*"/, `export const VERSION = "${version}"`)

if (before === after && !after.includes(`"${version}"`)) {
  console.error(`sync-version: ${path} 의 VERSION 선언을 찾지 못했습니다.`)
  process.exit(1)
}

writeFileSync(path, after)
console.log(`sync-version: ${path} → ${version}`)
