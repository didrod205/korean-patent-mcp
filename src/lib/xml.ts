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
 * KIPRIS 날짜(YYYYMMDD 또는 YYYY.MM.DD)를 ISO YYYY-MM-DD로.
 * 값이 없거나 형식이 아니면 undefined — 빈 문자열을 날짜로 흘려보내지 않는다.
 */
export function isoDate(v?: string): string | undefined {
  if (!v) return undefined
  const d = v.replace(/\D/g, "")
  if (d.length !== 8) return undefined
  const y = d.slice(0, 4)
  const m = d.slice(4, 6)
  const day = d.slice(6, 8)
  if (Number(m) < 1 || Number(m) > 12 || Number(day) < 1 || Number(day) > 31) return undefined
  return `${y}-${m}-${day}`
}
