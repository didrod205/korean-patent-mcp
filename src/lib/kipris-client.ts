/**
 * KIPRIS Plus REST API 클라이언트.
 *
 * 엔드포인트 (특허·실용신안 정보검색 서비스):
 *   {base}/patUtiModInfoSearchSevice/getBibliographyDetailInfoSearch  서지상세 + 법적상태
 *   {base}/patUtiModInfoSearchSevice/getAdvancedSearch                 항목별 검색
 *   {base}/patUtiModInfoSearchSevice/getWordSearch                     자유어 검색
 *
 * 서비스명의 "Sevice" 오타는 KIPRIS 원본 그대로다. 고치면 404가 난다.
 */

import { TtlCache } from "./cache.js"
import { KiprisError, MissingKeyError } from "./errors.js"
import { items, pick, isoDate } from "./xml.js"
import type { ParsedNumber } from "./number.js"

const DEFAULT_BASE = "https://plus.kipris.or.kr/kipo-api/kipi"
const SERVICE = "patUtiModInfoSearchSevice"
const TIMEOUT_MS = 15_000
const MAX_RETRIES = 2

export interface ClientOptions {
  serviceKey?: string
  baseUrl?: string
  cacheTtlSec?: number
  fetchImpl?: typeof fetch
}

/** 서지상세에서 뽑아낸, 판정에 필요한 최소 사실들. */
export interface BiblioRecord {
  applicationNumber?: string
  applicationDate?: string
  inventionTitle?: string
  registerNumber?: string
  registerDate?: string
  registerStatus?: string
  finalDisposal?: string
  openNumber?: string
  openDate?: string
  publicationDate?: string
  applicantName?: string
  ipcNumber?: string
  abstract?: string
  /** 법적상태 이력 (최신순). 갱신 지연 측정과 소멸 사유 확인에 쓴다. */
  legalEvents: LegalEvent[]
  /** 응답 원문 — probe/디버깅용. 도구 응답에는 싣지 않는다. */
  rawXml?: string
}

export interface LegalEvent {
  date?: string
  code?: string
  description?: string
}

export interface SearchHit {
  applicationNumber?: string
  applicationDate?: string
  inventionTitle?: string
  registerNumber?: string
  registerDate?: string
  registerStatus?: string
  applicantName?: string
  ipcNumber?: string
  abstract?: string
}

export interface SearchQuery {
  word?: string
  applicant?: string
  inventionTitle?: string
  dateFrom?: string
  dateTo?: string
  patent?: boolean
  utility?: boolean
  pageNo?: number
  numOfRows?: number
}

export class KiprisClient {
  private readonly baseUrl: string
  private readonly rawKey: string
  private readonly cache: TtlCache<string>
  private readonly doFetch: typeof fetch
  /** 이번 프로세스에서 실제로 상류를 때린 횟수 — 무료 1,000회/월 소진 감시용 */
  private upstreamCalls = 0

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl || process.env.KIPRIS_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "")
    this.rawKey = opts.serviceKey ?? process.env.KIPRIS_SERVICE_KEY ?? ""
    const ttl = opts.cacheTtlSec ?? Number(process.env.KIPRIS_CACHE_TTL ?? 3600)
    this.cache = new TtlCache<string>(ttl * 1000)
    this.doFetch = opts.fetchImpl ?? fetch
  }

  get hasKey(): boolean {
    return this.rawKey.length > 0
  }

  get callCount(): number {
    return this.upstreamCalls
  }

  /**
   * data.go.kr은 인증키를 Encoding/Decoding 두 형태로 준다.
   * Decoding 키는 인코딩해야 하고, Encoding 키를 또 인코딩하면 %2B가 %252B가 되어 죽는다.
   * 이미 %XX 이스케이프가 들어 있으면 인코딩된 키로 보고 그대로 쓴다.
   */
  private encodedKey(): string {
    if (!this.rawKey) throw new MissingKeyError()
    return /%[0-9A-Fa-f]{2}/.test(this.rawKey) ? this.rawKey : encodeURIComponent(this.rawKey)
  }

  private buildUrl(operation: string, params: Record<string, string | number | boolean | undefined>): string {
    const qs: string[] = []
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === "" ) continue
      qs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    }
    // ServiceKey는 이미 인코딩 상태이므로 직접 붙인다
    qs.push(`ServiceKey=${this.encodedKey()}`)
    return `${this.baseUrl}/${SERVICE}/${operation}?${qs.join("&")}`
  }

  /** 원시 XML을 받아온다. 캐시·재시도·resultCode 검사 포함. */
  async request(
    operation: string,
    params: Record<string, string | number | boolean | undefined>
  ): Promise<string> {
    const url = this.buildUrl(operation, params)
    const cacheKey = url

    const cached = this.cache.get(cacheKey)
    if (cached !== undefined) return cached

    let lastErr: unknown
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)))
      }
      try {
        this.upstreamCalls++
        const res = await this.doFetch(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { Accept: "application/xml" },
        })

        if (res.status === 429) {
          throw new KiprisError(
            "KIPRIS 호출 한도를 초과했습니다 (HTTP 429).",
            "KIPRIS Plus 마이페이지에서 호출 한도와 잔여량을 확인하세요."
          )
        }
        if (res.status >= 500) {
          lastErr = new KiprisError(`KIPRIS 서버 오류 (HTTP ${res.status})`)
          continue // 재시도
        }
        if (!res.ok) {
          throw new KiprisError(`KIPRIS 요청 실패 (HTTP ${res.status})`)
        }

        const xml = await res.text()
        this.assertOk(xml)
        this.cache.set(cacheKey, xml)
        return xml
      } catch (e) {
        if (e instanceof KiprisError && !/서버 오류/.test(e.message)) throw e
        lastErr = e
        if (e instanceof Error && e.name === "TimeoutError") continue
        if (attempt === MAX_RETRIES) break
      }
    }

    throw new KiprisError(
      `KIPRIS 호출에 ${MAX_RETRIES + 1}회 모두 실패했습니다.`,
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    )
  }

  /** 응답 봉투의 resultCode를 검사한다. 200 OK + 에러코드가 KIPRIS의 기본 실패 형태다. */
  private assertOk(xml: string): void {
    const code = pick(xml, "resultCode", "returnReasonCode", "errorCode")
    const msg = pick(xml, "resultMsg", "returnAuthMsg", "errMsg", "errorMessage")

    if (code && !/^(00|0|000)$/.test(code.trim())) {
      const hint =
        /SERVICE_KEY|SERVICE KEY|인증|AUTH|등록되지/i.test(`${code} ${msg ?? ""}`)
          ? "서비스 키가 잘못되었거나 이 API에 대한 활용신청이 승인되지 않았습니다. " +
            "KIPRIS Plus 마이페이지 > 서비스 신청 현황에서 \"특허실용신안 정보검색\"이 승인됐는지 확인하세요. " +
            "다른 KIPRIS 서비스 키로는 이 엔드포인트가 열리지 않습니다."
          : /LIMITED|초과|EXCEED/i.test(`${code} ${msg ?? ""}`)
            ? "일일/월간 호출 한도를 초과했습니다."
            : undefined
      throw new KiprisError(`KIPRIS 오류 ${code}${msg ? `: ${msg}` : ""}`, hint)
    }

    if (/<OpenAPI_ServiceResponse>/.test(xml) && /<returnReasonCode>/.test(xml)) {
      throw new KiprisError(
        `KIPRIS 게이트웨이 오류: ${pick(xml, "returnAuthMsg") ?? "알 수 없음"}`,
        "대부분 서비스 키 문제입니다."
      )
    }
  }

  // -------------------------------------------------------------------------
  // 서지상세 — rights_alive의 주 경로
  // -------------------------------------------------------------------------

  async getBiblio(applicationNumber: string): Promise<BiblioRecord | null> {
    const xml = await this.request("getBibliographyDetailInfoSearch", { applicationNumber })
    return parseBiblio(xml)
  }

  /**
   * 등록번호로 출원번호를 찾는다.
   * 서지상세는 출원번호만 받으므로, 등록번호 입력은 한 단계 우회가 필요하다.
   */
  async findByRegisterNumber(registerNumber: string): Promise<SearchHit | null> {
    const xml = await this.request("getAdvancedSearch", {
      registerNumber,
      patent: true,
      utility: true,
      numOfRows: 5,
      pageNo: 1,
    })
    const hits = parseHits(xml)
    return hits[0] ?? null
  }

  /** 번호 종류를 가리지 않고 서지상세까지 도달한다. */
  async resolve(n: ParsedNumber): Promise<BiblioRecord | null> {
    if (n.kind === "application") {
      return this.getBiblio(n.normalized)
    }
    const hit = await this.findByRegisterNumber(n.normalized)
    if (!hit?.applicationNumber) return null
    return this.getBiblio(hit.applicationNumber.replace(/\D/g, ""))
  }

  // -------------------------------------------------------------------------
  // 검색 — search_ip
  // -------------------------------------------------------------------------

  async search(q: SearchQuery): Promise<{ total: number; hits: SearchHit[] }> {
    const useAdvanced = Boolean(q.applicant || q.inventionTitle || q.dateFrom || q.dateTo)
    const numOfRows = q.numOfRows ?? 20
    const pageNo = q.pageNo ?? 1

    const xml = useAdvanced
      ? await this.request("getAdvancedSearch", {
          word: q.word,
          applicant: q.applicant,
          inventionTitle: q.inventionTitle,
          applicationDate: buildDateRange(q.dateFrom, q.dateTo),
          patent: q.patent ?? true,
          utility: q.utility ?? true,
          numOfRows,
          pageNo,
        })
      : await this.request("getWordSearch", {
          word: q.word,
          patent: q.patent ?? true,
          utility: q.utility ?? true,
          numOfRows,
          pageNo,
        })

    return {
      total: Number(pick(xml, "totalCount", "count", "totalCnt") ?? 0),
      hits: parseHits(xml),
    }
  }
}

/** KIPRIS 항목별 검색의 날짜 범위 표기: YYYYMMDD~YYYYMMDD */
function buildDateRange(from?: string, to?: string): string | undefined {
  if (!from && !to) return undefined
  const f = (from ?? "19480101").replace(/\D/g, "").padEnd(8, "0")
  const t = (to ?? new Date().toISOString().slice(0, 10)).replace(/\D/g, "")
  return `${f}~${t}`
}

// ---------------------------------------------------------------------------
// 파서 — 필드명은 후보 목록으로 잡는다 (서비스별 표기 흔들림 흡수)
// ---------------------------------------------------------------------------

export function parseBiblio(xml: string): BiblioRecord | null {
  const summaryBlocks = items(xml, "biblioSummaryInfo")
  const scope = summaryBlocks[0] ?? xml

  const applicationNumber = pick(scope, "applicationNumber", "applicationNo")
  const inventionTitle = pick(scope, "inventionTitle", "inventionName", "articleName")

  // 출원번호도 명칭도 없으면 빈 응답이다 — 없는 걸 있는 척하지 않는다.
  if (!applicationNumber && !inventionTitle) return null

  const applicantBlocks = items(xml, "applicantInfo")
  const applicantName =
    applicantBlocks
      .map((b) => pick(b, "name", "applicantName"))
      .filter((v): v is string => Boolean(v))
      .join(", ") || pick(xml, "applicantName", "applicant")

  const abstractBlock = items(xml, "abstractInfo")[0]
  const ipcBlock = items(xml, "ipcInfo")[0]

  return {
    applicationNumber,
    applicationDate: isoDate(pick(scope, "applicationDate", "applicationDay")),
    inventionTitle,
    registerNumber: pick(scope, "registerNumber", "registrationNumber"),
    registerDate: isoDate(pick(scope, "registerDate", "registrationDate")),
    registerStatus: pick(scope, "registerStatus", "registrationStatus", "lastValue"),
    finalDisposal: pick(scope, "finalDisposal", "finalDisposalCode"),
    openNumber: pick(scope, "openNumber"),
    openDate: isoDate(pick(scope, "openDate")),
    publicationDate: isoDate(pick(scope, "publicationDate")),
    applicantName,
    ipcNumber: ipcBlock ? pick(ipcBlock, "ipcNumber", "ipcCode") : pick(xml, "ipcNumber"),
    abstract: abstractBlock ? pick(abstractBlock, "astrtCont", "abstractText") : undefined,
    legalEvents: parseLegalEvents(xml),
    rawXml: xml,
  }
}

export function parseLegalEvents(xml: string): LegalEvent[] {
  const blocks = items(xml, "legalStatusInfo")
  return blocks
    .map((b) => ({
      date: isoDate(pick(b, "receiptDate", "documentDate", "date")),
      code: pick(b, "documentNumber", "receiptNumber", "code"),
      description: pick(b, "registerStatus", "documentName", "description", "content"),
    }))
    .filter((e) => e.date || e.description)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
}

export function parseHits(xml: string): SearchHit[] {
  return items(xml, "item").map((b) => ({
    applicationNumber: pick(b, "applicationNumber", "applicationNo"),
    applicationDate: isoDate(pick(b, "applicationDate")),
    inventionTitle: pick(b, "inventionTitle", "inventionName", "articleName"),
    registerNumber: pick(b, "registerNumber", "registrationNumber"),
    registerDate: isoDate(pick(b, "registerDate")),
    registerStatus: pick(b, "registerStatus", "registrationStatus", "lastValue"),
    applicantName: pick(b, "applicantName", "applicant"),
    ipcNumber: pick(b, "ipcNumber"),
    abstract: pick(b, "astrtCont", "abstractText"),
  }))
}
