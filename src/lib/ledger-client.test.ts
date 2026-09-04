import { describe, it, expect } from "vitest"
import { LedgerClient, parseLedger } from "./ledger-client.js"

const XML = `<response><header><resultCode>00</resultCode></header><body><items><item>
  <등록번호>1012345670000</등록번호>
  <권리자명>가나전자 주식회사</권리자명>
  <존속기간만료일자>20390314</존속기간만료일자>
  <권리상태>등록</권리상태>
  <최종납부년차>6</최종납부년차>
  <연차료납부기한>2027-03-14</연차료납부기한>
</item></items></body></response>`

const JSON_BODY = JSON.stringify({
  response: {
    header: { resultCode: "00" },
    body: {
      items: {
        item: {
          rightHolderName: "다라산업",
          expirationDate: "20250510",
          rightStatus: "소멸",
          lastPaymentYear: "12",
        },
      },
    },
  },
})

describe("parseLedger — XML", () => {
  const r = parseLedger(XML)!
  it("만료일을 ISO로 읽는다", () => expect(r.expiryDate).toBe("2039-03-14"))
  it("등록권자를 읽는다", () => expect(r.rightHolder).toBe("가나전자 주식회사"))
  it("권리상태를 읽는다", () => expect(r.statusText).toBe("등록"))
  it("납부년차를 숫자로 읽는다", () => expect(r.annualFeeYear).toBe(6))
  it("납부기한을 읽는다", () => expect(r.annualFeePaidUntil).toBe("2027-03-14"))
})

describe("parseLedger — JSON", () => {
  // 이 API는 JSON+XML 둘 다 제공한다. 응답 구조를 몰라도 값을 찾아야 한다.
  const r = parseLedger(JSON_BODY)!
  it("중첩 JSON에서도 값을 찾는다", () => {
    expect(r.rightHolder).toBe("다라산업")
    expect(r.expiryDate).toBe("2025-05-10")
    expect(r.statusText).toBe("소멸")
    expect(r.annualFeeYear).toBe(12)
  })
})

describe("parseLedger — 못 읽는 경우", () => {
  it("아는 필드가 하나도 없으면 null — 빈 레코드를 지어내지 않는다", () => {
    expect(parseLedger("<response><body><items/></body></response>")).toBeNull()
  })
  it("깨진 JSON도 던지지 않는다", () => {
    expect(parseLedger("{not json")).toBeNull()
  })
})

describe("LedgerClient — 설정", () => {
  it("키만 있고 엔드포인트가 없으면 꺼진 상태다", () => {
    const c = new LedgerClient({ serviceKey: "K", endpoint: "" })
    expect(c.enabled).toBe(false)
    expect(c.disabledReason).toMatch(/LEDGER_ENDPOINT/)
  })

  it("엔드포인트만 있고 키가 없으면 꺼진 상태다", () => {
    const c = new LedgerClient({ serviceKey: "", endpoint: "https://x/y" })
    expect(c.enabled).toBe(false)
    expect(c.disabledReason).toMatch(/DATA_GO_KR_SERVICE_KEY/)
  })

  it("둘 다 없으면 무엇이 달라지는지 설명한다", () => {
    const c = new LedgerClient({ serviceKey: "", endpoint: "" })
    expect(c.disabledReason).toMatch(/추정치이고 연차료는 확인되지 않았습니다/)
  })

  it("꺼져 있으면 lookup은 던지지 않고 null", async () => {
    const c = new LedgerClient({ serviceKey: "", endpoint: "" })
    await expect(c.lookup("101234567")).resolves.toBeNull()
  })

  it("상류 실패해도 던지지 않는다 — 부가정보가 본 판정을 막으면 안 된다", async () => {
    const c = new LedgerClient({
      serviceKey: "K",
      endpoint: "https://x/y",
      cacheTtlSec: 0,
      fetchImpl: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    })
    await expect(c.lookup("101234567")).resolves.toBeNull()
  })

  it("이미 인코딩된 키를 두 번 인코딩하지 않는다", async () => {
    let seen = ""
    const c = new LedgerClient({
      serviceKey: "abc%2Bdef",
      endpoint: "https://x/y",
      cacheTtlSec: 0,
      fetchImpl: (async (u: string) => {
        seen = String(u)
        return new Response(XML, { status: 200 })
      }) as unknown as typeof fetch,
    })
    await c.lookup("101234567")
    expect(seen).toContain("serviceKey=abc%2Bdef")
    expect(seen).not.toContain("%252B")
  })

  it("엔드포인트에 이미 쿼리가 있으면 & 로 잇는다", async () => {
    let seen = ""
    const c = new LedgerClient({
      serviceKey: "K",
      endpoint: "https://x/y?foo=1",
      cacheTtlSec: 0,
      fetchImpl: (async (u: string) => {
        seen = String(u)
        return new Response(XML, { status: 200 })
      }) as unknown as typeof fetch,
    })
    await c.lookup("101234567")
    expect(seen).toContain("y?foo=1&registerNumber=")
  })
})
