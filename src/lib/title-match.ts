/**
 * 인용된 명칭 ↔ 실제 명칭 대조.
 *
 * LLM이 특허를 지어낼 때 가장 흔한 형태는 "번호는 실재하는데 명칭이 다른" 것이다.
 * 번호를 통째로 창작하면 KIPRIS 조회에서 바로 걸리지만, 실재 번호에
 * 그럴듯한 명칭을 붙이면 번호 조회만으로는 통과한다. 그래서 명칭 대조가 필요하다.
 */

export type TitleVerdict = "match" | "partial" | "mismatch" | "not_claimed"

/** 비교용 정규화: 공백·문장부호·괄호 제거, 소문자화. */
export function normalizeTitle(s: string): string {
  return s
    .replace(/[\s ]+/g, "")
    .replace(/[()（）[\]{}<>《》「」『』"'“”‘’,.·・、,]/g, "")
    .toLowerCase()
}

/** 문자 바이그램 Dice 계수. 한국어 명칭에서 어절 분리보다 안정적이다. */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }

  const A = bigrams(a)
  const B = bigrams(b)
  let overlap = 0
  for (const [g, countA] of A) {
    const countB = B.get(g)
    if (countB) overlap += Math.min(countA, countB)
  }
  const totalA = a.length - 1
  const totalB = b.length - 1
  return (2 * overlap) / (totalA + totalB)
}

export interface TitleComparison {
  verdict: TitleVerdict
  similarity: number
  claimed?: string
  actual?: string
}

export function compareTitles(claimed: string | undefined, actual: string | undefined): TitleComparison {
  if (!claimed) return { verdict: "not_claimed", similarity: 0, actual }
  if (!actual) return { verdict: "not_claimed", similarity: 0, claimed }

  const a = normalizeTitle(claimed)
  const b = normalizeTitle(actual)

  if (a === b) return { verdict: "match", similarity: 1, claimed, actual }
  // 한쪽이 다른 쪽을 통째로 포함하면 축약 인용으로 본다.
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) {
    return { verdict: "match", similarity: 0.95, claimed, actual }
  }

  const sim = diceSimilarity(a, b)
  if (sim >= 0.7) return { verdict: "match", similarity: sim, claimed, actual }
  if (sim >= 0.4) return { verdict: "partial", similarity: sim, claimed, actual }
  return { verdict: "mismatch", similarity: sim, claimed, actual }
}

/**
 * 번호 주변 문맥에서 "이 번호의 명칭이라고 주장된 문자열"을 뽑는다.
 *
 * 잡는 표기:
 *   「무선 충전 장치」(10-2019-0123456)
 *   '무선 충전 장치'(특허 제10-1234567호)
 *   10-2019-0123456 "무선 충전 장치"
 *   특허 제10-1234567호(명칭: 무선 충전 장치)
 */
const QUOTED = /[「『"“'‘]([^」』"”'’\n]{2,60})[」』"”'’]/g
const NAMED = /명칭\s*[:：]\s*([^)\n,，]{2,60})/

export function extractClaimedTitle(text: string, numberIndex: number, numberLength: number): string | undefined {
  const before = text.slice(Math.max(0, numberIndex - 120), numberIndex)
  const after = text.slice(numberIndex + numberLength, numberIndex + numberLength + 120)

  // "명칭:" 표기가 있으면 그게 가장 확실하다
  const namedAfter = after.match(NAMED)
  if (namedAfter?.[1]) return namedAfter[1].trim()
  const namedBefore = before.match(NAMED)
  if (namedBefore?.[1]) return namedBefore[1].trim()

  // 번호 바로 앞의 마지막 따옴표 묶음
  const beforeMatches = [...before.matchAll(QUOTED)]
  const lastBefore = beforeMatches[beforeMatches.length - 1]
  if (lastBefore?.[1]) {
    // 따옴표와 번호 사이에 문장이 끼어 있으면 다른 얘기다
    const gap = before.slice((lastBefore.index ?? 0) + lastBefore[0].length)
    if (!/[.。\n]/.test(gap) && gap.length <= 20) return lastBefore[1].trim()
  }

  // 번호 바로 뒤의 첫 따옴표 묶음
  QUOTED.lastIndex = 0
  const firstAfter = QUOTED.exec(after)
  if (firstAfter?.[1]) {
    const gap = after.slice(0, firstAfter.index)
    if (!/[.。\n]/.test(gap) && gap.length <= 20) return firstAfter[1].trim()
  }

  return undefined
}
