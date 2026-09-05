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

/**
 * 다른 특허번호의 위치. 명칭 탐색 창을 여기서 끊는다.
 *
 * 끊지 않으면 앞 번호가 뒤 번호의 명칭을 끌어온다:
 *   "특허 10-2019-0000000 을 보유하고 있으며, 「무선충전코일」(10-2019-0023102)도..."
 *   → 10-2019-0000000 의 claimed_title 이 "무선충전코일" 로 잡힌다.
 *
 * 그 번호가 실재하는 건이었다면 멀쩡한 인용을 명칭 불일치로 무고하게 된다.
 * 이 도구에서 가장 나쁜 오류다 — 창작을 잡으라고 만들었는데 진짜를 창작이라 하는 것.
 */
const H2 = "[-\\u2010\\u2011\\u2012\\u2013\\u2014\\uFF0D]"
const ANY_NUMBER = new RegExp(
  `[12]0\\s*${H2}\\s*\\d{4}\\s*${H2}\\s*\\d{6,7}` +
    `|[12]0\\s*${H2}\\s*\\d{7}` +
    `|\\b[12]0\\d{11}\\b`,
  "g"
)

/** 창의 앞쪽에서 마지막 번호 뒤로 자른다. */
function cutBefore(text: string): string {
  ANY_NUMBER.lastIndex = 0
  let end = 0
  let m: RegExpExecArray | null
  while ((m = ANY_NUMBER.exec(text)) !== null) end = m.index + m[0].length
  return end > 0 ? text.slice(end) : text
}

/**
 * 따옴표 묶음이 자기 번호를 뒤에 달고 있는지 본다.
 *
 * 「무선충전코일」(10-2019-0023102) 처럼 명칭 바로 뒤에 번호가 붙으면
 * 그 명칭은 그 번호의 것이다. 앞선 다른 번호가 가져가면 안 된다.
 * 번호 위치에서 창을 자르는 것만으로는 못 막는다 — 명칭이 번호보다 앞에 오기 때문이다.
 */
function ownedByFollowingNumber(after: string, quoteEnd: number): boolean {
  // 번호 전체(10-2019-0023102 = 15자)가 들어갈 만큼 봐야 한다.
  // 8자만 보면 "(10-2019" 에서 끊겨 매칭이 안 된다 — 실제로 그렇게 못 잡았다.
  const tail = after.slice(quoteEnd, quoteEnd + 24)
  ANY_NUMBER.lastIndex = 0
  const m = ANY_NUMBER.exec(tail)
  return m !== null && m.index <= 2 // 닫는 따옴표와 번호 사이에 여는 괄호 정도만 허용
}

export function extractClaimedTitle(text: string, numberIndex: number, numberLength: number): string | undefined {
  // 앞쪽 창은 직전 번호 뒤부터 본다 — 그보다 앞은 그 번호의 몫이다.
  const before = cutBefore(text.slice(Math.max(0, numberIndex - 120), numberIndex))
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

  // 번호 바로 뒤의 첫 따옴표 묶음.
  // 단, 그 묶음이 자기 번호를 뒤에 달고 있으면 그건 다른 인용의 명칭이다.
  QUOTED.lastIndex = 0
  const firstAfter = QUOTED.exec(after)
  if (firstAfter?.[1]) {
    const gap = after.slice(0, firstAfter.index)
    const quoteEnd = firstAfter.index + firstAfter[0].length
    if (
      !/[.。\n]/.test(gap) &&
      gap.length <= 20 &&
      !ownedByFollowingNumber(after, quoteEnd)
    ) {
      return firstAfter[1].trim()
    }
  }

  return undefined
}
