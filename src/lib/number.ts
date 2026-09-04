/**
 * 한국 특허·실용신안 번호 파싱/정규화.
 *
 * 이 모듈이 하는 일은 하나다: 사람이 쓴 번호 문자열을 KIPRIS API가 받는
 * 숫자열로 바꾸고, 그게 출원번호인지 등록번호인지 공개번호인지 판별한다.
 *
 * 번호 체계 (특허법 시행규칙 / KIPRIS 표기):
 *   출원번호  10-2019-0123456  → 1020190123456 (13자리: 권리구분2 + 연도4 + 일련7)
 *   공개번호  10-2020-0098765  → 1020200098765 (13자리, 출원번호와 형태 동일)
 *   등록번호  10-1234567       → 101234567     (9자리: 권리구분2 + 일련7)
 *
 * 권리구분: 10=특허, 20=실용신안, 30=디자인, 40=상표.
 * 이 서버는 특허·실용신안만 다룬다. 30·40은 명시적으로 거절한다 —
 * 조용히 처리했다가 상표를 특허 규칙으로 판정하면 그게 제일 나쁜 오답이다.
 */

export type IpKind = "patent" | "utility"
export type NumberKind = "application" | "registration"

export interface ParsedNumber {
  /** 사용자가 넣은 원문 */
  raw: string
  /** 숫자만 남긴 정규화 형태 — API에 이걸 보낸다 */
  normalized: string
  /** 사람이 읽는 형태 10-2019-0123456 */
  pretty: string
  kind: NumberKind
  ip: IpKind
  /** 출원번호일 때만 채워짐 */
  year?: number
}

export class NumberParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NumberParseError"
  }
}

const IP_BY_PREFIX: Record<string, IpKind> = {
  "10": "patent",
  "20": "utility",
}

const REJECTED_PREFIX: Record<string, string> = {
  "30": "디자인",
  "40": "상표",
  "41": "상표(서비스표)",
}

/** 출원 연도로 허용할 범위. 특허법 시행 이후 ~ 근미래. */
const MIN_YEAR = 1948
const MAX_YEAR = new Date().getUTCFullYear() + 1

/** 숫자만 남긴다. 하이픈·공백·전각숫자 모두 흡수. */
export function digitsOnly(input: string): string {
  return input
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, "")
}

/**
 * 번호 문자열을 파싱한다.
 *
 * @param input 사용자 입력. "10-2019-0123456", "1020190123456", "특허 제10-1234567호" 모두 허용.
 * @param hint  형태만으로 갈리지 않을 때 쓰는 힌트. 원문에 "등록"이 있으면 registration 쪽으로 기운다.
 */
export function parseNumber(input: string, hint?: NumberKind): ParsedNumber {
  const raw = input.trim()
  if (!raw) throw new NumberParseError("번호가 비어 있습니다.")

  const d = digitsOnly(raw)
  if (d.length === 0) {
    throw new NumberParseError(`숫자가 없습니다: "${raw}"`)
  }

  const prefix = d.slice(0, 2)
  const rejected = REJECTED_PREFIX[prefix]
  if (rejected) {
    throw new NumberParseError(
      `${rejected} 번호입니다(${prefix}-). 이 서버는 특허(10-)·실용신안(20-)만 판정합니다.`
    )
  }

  const ip = IP_BY_PREFIX[prefix]
  if (!ip) {
    throw new NumberParseError(
      `권리구분을 알 수 없습니다(앞 두 자리 "${prefix}"). 특허는 10-, 실용신안은 20-으로 시작합니다.`
    )
  }

  // 원문에 "등록"이 박혀 있으면 등록번호로 읽는다 — 13자리 등록번호(부기번호 포함)를
  // 출원번호로 오독하는 걸 막는 유일한 단서다.
  const textSaysRegistration = /등록|登錄|registration/i.test(raw)
  const effectiveHint = hint ?? (textSaysRegistration ? "registration" : undefined)

  // 하이픈 구획이 있으면 그게 형태를 확정한다. 숫자만 남기면 이 정보가 사라지고,
  // "10-2019-0000000"(있을 수 없는 출원번호)이 "10-2019000"(실재하는 등록번호)로
  // 조용히 둔갑한다. 없는 특허를 실재하는 다른 특허로 바꿔 통과시키는 건
  // 이 서버가 막으려는 바로 그 사고다.
  const hyphenated = raw.replace(/[\u2010-\u2015\uFF0D]/g, "-")

  // NN-YYYY-NNNNNNN — 출원/공개번호 표기
  const appForm = hyphenated.match(/([12]0)\s*-\s*(\d{4})\s*-\s*(\d{6,7})(?!\d)/)
  if (appForm) {
    const year = Number(appForm[2])
    const serial = (appForm[3] ?? "").padStart(7, "0")
    if (year < MIN_YEAR || year > MAX_YEAR) {
      throw new NumberParseError(
        `출원연도 ${year}가 범위를 벗어납니다(${MIN_YEAR}~${MAX_YEAR}). 번호를 확인하세요.`
      )
    }
    if (/^0+$/.test(serial)) {
      throw new NumberParseError(
        `존재할 수 없는 출원번호입니다: ${appForm[1]}-${appForm[2]}-${serial}. ` +
          `일련번호가 전부 0입니다. 지어낸 번호일 가능성이 큽니다.`
      )
    }
    const expanded = `${appForm[1]}${appForm[2]}${serial}`
    return {
      raw,
      normalized: expanded,
      pretty: `${appForm[1]}-${appForm[2]}-${serial}`,
      kind: "application",
      ip,
      year,
    }
  }

  // 13자리: 출원/공개번호와 "등록번호+부기번호"가 같은 자릿수라 형태로 갈라야 한다.
  //
  // 구분 신호 두 개:
  //   (1) 중간 4자리가 연도로 읽히는가
  //   (2) 뒤 7자리(일련번호)가 0으로 시작하는가
  //       — 출원번호의 연간 일련번호는 100만 건을 넘은 적이 없어 항상 0으로 시작한다.
  //         등록번호+부기(예: 1023456780000)는 이 조건에서 걸러진다.
  //
  // 텍스트의 "등록" 힌트는 (1)(2)가 모두 출원번호를 가리키면 무시한다.
  // "등록특허 10-2025-0001111"처럼 출원번호를 등록특허라 부르는 표기가 흔하고,
  // 거기서 힌트를 따르면 멀쩡한 번호를 조회 불가로 만든다.
  if (d.length === 13) {
    const year = Number(d.slice(2, 6))
    const serial = d.slice(6)
    const yearLooksReal = year >= MIN_YEAR && year <= MAX_YEAR
    const looksLikeApplication = yearLooksReal && serial.startsWith("0") && serial !== "0000000"
    const looksLikeRegistration = d.slice(9) === "0000"
    const hintWins = effectiveHint === "registration" && looksLikeRegistration

    if (looksLikeApplication && !hintWins) {
      return {
        raw,
        normalized: d,
        pretty: `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`,
        kind: "application",
        ip,
        year,
      }
    }
    // 등록번호 + 부기번호 4자리 (1012345670000)
    const base = d.slice(0, 9)
    return {
      raw,
      normalized: base,
      pretty: `${base.slice(0, 2)}-${base.slice(2)}`,
      kind: "registration",
      ip,
    }
  }

  // 9자리: 등록번호
  if (d.length === 9) {
    return {
      raw,
      normalized: d,
      pretty: `${d.slice(0, 2)}-${d.slice(2)}`,
      kind: "registration",
      ip,
    }
  }

  // 11자리: 1999년 이전 구형 출원번호 (10-98-0012345 형태를 두 자리 연도로 쓴 것)
  if (d.length === 11) {
    const yy = Number(d.slice(2, 4))
    const year = yy >= 48 ? 1900 + yy : 2000 + yy
    const expanded = `${d.slice(0, 2)}${year}${d.slice(4).padStart(7, "0")}`
    return {
      raw,
      normalized: expanded,
      pretty: `${expanded.slice(0, 2)}-${expanded.slice(2, 6)}-${expanded.slice(6)}`,
      kind: "application",
      ip,
      year,
    }
  }

  throw new NumberParseError(
    `번호 자릿수가 맞지 않습니다(${d.length}자리). ` +
      `출원번호는 13자리(10-2019-0123456), 등록번호는 9자리(10-1234567)입니다.`
  )
}

/** 던지지 않는 버전 — verify_citations처럼 대량 추출 후 거르는 자리에서 쓴다. */
export function tryParseNumber(input: string, hint?: NumberKind): ParsedNumber | null {
  try {
    return parseNumber(input, hint)
  } catch {
    return null
  }
}

/**
 * 자유 텍스트에서 특허·실용신안 번호를 모두 뽑는다. verify_citations의 1단계.
 *
 * 잡아야 하는 표기:
 *   10-2019-0123456 / 10‑2019‑0123456(유니코드 하이픈) / 1020190123456
 *   특허 제10-1234567호 / 등록번호 10-1234567 / KR 10-2019-0123456
 * 잡으면 안 되는 것:
 *   전화번호, 사업자번호, 날짜, 30-/40-으로 시작하는 디자인·상표 번호
 */
/**
 * 텍스트에서 뽑아낸 번호.
 *
 * 파싱에 실패한 것도 버리지 않고 valid:false로 담는다. 특허번호 모양인데
 * 형태가 성립하지 않는 문자열은 그 자체가 창작의 증거이며, 검증 결과에서
 * 조용히 빠지면 "검사했는데 문제없음"으로 읽힌다 — 가장 나쁜 오답이다.
 */
export type ExtractedNumber =
  | ({ index: number; match: string; valid: true } & ParsedNumber)
  | { index: number; match: string; valid: false; pretty: string; reason: string }

// 하이픈류: ASCII -, 유니코드 ‐‑‒–—, 전각 －
const H = "[-\\u2010\\u2011\\u2012\\u2013\\u2014\\uFF0D]"

const NUMBER_PATTERNS: readonly RegExp[] = [
  // 10-2019-0123456 (하이픈 있는 출원/공개번호)
  new RegExp(`\\b([12]0)\\s*${H}\\s*(\\d{4})\\s*${H}\\s*(\\d{6,7})\\b`, "g"),
  // 10-1234567 (하이픈 있는 등록번호). 앞에 다른 하이픈 그룹이 붙은 건 위 패턴이 먼저 먹는다.
  new RegExp(`\\b([12]0)\\s*${H}\\s*(\\d{7})\\b(?!\\s*${H}\\s*\\d)`, "g"),
  // 1020190123456 (구분자 없는 13자리)
  /\b([12]0\d{11})\b/g,
]

export function extractNumbers(text: string, max = 50): ExtractedNumber[] {
  const found: ExtractedNumber[] = []
  const seen = new Set<string>()
  // 앞선(더 구체적인) 패턴이 먹은 구간은 뒤 패턴이 다시 먹지 않게 막는다.
  const claimed: Array<[number, number]> = []

  for (const pattern of NUMBER_PATTERNS) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      const start = m.index
      const end = m.index + m[0].length
      if (claimed.some(([s, e]) => start < e && end > s)) continue

      // 앞뒤 문맥으로 등록번호 힌트를 준다 — "등록번호 10-1234567"
      const before = text.slice(Math.max(0, start - 12), start)
      const hint = /등록/.test(before) ? ("registration" as const) : undefined

      let entry: ExtractedNumber
      try {
        const parsed = parseNumber(m[0], hint)
        if (seen.has(parsed.normalized)) continue
        seen.add(parsed.normalized)
        entry = { ...parsed, index: start, match: m[0], valid: true }
      } catch (e) {
        // 특허번호 모양인데 형태가 성립하지 않는다 = 창작 신호. 버리지 않고 담는다.
        const key = `!${m[0]}`
        if (seen.has(key)) continue
        seen.add(key)
        entry = {
          index: start,
          match: m[0],
          valid: false,
          pretty: m[0].trim(),
          reason: e instanceof Error ? e.message : String(e),
        }
      }

      claimed.push([start, end])
      found.push(entry)
      if (found.length >= max) return found.sort((a, b) => a.index - b.index)
    }
  }

  return found.sort((a, b) => a.index - b.index)
}

/** KIPRIS 웹 상세 페이지 URL — 사람이 눈으로 확인할 수 있는 출처. */
export function kiprisUrl(n: ParsedNumber): string {
  const menu = n.ip === "patent" ? "patent" : "utility"
  return `https://www.kipris.or.kr/khome/search/searchResult.do?tab=${menu}&query=${encodeURIComponent(n.pretty)}`
}
