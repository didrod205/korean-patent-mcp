import { describe, it, expect } from "vitest"
import { compareTitles, extractClaimedTitle, normalizeTitle, diceSimilarity } from "./title-match.js"

describe("normalizeTitle", () => {
  it("공백·괄호·따옴표를 지운다", () => {
    expect(normalizeTitle("「무선 충전 장치」 (개선)")).toBe("무선충전장치개선")
  })
})

describe("diceSimilarity", () => {
  it("같으면 1", () => expect(diceSimilarity("abc", "abc")).toBe(1))
  it("전혀 다르면 0에 가깝다", () => expect(diceSimilarity("가나다라", "위키백과")).toBeLessThan(0.2))
})

describe("compareTitles", () => {
  it("완전 일치", () => {
    expect(compareTitles("무선 충전 장치", "무선충전장치").verdict).toBe("match")
  })

  it("포함 관계는 축약 인용으로 본다", () => {
    expect(compareTitles("무선 충전 장치", "무선 충전 장치 및 그 제어 방법").verdict).toBe("match")
  })

  it("전혀 다른 발명은 불일치 — LLM 환각의 전형", () => {
    const r = compareTitles("인공지능 기반 신약 후보물질 탐색 방법", "자전거 체인 장력 조절 장치")
    expect(r.verdict).toBe("mismatch")
  })

  it("주장된 명칭이 없으면 not_claimed", () => {
    expect(compareTitles(undefined, "무선 충전 장치").verdict).toBe("not_claimed")
  })
})

describe("extractClaimedTitle", () => {
  const find = (text: string, num: string) =>
    extractClaimedTitle(text, text.indexOf(num), num.length)

  it("따옴표가 번호 앞에 있을 때", () => {
    const t = '「무선 충전 장치」(10-2019-0123456)를 참고하세요.'
    expect(find(t, "10-2019-0123456")).toBe("무선 충전 장치")
  })

  it("따옴표가 번호 뒤에 있을 때", () => {
    const t = '특허 10-2019-0123456 "무선 충전 장치"가 있습니다.'
    expect(find(t, "10-2019-0123456")).toBe("무선 충전 장치")
  })

  it("명칭: 표기가 최우선", () => {
    const t = "10-2019-0123456 (명칭: 배터리 냉각 구조)"
    expect(find(t, "10-2019-0123456")).toBe("배터리 냉각 구조")
  })

  it("문장이 끼어 있으면 가져오지 않는다", () => {
    const t = '「다른 발명」입니다. 전혀 무관한 문장이 하나 더 있고요. 10-2019-0123456'
    expect(find(t, "10-2019-0123456")).toBeUndefined()
  })

  it("주변에 아무 명칭도 없으면 undefined", () => {
    expect(find("그냥 10-2019-0123456 뿐", "10-2019-0123456")).toBeUndefined()
  })
})
