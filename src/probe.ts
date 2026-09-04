/**
 * probe — 기획 폐기 여부를 결정하는 진단 명령.
 *
 * 이 프로젝트 전체는 딱 두 가지 전제 위에 서 있다:
 *   확인1. 소멸·포기된 권리가 KIPRIS 응답에서 명확히 구분되는가
 *   확인2. 상태 갱신이 며칠이나 지연되는가
 *
 * 하나라도 무너지면 코드가 아무리 좋아도 이 서버는 거짓말을 하게 된다.
 * 그래서 이걸 사람 눈이 아니라 명령 하나로 판정한다.
 *
 *   npx korean-patent-mcp probe                       샘플을 스스로 찾아서 진단
 *   npx korean-patent-mcp probe 10-2019-0123456 ...   지정한 번호로 진단
 *   npx korean-patent-mcp probe --raw 10-2019-0123456 응답 XML 원문까지 출력
 */

import { KiprisClient, type BiblioRecord } from "./lib/kipris-client.js"
import { parseNumber } from "./lib/number.js"
import { judge } from "./lib/status.js"

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

const say = (s = "") => process.stdout.write(s + "\n")
const head = (s: string) => say(`\n${c.cyan}${c.bold}${s}${c.reset}\n${c.dim}${"─".repeat(64)}${c.reset}`)
const pass = (s: string) => say(`  ${c.green}${c.bold}PASS${c.reset}  ${s}`)
const warn = (s: string) => say(`  ${c.yellow}${c.bold}WARN${c.reset}  ${s}`)
const failx = (s: string) => say(`  ${c.red}${c.bold}FAIL${c.reset}  ${s}`)
const info = (s: string) => say(`  ${c.dim}·${c.reset} ${s}`)

/** 응답에 실제로 들어 있는 태그 이름을 전부 뽑는다. 문서보다 응답이 진실이다. */
function tagInventory(xml: string): string[] {
  const names = new Set<string>()
  const re = /<([A-Za-z][A-Za-z0-9_]*)(?:\s[^>]*)?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) names.add(m[1])
  }
  return [...names].sort()
}

/** 상태 판정에 실제로 쓰이는 필드가 응답에 있는지. */
const CRITICAL_FIELDS = [
  "registerStatus",
  "finalDisposal",
  "applicationDate",
  "registerDate",
  "inventionTitle",
  "registerNumber",
] as const

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

/** 상태값이 골고루 나오게 검색어를 흩뿌린다 — 오래된 기술일수록 소멸 건이 많다. */
const SAMPLE_QUERIES = ["카세트 테이프", "휴대폰 폴더", "브라운관", "무선 충전", "이차전지"]

export async function runProbe(argv: string[]): Promise<void> {
  const showRaw = argv.includes("--raw")
  const numbers = argv.filter((a) => !a.startsWith("--"))

  say(`\n${c.bold}korean-patent-mcp probe${c.reset} ${c.dim}— KIPRIS 응답 진단${c.reset}`)

  const client = new KiprisClient()

  head("0. 키 확인")
  if (!client.hasKey) {
    failx("KIPRIS_SERVICE_KEY 가 설정되지 않았습니다.")
    info("발급: https://www.data.go.kr/data/15058788/openapi.do")
    info('공공데이터포털 > "지식재산처_특허실용신안 정보 검색 서비스" > 활용신청 (무료, 개발계정 자동승인)')
    info("설정: export KIPRIS_SERVICE_KEY='...'  또는  npx korean-patent-mcp setup")
    process.exitCode = 1
    return
  }
  pass("서비스 키 있음")

  // ---------------------------------------------------------------------
  // 샘플 수집
  // ---------------------------------------------------------------------
  head("1. 샘플 수집")
  const records: Array<{ label: string; rec: BiblioRecord; ip: "patent" | "utility" }> = []
  const statusValues = new Map<string, number>()

  if (numbers.length > 0) {
    for (const raw of numbers) {
      try {
        const n = parseNumber(raw)
        const rec = await client.resolve(n)
        if (!rec) {
          warn(`${n.pretty} — KIPRIS에 없음`)
          continue
        }
        records.push({ label: n.pretty, rec, ip: n.ip })
        info(`${n.pretty} — ${rec.inventionTitle ?? "(명칭 없음)"}`)
      } catch (e) {
        warn(`${raw} — ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  } else {
    info("번호 인자가 없어 검색으로 샘플을 모읍니다(상태값이 흩어지도록 오래된 기술 위주).")
    for (const q of SAMPLE_QUERIES) {
      try {
        const { hits } = await client.search({ word: q, numOfRows: 10, pageNo: 1 })
        for (const h of hits) {
          if (h.registerStatus) {
            statusValues.set(h.registerStatus, (statusValues.get(h.registerStatus) ?? 0) + 1)
          }
        }
        info(`"${q}" → ${hits.length}건`)
      } catch (e) {
        warn(`"${q}" 검색 실패: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    // 상태값별로 대표 1건씩만 서지상세를 열어본다 (호출량 절약)
    const seen = new Set<string>()
    for (const q of SAMPLE_QUERIES.slice(0, 2)) {
      const { hits } = await client.search({ word: q, numOfRows: 10, pageNo: 1 })
      for (const h of hits) {
        const key = h.registerStatus ?? "?"
        if (seen.has(key) || !h.applicationNumber) continue
        seen.add(key)
        try {
          const n = parseNumber(h.applicationNumber)
          const rec = await client.resolve(n)
          if (rec) records.push({ label: n.pretty, rec, ip: n.ip })
        } catch { /* 샘플 하나 실패는 진단을 막지 않는다 */ }
        if (seen.size >= 5) break
      }
      if (seen.size >= 5) break
    }
  }

  if (records.length === 0 && statusValues.size === 0) {
    failx("샘플을 하나도 못 모았습니다. 키 승인 상태와 네트워크를 확인하세요.")
    process.exitCode = 1
    return
  }

  // ---------------------------------------------------------------------
  // 필드 존재 확인
  // ---------------------------------------------------------------------
  head("2. 응답 필드 확인")
  const firstRaw = records[0]?.rec.rawXml
  if (firstRaw) {
    const inventory = tagInventory(firstRaw)
    info(`응답 태그 ${inventory.length}종`)
    for (const f of CRITICAL_FIELDS) {
      if (inventory.includes(f)) pass(`${f} 존재`)
      else failx(`${f} 없음 — 판정 로직이 이 필드에 의존합니다`)
    }
    const hasLegal = inventory.includes("legalStatusInfo")
    if (hasLegal) pass("legalStatusInfo 존재 — 법적상태 이력으로 갱신 지연을 잴 수 있습니다")
    else warn("legalStatusInfo 없음 — 갱신 지연은 등록일 기준 간접 추정만 가능합니다")

    if (showRaw) {
      head("2-1. 응답 XML 원문")
      say(firstRaw.slice(0, 8000))
      if (firstRaw.length > 8000) info(`... (${firstRaw.length - 8000}자 생략)`)
    }
  } else {
    warn("서지상세 원문을 확보하지 못해 필드 확인을 건너뜁니다.")
  }

  // ---------------------------------------------------------------------
  // 확인 1: 소멸 구분 가능한가
  // ---------------------------------------------------------------------
  head("3. 확인포인트 1 — 소멸·포기가 응답에서 구분되는가")

  for (const { rec } of records) {
    if (rec.registerStatus) {
      statusValues.set(rec.registerStatus, (statusValues.get(rec.registerStatus) ?? 0) + 1)
    }
  }

  if (statusValues.size === 0) {
    failx("상태 문자열을 하나도 받지 못했습니다.")
  } else {
    say(`  ${c.dim}관측된 상태값:${c.reset}`)
    for (const [v, n] of [...statusValues].sort((a, b) => b[1] - a[1])) {
      const verdict = judge({ statusText: v, ip: "patent" })
      const mark = verdict.alive ? `${c.green}살아있음${c.reset}` : `${c.dim}죽음/미발생${c.reset}`
      const cls = verdict.stage === "불명" ? `${c.red}미분류${c.reset}` : verdict.stage
      say(`     ${String(n).padStart(3)}건  "${v}"  →  ${cls} / ${mark}`)
    }
  }

  const distinct = [...statusValues.keys()]
  const hasDeadSignal = distinct.some((v) => /소멸|포기|취하|거절|무효|말소|실효/.test(v))
  const hasAliveSignal = distinct.some((v) => /등록/.test(v))
  const unclassified = distinct.filter((v) => judge({ statusText: v, ip: "patent" }).stage === "불명")

  say()
  if (hasDeadSignal && hasAliveSignal) {
    pass("소멸·포기 계열과 등록 계열이 서로 다른 값으로 구분됩니다. 확인포인트 1 통과.")
  } else if (hasAliveSignal && !hasDeadSignal) {
    warn(
      "이번 표본에 소멸·포기 건이 안 잡혔습니다. 구분 불가라는 뜻은 아닙니다 — " +
        "소멸한 걸 아는 번호를 인자로 직접 넣어 다시 돌리세요:  probe 10-XXXXXXX"
    )
  } else {
    failx("등록/소멸이 구분되는 상태값을 확인하지 못했습니다. 확인포인트 1 실패.")
  }
  if (unclassified.length > 0) {
    warn(`판정 규칙이 모르는 상태값: ${unclassified.map((v) => `"${v}"`).join(", ")} → src/lib/status.ts 에 추가 필요`)
  }

  // ---------------------------------------------------------------------
  // 확인 2: 갱신 지연
  // ---------------------------------------------------------------------
  head("4. 확인포인트 2 — 상태 갱신이 며칠 지연되는가")

  const today = new Date().toISOString().slice(0, 10)
  const lags: number[] = []

  for (const { label, rec } of records) {
    const latest = rec.legalEvents[0]
    if (latest?.date) {
      const lag = daysBetween(latest.date, today)
      lags.push(lag)
      info(`${label}  최신 법적상태 ${latest.date} (${lag}일 전) — ${latest.description ?? "?"}`)
    } else if (rec.registerDate) {
      info(`${label}  법적상태 이력 없음. 등록일 ${rec.registerDate} 만 확인됨.`)
    }
  }

  say()
  if (lags.length === 0) {
    warn(
      "법적상태 이력을 못 얻어 지연을 직접 재지 못했습니다.\n" +
        "        직접 재는 법: 최근에 상태가 바뀐 걸 아는 번호(연차료 불납 소멸 등)를 인자로 넣고\n" +
        "        probe를 돌려 latest_event 날짜와 실제 변동일을 비교하세요."
    )
  } else {
    const min = Math.min(...lags)
    const med = [...lags].sort((a, b) => a - b)[Math.floor(lags.length / 2)] ?? 0
    info(`표본 ${lags.length}건 — 최신 이벤트가 가장 가까운 건이 ${min}일 전, 중앙값 ${med}일 전`)
    say(
      `  ${c.dim}주의: 이 숫자는 "그 건에 마지막 사건이 일어난 시점"이지 "KIPRIS가 늦게 반영한 정도"가 아닙니다.\n` +
        `        진짜 지연은 상태가 바뀐 걸 아는 번호로 재야 정확합니다.${c.reset}`
    )
    if (min <= 14) {
      pass(`최근 14일 이내 반영된 건이 있습니다 — 갱신이 몇 달씩 밀리지는 않습니다.`)
    } else if (min <= 60) {
      warn(`가장 가까운 이벤트도 ${min}일 전입니다. 표본을 늘려 다시 확인하세요.`)
    } else {
      failx(`표본 전체에서 최근 60일 내 이벤트가 없습니다. 갱신 지연 의심 — 확인포인트 2 재검증 필요.`)
    }
  }

  // ---------------------------------------------------------------------
  // 결론
  // ---------------------------------------------------------------------
  head("결론")
  const ok1 = hasDeadSignal && hasAliveSignal
  const ok2 = lags.length > 0 && Math.min(...lags) <= 60

  if (ok1 && ok2) {
    say(`  ${c.green}${c.bold}이 기획은 성립합니다.${c.reset} 소멸이 구분되고 갱신도 살아 있습니다. 나머지는 코드 문제입니다.`)
  } else if (!ok1) {
    say(`  ${c.red}${c.bold}확인포인트 1 미통과.${c.reset} 소멸 여부가 응답에서 안 갈리면 이 서버는 거짓말을 합니다.`)
    say(`  ${c.dim}소멸된 걸 확실히 아는 번호로 한 번 더 돌려보고, 그래도 안 갈리면 기획을 접으세요.${c.reset}`)
  } else {
    say(`  ${c.yellow}${c.bold}확인포인트 2 판단 보류.${c.reset} 상태가 최근 바뀐 번호를 인자로 넣어 다시 재세요.`)
  }
  say(`\n  ${c.dim}KIPRIS 상류 호출 ${client.callCount}회 사용${c.reset}\n`)
}
