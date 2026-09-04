/**
 * 도구 3개의 통합 테스트. fetch를 가짜로 갈아끼워 KIPRIS 없이 돈다.
 * 가짜 응답은 실제 KIPRIS 응답 형태(response/body/items/item + biblioSummaryInfo)를 따른다.
 */
import { describe, it, expect } from "vitest"
import { KiprisClient } from "../lib/kipris-client.js"
import { LedgerClient } from "../lib/ledger-client.js"
import { rightsAlive } from "./rights-alive.js"
import { verifyCitations } from "./verify-citations.js"
import { searchIp } from "./search-ip.js"

interface Fixture {
  applicationNumber: string
  applicationDate: string
  inventionTitle: string
  registerStatus: string
  registerNumber?: string
  registerDate?: string
  finalDisposal?: string
  applicant?: string
  legalDate?: string
  legalDesc?: string
}

function biblioXml(f: Fixture): string {
  return `<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE</resultMsg></header><body>
  <item>
    <biblioSummaryInfo>
      <applicationNumber>${f.applicationNumber}</applicationNumber>
      <applicationDate>${f.applicationDate.replace(/-/g, "")}</applicationDate>
      <inventionTitle><![CDATA[${f.inventionTitle}]]></inventionTitle>
      <registerStatus>${f.registerStatus}</registerStatus>
      <registerNumber>${f.registerNumber ?? ""}</registerNumber>
      <registerDate>${(f.registerDate ?? "").replace(/-/g, "")}</registerDate>
      <finalDisposal>${f.finalDisposal ?? ""}</finalDisposal>
    </biblioSummaryInfo>
    <applicantInfoArray><applicantInfo><name>${f.applicant ?? "테스트주식회사"}</name></applicantInfo></applicantInfoArray>
    ${f.legalDate ? `<legalStatusInfoArray><legalStatusInfo><receiptDate>${f.legalDate.replace(/-/g, "")}</receiptDate><registerStatus>${f.legalDesc ?? ""}</registerStatus></legalStatusInfo></legalStatusInfoArray>` : ""}
  </item>
</body></response>`
}

function searchXml(fs: Fixture[]): string {
  const items = fs
    .map(
      (f) => `<item>
    <applicationNumber>${f.applicationNumber}</applicationNumber>
    <applicationDate>${f.applicationDate.replace(/-/g, "")}</applicationDate>
    <inventionTitle><![CDATA[${f.inventionTitle}]]></inventionTitle>
    <registerStatus>${f.registerStatus}</registerStatus>
    <registerNumber>${f.registerNumber ?? ""}</registerNumber>
    <applicantName>${f.applicant ?? "테스트주식회사"}</applicantName>
  </item>`
    )
    .join("\n")
  return `<response><header><resultCode>00</resultCode></header><count><totalCount>${fs.length}</totalCount></count><body><items>${items}</items></body></response>`
}

const ALIVE: Fixture = {
  applicationNumber: "1020190123456",
  applicationDate: "2019-03-14",
  inventionTitle: "무선 충전 장치 및 그 제어 방법",
  registerStatus: "등록",
  registerNumber: "1023456780000",
  registerDate: "2021-06-01",
  applicant: "가나전자",
  legalDate: "2021-06-01",
  legalDesc: "설정등록",
}

const DEAD: Fixture = {
  applicationNumber: "1020000012345",
  applicationDate: "2000-05-10",
  inventionTitle: "카세트 테이프 권취 장치",
  registerStatus: "소멸(연차료 불납)",
  registerNumber: "1004567890000",
  registerDate: "2002-01-01",
  applicant: "다라산업",
}

const PENDING: Fixture = {
  applicationNumber: "1020250001111",
  applicationDate: "2025-01-05",
  inventionTitle: "인공지능 기반 물류 최적화 방법",
  registerStatus: "공개",
  applicant: "마바테크",
}

const EMPTY = `<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE</resultMsg></header><body><items></items></body></response>`

const DB: Record<string, Fixture> = {
  "1020190123456": ALIVE,
  "1020000012345": DEAD,
  "1020250001111": PENDING,
}

function makeClient(opts: { search?: Fixture[] } = {}): KiprisClient {
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input)
    const res = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/xml" } })

    if (url.includes("getBibliographyDetailInfoSearch")) {
      const appNo = new URL(url).searchParams.get("applicationNumber") ?? ""
      const f = DB[appNo]
      return res(f ? biblioXml(f) : EMPTY)
    }
    if (url.includes("getAdvancedSearch")) {
      const reg = new URL(url).searchParams.get("registerNumber")
      if (reg) {
        const f = Object.values(DB).find((x) => (x.registerNumber ?? "").startsWith(reg.slice(0, 9)))
        return res(f ? searchXml([f]) : EMPTY)
      }
      return res(searchXml(opts.search ?? []))
    }
    if (url.includes("getWordSearch")) {
      return res(searchXml(opts.search ?? []))
    }
    return res(EMPTY)
  }) as unknown as typeof fetch

  return new KiprisClient({ serviceKey: "TEST-KEY", cacheTtlSec: 0, fetchImpl: fakeFetch })
}

/** totalCount를 임의로 지정할 수 있는 클라이언트 — 부분 표본 상황을 만든다 */
function makeClientWithTotal(fs: Fixture[], total: number): KiprisClient {
  const items = fs
    .map(
      (f) => `<item>
    <applicationNumber>${f.applicationNumber}</applicationNumber>
    <applicationDate>${f.applicationDate.replace(/-/g, "")}</applicationDate>
    <inventionTitle><![CDATA[${f.inventionTitle}]]></inventionTitle>
    <registerStatus>${f.registerStatus}</registerStatus>
    <applicantName>${f.applicant ?? "테스트주식회사"}</applicantName>
  </item>`
    )
    .join("\n")
  const xml = `<response><header><resultCode>00</resultCode></header><count><totalCount>${total}</totalCount></count><body><items>${items}</items></body></response>`
  return new KiprisClient({
    serviceKey: "TEST-KEY",
    cacheTtlSec: 0,
    fetchImpl: (async () => new Response(xml, { status: 200 })) as unknown as typeof fetch,
  })
}

describe("rights_alive", () => {
  it("살아있는 등록특허", async () => {
    const r = await rightsAlive(makeClient(), { number: "10-2019-0123456" })
    expect("alive" in r && r.alive).toBe(true)
    if (!("alive" in r)) throw new Error("unexpected")
    expect(r.stage).toBe("등록유효")
    expect(r.title).toBe("무선 충전 장치 및 그 제어 방법")
    expect(r.holder).toBe("가나전자")
    expect(r.expiry).toBe("2039-03-14")
    expect(r.source_url).toContain("kipris.or.kr")
  })

  it("연차료 불납으로 소멸한 특허", async () => {
    const r = await rightsAlive(makeClient(), { number: "10-2000-0012345" })
    if (!("alive" in r)) throw new Error("unexpected")
    expect(r.alive).toBe(false)
    expect(r.status).toBe("소멸(연차료 불납)")
    expect(r.stage).toBe("소멸")
  })

  it("등록 전 출원은 alive=false지만 소멸과 구분된다", async () => {
    const r = await rightsAlive(makeClient(), { number: "10-2025-0001111" })
    if (!("alive" in r)) throw new Error("unexpected")
    expect(r.alive).toBe(false)
    expect(r.stage).toBe("출원계속")
    expect(r.warnings.join()).toMatch(/장래 등록/)
  })

  it("등록번호로도 조회된다", async () => {
    const r = await rightsAlive(makeClient(), { number: "10-2345678" })
    if (!("alive" in r)) throw new Error("unexpected")
    expect(r.title).toBe("무선 충전 장치 및 그 제어 방법")
  })

  it("없는 번호는 오류로 명시한다 — 조용히 빈 결과를 주지 않는다", async () => {
    // 형태는 성립하지만 KIPRIS에 없는 번호
    const r = await rightsAlive(makeClient(), { number: "10-2019-0999999" })
    expect("error" in r).toBe(true)
    if ("error" in r) expect(r.hint).toMatch(/지어낸/)
  })

  it("형태가 성립하지 않는 번호는 조회 전에 거절한다", async () => {
    // 자릿수를 잘라 맞추다 무관한 실재 특허에 도달하는 걸 막는다
    await expect(rightsAlive(makeClient(), { number: "10-2019-0000000" })).rejects.toThrow(
      /존재할 수 없는/
    )
  })

  it("상표 번호는 거절한다", async () => {
    await expect(rightsAlive(makeClient(), { number: "40-2019-0123456" })).rejects.toThrow(/상표/)
  })

  it("최신 법적상태를 함께 돌려준다", async () => {
    const r = await rightsAlive(makeClient(), { number: "10-2019-0123456" })
    if (!("alive" in r)) throw new Error("unexpected")
    expect(r.latest_event?.date).toBe("2021-06-01")
  })
})

describe("rights_alive + 등록원부", () => {
  // 등록원부 실제 응답 형태 (활용가이드 V1.0 확인 완료)
  const LEDGER_JSON = JSON.stringify({
    resultCode: "000",
    resultMsg: "REQUEST_SUCCESS",
    items: {
      rgstNo: "1023456780000",
      cndrtExptnDate: "20440601",
      lastDspst: "등록결정(일반)",
      pay: [{ statAnnl: 4, lastAnnl: 4, payDate: "20270601", payAmount: 236000 }],
      owner: [
        { ownerName: "가나전자", finalOwnerYn: "N" },
        { ownerName: "양수받은주식회사", finalOwnerYn: "Y" },
      ],
    },
    totalCount: 1,
  })

  const ledgerOn = () =>
    new LedgerClient({
      serviceKey: "K",
      cacheTtlSec: 0,
      fetchImpl: (async () => new Response(LEDGER_JSON, { status: 200 })) as unknown as typeof fetch,
    })

  it("확정 만료일이 추정치를 대체한다", async () => {
    const r = await rightsAlive(makeClient(), { number: "10-2019-0123456" }, ledgerOn())
    if (!("alive" in r)) throw new Error("unexpected")
    // 등록원부 없으면 출원일(2019-03-14)+20년 = 2039-03-14 추정
    expect(r.expiry).toBe("2044-06-01")
    expect(r.expiry_estimated).toBe(false)
    expect(r.basis).toMatch(/등록원부 확정값/)
  })

  it("holder가 출원인에서 실제 등록권자로 바뀐다", async () => {
    const r = await rightsAlive(makeClient(), { number: "10-2019-0123456" }, ledgerOn())
    if (!("alive" in r)) throw new Error("unexpected")
    expect(r.holder).toBe("양수받은주식회사")
    expect(r.warnings.join()).not.toMatch(/holder는 출원인 기준/)
  })

  it("연차료 정보가 붙고 '확인 안 됨' 경고가 사라진다", async () => {
    const r = await rightsAlive(makeClient(), { number: "10-2019-0123456" }, ledgerOn())
    if (!("alive" in r)) throw new Error("unexpected")
    expect(r.annual_fee).toEqual({ paid_year: 4, last_paid_date: "2027-06-01", payment_count: 1 })
    expect(r.warnings.join()).not.toMatch(/연차료 납부 여부까지는 확인되지 않았습니다/)
    expect(r.sources).toContain("등록원부")
  })

  it("등록원부가 꺼져 있으면 기존 동작 그대로 + 안내", async () => {
    const off = new LedgerClient({ serviceKey: "" })
    const r = await rightsAlive(makeClient(), { number: "10-2019-0123456" }, off)
    if (!("alive" in r)) throw new Error("unexpected")
    expect(r.expiry_estimated).toBe(true)
    expect(r.annual_fee).toBeNull()
    expect(r.sources).toEqual(["KIPRIS 서지상세"])
    expect(r.warnings.join()).toMatch(/DATA_GO_KR_SERVICE_KEY/)
  })

  it("등록 전 출원은 등록원부를 호출하지 않는다", async () => {
    let called = 0
    const spy = new LedgerClient({
      serviceKey: "K",
      cacheTtlSec: 0,
      fetchImpl: (async () => {
        called++
        return new Response(LEDGER_JSON, { status: 200 })
      }) as unknown as typeof fetch,
    })
    await rightsAlive(makeClient(), { number: "10-2025-0001111" }, spy)
    expect(called).toBe(0)
  })

  it("등록원부가 죽어도 본 판정은 그대로 나온다", async () => {
    const broken = new LedgerClient({
      serviceKey: "K",
      cacheTtlSec: 0,
      fetchImpl: (async () => new Response("", { status: 503 })) as unknown as typeof fetch,
    })
    const r = await rightsAlive(makeClient(), { number: "10-2019-0123456" }, broken)
    if (!("alive" in r)) throw new Error("unexpected")
    expect(r.alive).toBe(true)
    expect(r.expiry_estimated).toBe(true)
  })
})

describe("verify_citations", () => {
  it("정상 인용은 all_clear", async () => {
    const r = await verifyCitations(makeClient(), {
      text: '「무선 충전 장치 및 그 제어 방법」(10-2019-0123456)은 가나전자가 보유한 등록특허입니다.',
      max_citations: 15,
    })
    expect(r.checked).toBe(1)
    expect(r.all_clear).toBe(true)
    expect(r.citations[0]!.verdict).toBe("ok")
  })

  it("실재하지 않는 번호를 잡는다", async () => {
    const r = await verifyCitations(makeClient(), {
      text: "당사는 특허 10-2019-0000000 을 보유하고 있습니다.",
      max_citations: 15,
    })
    expect(r.all_clear).toBe(false)
    expect(r.citations[0]!.verdict).toBe("not_found")
    expect(r.warnings.join()).toMatch(/존재하지 않는 번호/)
  })

  it("번호는 실재하나 명칭이 다른 경우를 잡는다 — 가장 위험한 환각", async () => {
    const r = await verifyCitations(makeClient(), {
      text: '「인공지능 기반 신약 후보물질 탐색 방법」(10-2019-0123456)을 근거로 합니다.',
      max_citations: 15,
    })
    expect(r.citations[0]!.verdict).toBe("title_mismatch")
    expect(r.citations[0]!.actual_title).toBe("무선 충전 장치 및 그 제어 방법")
    expect(r.warnings.join()).toMatch(/명칭 불일치/)
  })

  it("죽은 권리를 유효한 것처럼 쓴 경우를 잡는다", async () => {
    const r = await verifyCitations(makeClient(), {
      text: "당사의 유효 특허 10-2000-0012345 (카세트 테이프 권취 장치)로 보호됩니다.",
      max_citations: 15,
    })
    expect(r.citations[0]!.verdict).toBe("dead")
    expect(r.warnings.join()).toMatch(/소멸/)
  })

  it("등록 전 출원을 등록특허로 쓴 경우를 잡는다", async () => {
    const r = await verifyCitations(makeClient(), {
      text: "등록특허 10-2025-0001111 을 확보했습니다.",
      max_citations: 15,
    })
    expect(r.citations[0]!.verdict).toBe("pending")
  })

  it("여러 건을 한 번에 검증한다", async () => {
    const r = await verifyCitations(makeClient(), {
      text: "10-2019-0123456, 10-2000-0012345, 10-2025-0001111 세 건입니다.",
      max_citations: 15,
    })
    expect(r.checked).toBe(3)
    expect(r.citations.map((x) => x.verdict).sort()).toEqual(["dead", "ok", "pending"])
  })

  it("번호가 없으면 그렇게 말한다", async () => {
    const r = await verifyCitations(makeClient(), { text: "특허 얘기가 전혀 없는 글.", max_citations: 15 })
    expect(r.checked).toBe(0)
    expect(r.all_clear).toBe(false)
    expect(r.summary).toMatch(/찾지 못했습니다/)
  })

  it("max_citations를 넘으면 미확인분을 경고한다", async () => {
    const r = await verifyCitations(makeClient(), {
      text: "10-2019-0123456 10-2000-0012345 10-2025-0001111",
      max_citations: 1,
    })
    expect(r.checked).toBe(1)
    expect(r.total_found).toBe(3)
    expect(r.warnings.join()).toMatch(/미확인/)
  })
})

describe("search_ip", () => {
  const client = () => makeClient({ search: [DEAD, ALIVE, PENDING] })

  it("모든 결과에 alive가 붙는다", async () => {
    const r = await searchIp(client(), { query: "충전", type: "all", alive_only: false, limit: 20 })
    expect(r.results).toHaveLength(3)
    for (const item of r.results) {
      expect(typeof item.alive).toBe("boolean")
      expect(item.status).toBeTruthy()
    }
  })

  it("죽은 권리는 dimmed로 표시된다", async () => {
    const r = await searchIp(client(), { query: "충전", type: "all", alive_only: false, limit: 20 })
    const dead = r.results.find((x) => x.number === "10-2000-0012345")!
    expect(dead.display).toBe("dimmed")
    expect(dead.alive).toBe(false)
  })

  it("살아있는 것이 앞으로 정렬된다", async () => {
    const r = await searchIp(client(), { query: "충전", type: "all", alive_only: false, limit: 20 })
    expect(r.results[0]!.alive).toBe(true)
  })

  it("alive_only로 죽은 것을 숨긴다", async () => {
    const r = await searchIp(client(), { query: "충전", type: "all", alive_only: true, limit: 20 })
    expect(r.results.every((x) => x.alive)).toBe(true)
    expect(r.dead_in_inspected).toBe(2)
    expect(r.notes.join()).toMatch(/숨겼습니다/)
  })

  it("생사 집계는 판정한 건수 기준이다", async () => {
    const r = await searchIp(client(), { query: "충전", type: "all", alive_only: false, limit: 20 })
    expect(r.inspected).toBe(3)
    expect(r.alive_in_inspected).toBe(1)
    expect(r.dead_in_inspected).toBe(2)
  })

  it("전체를 다 못 봤으면 coverage_warning을 채운다", async () => {
    // 응답 3건인데 totalCount가 훨씬 크면 부분 표본이다
    const c = makeClientWithTotal([DEAD, ALIVE, PENDING], 21060)
    const r = await searchIp(c, { query: "브라운관", type: "all", alive_only: false, limit: 20 })
    expect(r.total_matched).toBe(21060)
    expect(r.inspected).toBe(3)
    expect(r.coverage_warning).toMatch(/21,060건 중 3건만 판정/)
  })

  it("표본에 살아있는 게 0건이면 결론내리지 말라고 경고한다", async () => {
    const c = makeClientWithTotal([DEAD], 21060)
    const r = await searchIp(c, { query: "브라운관", type: "all", alive_only: false, limit: 20 })
    expect(r.alive_in_inspected).toBe(0)
    expect(r.coverage_warning).toMatch(/전체에 없다고 결론내리지 마세요/)
  })

  it("전체를 다 봤으면 coverage_warning이 없다", async () => {
    const r = await searchIp(client(), { query: "충전", type: "all", alive_only: false, limit: 20 })
    expect(r.coverage_warning).toBeNull()
  })

  it("출원인 필터가 실제로 안 걸렀으면 그 사실을 알린다", async () => {
    // 상류가 이상하게 동작해 무관한 출원인이 섞여 나오는 상황
    const r = await searchIp(client(), {
      query: "충전",
      type: "all",
      applicant: "삼성",
      alive_only: false,
      limit: 20,
    })
    expect(r.notes.join()).toMatch(/출원인이 이 이름을 포함하지 않습니다/)
    expect(r.notes.join()).toMatch(/holder를 직접 확인/)
  })

  it("출원인이 실제로 일치하면 경고하지 않는다", async () => {
    // ALIVE 픽스처의 출원인은 "가나전자"
    const c = makeClientWithTotal([ALIVE], 1)
    const r = await searchIp(c, {
      query: "충전",
      type: "all",
      applicant: "가나전자",
      alive_only: false,
      limit: 20,
    })
    expect(r.notes.join()).not.toMatch(/포함하지 않습니다/)
  })

  it("공백 차이는 불일치로 보지 않는다", async () => {
    const c = makeClientWithTotal([ALIVE], 1)
    const r = await searchIp(c, {
      query: "충전",
      type: "all",
      applicant: "가나 전자",
      alive_only: false,
      limit: 20,
    })
    expect(r.notes.join()).not.toMatch(/포함하지 않습니다/)
  })
})

describe("KiprisClient", () => {
  it("키가 없으면 명확한 안내와 함께 실패한다", async () => {
    const c = new KiprisClient({ serviceKey: "", fetchImpl: (async () => new Response("")) as unknown as typeof fetch })
    await expect(c.getBiblio("1020190123456")).rejects.toThrow(/서비스 키/)
  })

  it("resultCode가 정상이 아니면 던진다", async () => {
    const c = new KiprisClient({
      serviceKey: "K",
      cacheTtlSec: 0,
      fetchImpl: (async () =>
        new Response(
          "<response><header><resultCode>30</resultCode><resultMsg>SERVICE KEY IS NOT REGISTERED ERROR</resultMsg></header></response>",
          { status: 200 }
        )) as unknown as typeof fetch,
    })
    await expect(c.getBiblio("1020190123456")).rejects.toThrow(/KIPRIS 오류 30/)
  })

  it("같은 요청은 캐시로 상류를 한 번만 때린다", async () => {
    let calls = 0
    const c = new KiprisClient({
      serviceKey: "K",
      cacheTtlSec: 60,
      fetchImpl: (async () => {
        calls++
        return new Response(biblioXml(ALIVE), { status: 200 })
      }) as unknown as typeof fetch,
    })
    await c.getBiblio("1020190123456")
    await c.getBiblio("1020190123456")
    expect(calls).toBe(1)
  })

  it("이미 인코딩된 키를 두 번 인코딩하지 않는다", async () => {
    let seen = ""
    const c = new KiprisClient({
      serviceKey: "abc%2Bdef",
      cacheTtlSec: 0,
      fetchImpl: (async (u: string) => {
        seen = String(u)
        return new Response(EMPTY, { status: 200 })
      }) as unknown as typeof fetch,
    })
    await c.getBiblio("1020190123456")
    expect(seen).toContain("ServiceKey=abc%2Bdef")
    expect(seen).not.toContain("%252B")
  })
})
