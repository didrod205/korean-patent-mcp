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

  it("뒤 번호의 명칭을 끌어오지 않는다 — 무고 방지", () => {
    // 실사용에서 나온 버그: 10-2019-0000000 이 뒤 인용의 명칭을 가져갔다.
    // 실재하는 번호였다면 멀쩡한 인용을 명칭 불일치로 몰았을 것이다.
    const t = '특허 10-2019-0000000 을 보유하고 있으며, 「무선충전코일」(10-2019-0023102)도 확보했습니다.'
    expect(find(t, "10-2019-0000000")).toBeUndefined()
  })

  it("앞 번호의 명칭을 끌어오지 않는다", () => {
    const t = '「무선충전코일」(10-2019-0023102)과 특허 10-2020-0011111 을 보유합니다.'
    expect(find(t, "10-2020-0011111")).toBeUndefined()
  })

  it("자기 명칭은 여전히 잡는다", () => {
    const t = '특허 10-2019-0000000 을 보유하고 있으며, 「무선충전코일」(10-2019-0023102)도 확보했습니다.'
    expect(find(t, "10-2019-0023102")).toBe("무선충전코일")
  })

  it("여러 인용을 연달아 처리해도 각자 명칭을 지킨다", () => {
    // /g 정규식의 lastIndex 가 남아 뒤 인용이 자기 명칭을 못 찾던 회귀
    const t = '「가나장치」(10-2019-0011111)와 「다라방법」(10-2019-0022222), 「마바구조」(10-2019-0033333)'
    expect(find(t, "10-2019-0011111")).toBe("가나장치")
    expect(find(t, "10-2019-0022222")).toBe("다라방법")
    expect(find(t, "10-2019-0033333")).toBe("마바구조")
  })

  it("주변에 아무 명칭도 없으면 undefined", () => {
    expect(find("그냥 10-2019-0123456 뿐", "10-2019-0123456")).toBeUndefined()
  })
})
