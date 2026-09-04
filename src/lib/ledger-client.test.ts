import { describe, it, expect } from "vitest"
import { LedgerClient, parseLedger } from "./ledger-client.js"

/** 실제 응답을 줄인 것. 삼성전자 10-2245822 (활용가이드 규격 확인 완료) */
const REAL_JSON = JSON.stringify({
  resultCode: "000",
  resultMsg: "REQUEST_SUCCESS",
  items: {
    rgstNo: "1022458220000",
    rgstDate: "20210422",
    applNo: "1020140166536",
    applDate: "20141126",
    title: "불휘발성 메모리 장치를 포함하는 저장 장치 및 그것의 프로그램 방법",
    cndrtExptnDate: "20341126",
    lastDspst: "등록결정(일반)",
    pay: [
      { statAnnl: 1, lastAnnl: 3, payDate: "20210423", payAmount: 425000 },
      { statAnnl: 4, lastAnnl: 4, payDate: "20240325", payAmount: 236000 },
      { statAnnl: 6, lastAnnl: 6, payDate: "20260327", payAmount: 236000 },
      { statAnnl: 5, lastAnnl: 5, payDate: "20250325", payAmount: 236000 },
    ],
    applicant: [{ applicantName: "삼성전자주식회사" }],
    owner: [
      { ownerName: "이전권리자주식회사", finalOwnerYn: "N" },
      { ownerName: "삼성전자주식회사", finalOwnerYn: "Y" },
    ],
  },
  totalCount: 1,
})

const XML = `<response><body><items>
  <cndrtExptnDate>20390314</cndrtExptnDate>
  <ownerName>가나전자 주식회사</ownerName>
  <lastDspst>등록결정(일반)</lastDspst>
  <pay><lastAnnl>6</lastAnnl><payDate>20270314</payDate></pay>
</items></body></response>`

describe("parseLedger — 실제 JSON 응답", () => {
  const r = parseLedger(REAL_JSON)!

  it("존속기간 만료일을 확정값으로 읽는다", () => {
    expect(r.expiryDate).toBe("2034-11-26")
  })

  it("현재 권리자는 finalOwnerYn=Y 인 쪽이다 — 첫 항목이 아니다", () => {
    // owner 배열에는 이전 권리자도 들어 있다. 첫 항목을 쓰면 양도 전 이름이 나온다.
    expect(r.rightHolder).toBe("삼성전자주식회사")
  })

  it("최종처분을 읽는다", () => expect(r.statusText).toBe("등록결정(일반)"))

  it("연차 납부를 연차 오름차순으로 정렬한다", () => {
    expect(r.payments.map((p) => p.year)).toEqual([3, 4, 5, 6])
  })

  it("마지막 연차와 납입일을 잡는다", () => {
    expect(r.annualFeeYear).toBe(6)
    expect(r.annualFeePaidDate).toBe("2026-03-27")
  })

  it("납입금액도 읽는다", () => {
    expect(r.payments.at(-1)?.amount).toBe(236000)
  })

  it("등록번호·출원번호를 교차확인용으로 남긴다", () => {
    expect(r.registerNumber).toBe("1022458220000")
    expect(r.applicationNumber).toBe("1020140166536")
  })
})

describe("parseLedger — 오류 응답", () => {
  it("resultCode가 000이 아니면 null", () => {
    expect(
      parseLedger('{"resultCode":"003","resultMsg":"NO_MANDATORY_REQUEST_PARAMETER_ERROR"}')
    ).toBeNull()
  })
  it("items가 없으면 null", () => {
    expect(parseLedger('{"resultCode":"000","totalCount":0}')).toBeNull()
  })
  it("깨진 JSON도 던지지 않는다", () => expect(parseLedger("{not json")).toBeNull())
})

describe("parseLedger — XML 경로", () => {
  const r = parseLedger(XML)!
  it("만료일", () => expect(r.expiryDate).toBe("2039-03-14"))
  it("권리자", () => expect(r.rightHolder).toBe("가나전자 주식회사"))
  it("최종처분", () => expect(r.statusText).toBe("등록결정(일반)"))
  it("연차", () => {
    expect(r.annualFeeYear).toBe(6)
    expect(r.annualFeePaidDate).toBe("2027-03-14")
  })
})

describe("LedgerClient — 설정", () => {
  const spy = (opts: Record<string, unknown> = {}) => {
    let seen = ""
    const c = new LedgerClient({
      serviceKey: "K",
      cacheTtlSec: 0,
      fetchImpl: (async (u: string) => {
        seen = String(u)
        return new Response(XML, { status: 200 })
      }) as unknown as typeof fetch,
      ...opts,
    })
    return { c, url: () => seen }
  }

  it("키가 없으면 꺼진 상태이고 무엇이 달라지는지 설명한다", () => {
    const c = new LedgerClient({ serviceKey: "" })
    expect(c.enabled).toBe(false)
    expect(c.disabledReason).toMatch(/DATA_GO_KR_SERVICE_KEY/)
    expect(c.disabledReason).toMatch(/추정치이고 연차료는 확인되지 않았습니다/)
  })

  it("키만 있으면 동작한다 — 엔드포인트는 기본값이 있다", () => {
    expect(new LedgerClient({ serviceKey: "K" }).enabled).toBe(true)
  })

  it("특허는 getPatentRegisterHistory 로 간다", async () => {
    const { c, url } = spy()
    await c.lookup("1022458220000", "patent")
    expect(url()).toContain("/PttRgstRtInfoInqSvc/getPatentRegisterHistory?")
    expect(url()).toContain("type=json")
    expect(url()).toContain("rgstNo=1022458220000")
  })

  it("실용신안은 getUtilityModelHistory 로 간다 — 오퍼레이션이 권리구분마다 다르다", async () => {
    const { c, url } = spy()
    await c.lookup("2012345670000", "utility")
    expect(url()).toContain("/getUtilityModelHistory?")
  })

  it("등록번호 파라미터명을 덮어쓸 수 있다", async () => {
    const { c, url } = spy({ numberParam: "regiNo" })
    await c.lookup("1022458220000", "patent")
    expect(url()).toContain("regiNo=1022458220000")
  })

  it("베이스 URL을 덮어쓸 수 있다", async () => {
    const { c, url } = spy({ baseUrl: "https://example.test/svc/" })
    await c.lookup("1022458220000", "patent")
    expect(url()).toContain("https://example.test/svc/getPatentRegisterHistory?")
  })

  it("꺼져 있으면 lookup은 던지지 않고 null", async () => {
    await expect(new LedgerClient({ serviceKey: "" }).lookup("101234567")).resolves.toBeNull()
  })

  it("상류 실패해도 던지지 않는다 — 부가정보가 본 판정을 막으면 안 된다", async () => {
    const c = new LedgerClient({
      serviceKey: "K",
      cacheTtlSec: 0,
      fetchImpl: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    })
    await expect(c.lookup("101234567")).resolves.toBeNull()
  })

  it("이미 인코딩된 키를 두 번 인코딩하지 않는다", async () => {
    const { c, url } = spy({ serviceKey: "abc%2Bdef" })
    await c.lookup("101234567", "patent")
    expect(url()).toContain("serviceKey=abc%2Bdef")
    expect(url()).not.toContain("%252B")
  })
})
