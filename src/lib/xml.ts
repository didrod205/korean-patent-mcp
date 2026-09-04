/**
 * 의존성 없는 XML 추출 유틸.
 *
 * KIPRIS 응답은 response/header + response/body/items/item 구조의 평평한 XML이다.
 * 중첩이 얕고 스키마가 안정적이라 정규식으로 충분하다. 대신 필드명이
 * 서비스마다 미묘하게 달라서(inventionTitle / inventionName / articleName ...)
 * "후보 이름 목록"으로 찾는 pick()이 핵심이다.
 */

/** 태그 하나의 텍스트. CDATA·self-closing 처리. 없으면 undefined. */
export function tag(xml: string, name: string): string | undefined {
  const cdata = xml.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${name}>`)
  )
  if (cdata) return cdata[1]?.trim() || undefined

  const plain = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))
  if (plain) {
    const v = plain[1]?.trim()
    return v ? decodeEntities(v) : undefined
  }

  if (new RegExp(`<${name}(?:\\s[^>]*)?/>`).test(xml)) return undefined
  return undefined
}

/**
 * 여러 후보 이름 중 처음으로 값이 있는 것을 고른다.
 * KIPRIS는 같은 뜻을 서비스마다 다른 이름으로 준다 — 이걸 호출부마다
 * if-else로 풀면 필드가 하나 늘 때마다 세 군데를 고쳐야 한다.
 */
export function pick(xml: string, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = tag(xml, n)
    if (v !== undefined && v !== "" && v !== "null") return v
  }
  return undefined
}

/** 반복 요소를 잘라 배열로. */
export function items(xml: string, name = "item"): string[] {
  const out: string[] = []
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) out.push(m[1])
  }
  return out
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (e) => ENTITIES[e] ?? e)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
}

/**
 * KIPRIS 날짜를 ISO YYYY-MM-DD로.
 *
 * 실제 응답은 서비스마다 형식이 갈린다:
 *   "1985/12/30 00:00:00"   ← 공개·등록공보 검색 응답 (시각까지 붙는다)
 *   "19851230"              ← 서지상세 계열
 *   "1985.12.30"            ← 일부 필드
 *
 * 숫자만 남기고 앞 8자리를 쓴다. 숫자를 다 이어붙인 뒤 길이가 8이 아니라고 버리면
 * "1985/12/30 00:00:00"(14자리)이 통째로 날아가고, 그러면 출원일이 안 잡혀
 * 존속기간 만료 판정이 조용히 죽는다. 한국 날짜 표기는 연도가 앞에 오므로 앞 8자리가 맞다.
 *
 * 값이 없거나 날짜로 안 읽히면 undefined — 빈 문자열을 날짜로 흘려보내지 않는다.
 */
export function isoDate(v?: string): string | undefined {
  if (!v) return undefined
  const digits = v.replace(/\D/g, "")
  if (digits.length < 8) return undefined
  const d = digits.slice(0, 8)
  const y = Number(d.slice(0, 4))
  const m = Number(d.slice(4, 6))
  const day = Number(d.slice(6, 8))
  if (y < 1800 || y > 2200) return undefined
  if (m < 1 || m > 12 || day < 1 || day > 31) return undefined
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
}

/** KIPRIS는 복수값을 "|"로 잇는다(출원인명, IPC코드). 사람이 읽는 형태로 되돌린다. */
export function splitMulti(v?: string): string | undefined {
  if (!v) return undefined
  const parts = v
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : undefined
}
