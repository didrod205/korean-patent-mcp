import { describe, it, expect } from "vitest"
import { judge, estimateExpiry } from "./status.js"

const TODAY = new Date("2026-09-04T00:00:00Z")
const P = { ip: "patent" as const, today: TODAY }

describe("estimateExpiry", () => {
  it("특허는 출원일 + 20년", () => {
    expect(estimateExpiry("2005-03-14", "patent")).toBe("2025-03-14")
  })
  it("실용신안은 출원일 + 10년", () => {
    expect(estimateExpiry("2015-03-14", "utility")).toBe("2025-03-14")
  })
  it("형식이 아니면 undefined", () => {
    expect(estimateExpiry("어제", "patent")).toBeUndefined()
  })
})

describe("judge — 죽음", () => {
  it("소멸", () => {
    const v = judge({ statusText: "소멸", ...P })
    expect(v.alive).toBe(false)
    expect(v.stage).toBe("소멸")
  })

  it("연차료 불납은 사유까지 붙는다", () => {
    const v = judge({ statusText: "소멸(연차료 불납)", ...P })
    expect(v.status).toBe("소멸(연차료 불납)")
    expect(v.alive).toBe(false)
  })

  it("무효·취소·포기·거절·취하", () => {
    for (const s of ["무효", "취소", "포기", "거절", "취하"]) {
      expect(judge({ statusText: s, ...P }).alive).toBe(false)
    }
  })

  it("거절·취하·포기는 소멸이 아니라 출원종료로 갈린다", () => {
    expect(judge({ statusText: "거절", ...P }).stage).toBe("출원종료")
    expect(judge({ statusText: "무효", ...P }).stage).toBe("소멸")
  })

  it("최종처분이 상태 문자열보다 강하다", () => {
    const v = judge({ statusText: "공개", finalDisposal: "거절결정", ...P })
    expect(v.stage).toBe("출원종료")
  })
})

describe("judge — 등록", () => {
  it("존속기간 내 등록은 살아있다", () => {
    const v = judge({ statusText: "등록", applicationDate: "2020-01-01", registerDate: "2022-05-01", ...P })
    expect(v.alive).toBe(true)
    expect(v.stage).toBe("등록유효")
    expect(v.expiry).toBe("2040-01-01")
    expect(v.expiryEstimated).toBe(true)
  })

  it("등록이라도 존속기간이 지났으면 죽었다 — 이 서버의 핵심", () => {
    const v = judge({ statusText: "등록", applicationDate: "2000-01-01", ...P })
    expect(v.alive).toBe(false)
    expect(v.stage).toBe("소멸")
    expect(v.status).toBe("소멸(존속기간 만료)")
  })

  it("실용신안은 10년으로 계산한다", () => {
    const v = judge({ statusText: "등록", applicationDate: "2013-01-01", ip: "utility", today: TODAY })
    expect(v.alive).toBe(false)
    expect(v.expiry).toBe("2023-01-01")
  })

  it("API가 만료일을 주면 추정하지 않는다", () => {
    const v = judge({ statusText: "등록", applicationDate: "2000-01-01", expiryDate: "2030-06-01", ...P })
    expect(v.alive).toBe(true)
    expect(v.expiryEstimated).toBe(false)
  })

  it("등록 판정에는 연차료 미확인 경고가 붙는다", () => {
    const v = judge({ statusText: "등록", applicationDate: "2020-01-01", ...P })
    expect(v.warnings.some((w) => /연차료/.test(w))).toBe(true)
  })
})

describe("judge — 출원계속", () => {
  it("공개는 아직 권리가 아니다", () => {
    const v = judge({ statusText: "공개", applicationDate: "2024-01-01", ...P })
    expect(v.alive).toBe(false)
    expect(v.stage).toBe("출원계속")
  })

  it("출원계속은 소멸과 다르게 표시된다", () => {
    expect(judge({ statusText: "공개", ...P }).stage).not.toBe(
      judge({ statusText: "소멸", ...P }).stage
    )
  })

  it("장래 등록 가능성을 경고로 알린다", () => {
    const v = judge({ statusText: "심사중", ...P })
    expect(v.warnings.join()).toMatch(/장래 등록/)
  })
})

describe("judge — 불명", () => {
  it("상태가 비면 불명", () => {
    const v = judge({ ...P })
    expect(v.stage).toBe("불명")
    expect(v.alive).toBe(false)
  })

  it("모르는 값은 살아있다고 하지 않는다", () => {
    const v = judge({ statusText: "정체불명상태값", ...P })
    expect(v.alive).toBe(false)
    expect(v.stage).toBe("불명")
  })

  it("판정 근거는 언제나 채워진다", () => {
    for (const s of ["등록", "소멸", "공개", "이상한값", ""]) {
      expect(judge({ statusText: s, applicationDate: "2020-01-01", ...P }).basis).toBeTruthy()
    }
  })
})
