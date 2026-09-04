/**
 * 등록원부 실시간 조회 클라이언트 (공공데이터포털 15124946).
 *
 * KIPRIS Plus와는 별개 API다. 키도 다르고 신청도 따로 한다.
 *   KIPRIS Plus        → 서지정보·검색      (KIPRIS_SERVICE_KEY)
 *   등록원부 실시간조회  → 연차료·존속기간·권리자 (DATA_GO_KR_SERVICE_KEY)
 *
 * 이걸 붙이면 rights_alive의 가장 큰 한계 두 개가 사라진다:
 *   1. expiry가 "출원일+20년" 추정치가 아니라 확정 만료일이 된다(연장등록 반영)
 *   2. "연차료 납부 여부는 확인 못 했습니다" 경고가 실제 납부 이력으로 바뀐다
 *
 * ── 규격 (특허청_등록원부_오픈API활용자가이드 V1.0 확인 완료) ──
 * 서비스: https://apis.data.go.kr/1430000/PttRgstRtInfoInqSvc
 *   특허(10)     /getPatentRegisterHistory   일일 10만
 *   실용신안(20)  /getUtilityModelHistory     일일 100만
 * 디자인(30)·상표(40)용 오퍼레이션도 있으나 이 서버는 다루지 않는다.
 *
 * 필수 파라미터 3개: serviceKey, type(=json), rgstNo(등록번호 13자리).
 * type 을 빼면 rgstNo 가 맞아도 NO_MANDATORY_REQUEST_PARAMETER_ERROR(003)가 난다.
 *
 * 쓰는 응답 필드:
 *   cndrtExptnDate  존속기간만료일
 *   lastDspst       최종처분 ("등록결정(일반)" 등)
 *   owner[]         권리자. finalOwnerYn="Y" 가 현재 권리자 (배열에 이전 권리자도 있다)
 *   pay[]           연차등록정보. lastAnnl(커버 연차)·payDate·payAmount
 */

import { TtlCache } from "./cache.js"
import { KiprisError } from "./errors.js"
import { pick, isoDate, items as xmlItems } from "./xml.js"

/** 공공데이터포털 15124946 — 등록원부 실시간 정보 조회 서비스 */
const DEFAULT_BASE = "https://apis.data.go.kr/1430000/PttRgstRtInfoInqSvc"

/** 권리구분별 오퍼레이션. */
const OPERATION = {
  patent: "getPatentRegisterHistory",
  utility: "getUtilityModelHistory",
} as const

/** 확인 완료. 상류가 바뀔 때를 위해 덮어쓸 수 있게만 둔다. */
const DEFAULT_NUMBER_PARAM = "rgstNo"

export type IpKind = keyof typeof OPERATION

export interface LedgerOptions {
  serviceKey?: string
  /** 서비스 베이스 URL. 오퍼레이션은 권리구분에 따라 자동으로 붙는다. */
  baseUrl?: string
  /** 등록번호 파라미터명 (기본 rgstNo). */
  numberParam?: string
  cacheTtlSec?: number
  fetchImpl?: typeof fetch
}

/** 연차 납부 1건. */
export interface LedgerPayment {
  /** 이 납부가 커버하는 마지막 연차 */
  year: number
  date?: string
  amount?: number
}

/** 등록원부에서 건진, 판정에 실제로 쓰는 사실들. */
export interface LedgerRecord {
  /** 존속기간 만료일 (cndrtExptnDate) — 확정값 */
  expiryDate?: string
  /** 현재 권리자 (finalOwnerYn="Y") */
  rightHolder?: string
  /** 최종처분 (lastDspst) */
  statusText?: string
  /** 연차 납부 이력, 연차 오름차순 */
  payments: LedgerPayment[]
  /** 납부가 확인된 마지막 연차 */
  annualFeeYear?: number
  /** 그 연차의 납입일 */
  annualFeePaidDate?: string
  registerNumber?: string
  applicationNumber?: string
  /** 원문 — probe 전용. 도구 응답에는 싣지 않는다. */
  raw?: string
}

export class LedgerClient {
  private readonly key: string
  private readonly baseUrl: string
  private readonly numberParam: string
  private readonly cache: TtlCache<string>
  private readonly doFetch: typeof fetch
  private calls = 0

  constructor(opts: LedgerOptions = {}) {
    this.key = opts.serviceKey ?? process.env["DATA_GO_KR_SERVICE_KEY"] ?? ""
    this.baseUrl = (opts.baseUrl ?? process.env["LEDGER_BASE_URL"] ?? DEFAULT_BASE).replace(/\/+$/, "")
    this.numberParam = opts.numberParam ?? process.env["LEDGER_NUMBER_PARAM"] ?? DEFAULT_NUMBER_PARAM
    const ttl = opts.cacheTtlSec ?? Number(process.env["KIPRIS_CACHE_TTL"] ?? 3600)
    this.cache = new TtlCache<string>(ttl * 1000)
    this.doFetch = opts.fetchImpl ?? fetch
  }

  /** 엔드포인트는 기본값이 있으므로 키만 있으면 동작한다. */
  get enabled(): boolean {
    return this.key.length > 0
  }

  /** 왜 꺼져 있는지. rights_alive의 warnings에 실린다. */
  get disabledReason(): string | null {
    if (this.enabled) return null
    return (
      "등록원부 조회가 설정되지 않아 만료일은 추정치이고 연차료는 확인되지 않았습니다. " +
      "DATA_GO_KR_SERVICE_KEY 를 설정하면 확정값으로 바뀝니다."
    )
  }

  get callCount(): number {
    return this.calls
  }

  private url(registerNumber: string, ip: IpKind): string {
    const key = /%[0-9A-Fa-f]{2}/.test(this.key) ? this.key : encodeURIComponent(this.key)
    // type 은 필수다. 빼면 rgstNo 가 맞아도 003이 난다.
    const qs = `type=json&${this.numberParam}=${encodeURIComponent(registerNumber)}`
    return `${this.baseUrl}/${OPERATION[ip]}?${qs}&serviceKey=${key}`
  }

  /** 원문을 그대로 돌려준다. probe가 필드 목록을 뽑는 데 쓴다. */
  async fetchRaw(registerNumber: string, ip: IpKind = "patent"): Promise<string> {
    if (!this.enabled) {
      throw new KiprisError("등록원부 조회가 설정되지 않았습니다.", this.disabledReason ?? undefined)
    }
    const url = this.url(registerNumber, ip)
    const cached = this.cache.get(url)
    if (cached !== undefined) return cached

    this.calls++
    const res = await this.doFetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/json, application/xml" },
    })
    if (!res.ok) {
      throw new KiprisError(
        `등록원부 조회 실패 (HTTP ${res.status})`,
        res.status === 404
          ? "LEDGER_BASE_URL 경로를 확인하세요."
          : "공공데이터포털 마이페이지에서 활용신청 승인 상태를 확인하세요."
      )
    }
    const body = await res.text()

    // 이 API는 오류도 HTTP 200 + resultCode 로 준다.
    const code = readResultCode(body)
    if (code && !/^0*$/.test(code)) {
      const msg = readResultMsg(body) ?? "알 수 없음"
      throw new KiprisError(
        `등록원부 오류 ${code}: ${msg}`,
        code === "003"
          ? "필수 파라미터(type, rgstNo)가 빠졌습니다."
          : "이 API는 KIPRIS Plus와 별개입니다. 공공데이터포털 15124946에 따로 활용신청해야 합니다."
      )
    }

    this.cache.set(url, body)
    return body
  }

  /**
   * 등록번호로 조회한다.
   * @returns 못 찾거나 기능이 꺼져 있으면 null — 던지지 않는다.
   *   등록원부는 부가정보다. 여기서 실패해도 rights_alive의 본 판정은 나가야 한다.
   */
  async lookup(registerNumber: string, ip: IpKind = "patent"): Promise<LedgerRecord | null> {
    if (!this.enabled) return null
    try {
      return parseLedger(await this.fetchRaw(registerNumber, ip))
    } catch {
      return null
    }
  }
}

function readResultCode(body: string): string | undefined {
  if (body.trimStart().startsWith("{")) {
    const m = body.match(/"resultCode"\s*:\s*"?([^",}]+)/)
    return m?.[1]?.trim()
  }
  return pick(body, "resultCode", "returnReasonCode")
}

function readResultMsg(body: string): string | undefined {
  if (body.trimStart().startsWith("{")) {
    const m = body.match(/"resultMsg"\s*:\s*"([^"]*)"/)
    return m?.[1]
  }
  return pick(body, "resultMsg", "returnAuthMsg")
}

/**
 * 등록원부 응답 파싱. 기본은 JSON(type=json)이다.
 *
 * 확정 필드만 읽는다. 못 읽은 값을 추측으로 채우지 않는다 —
 * 여기서 지어낸 값은 "확정 만료일"이라는 이름을 달고 나가므로 추정치보다 나쁘다.
 */
export function parseLedger(body: string): LedgerRecord | null {
  const trimmed = body.trim()
  if (!trimmed.startsWith("{")) return parseLedgerXml(trimmed)

  let root: Record<string, unknown>
  try {
    root = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
  const code = String(root["resultCode"] ?? "")
  if (code && !/^0*$/.test(code)) return null

  const raw = root["items"]
  const items = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined
  if (!items || typeof items !== "object") return null

  const str = (k: string): string | undefined => {
    const v = items[k]
    return v === null || v === undefined || v === "" ? undefined : String(v)
  }

  const payments = readPayments(items["pay"])
  const last = payments[payments.length - 1]
  const expiry = isoDate(str("cndrtExptnDate"))
  const holder = readFinalOwner(items["owner"])
  const status = str("lastDspst")

  if (!expiry && !holder && !status && payments.length === 0) return null

  return {
    payments,
    ...(expiry ? { expiryDate: expiry } : {}),
    ...(holder ? { rightHolder: holder } : {}),
    ...(status ? { statusText: status } : {}),
    ...(last ? { annualFeeYear: last.year } : {}),
    ...(last?.date ? { annualFeePaidDate: last.date } : {}),
    ...(str("rgstNo") ? { registerNumber: str("rgstNo")! } : {}),
    ...(str("applNo") ? { applicationNumber: str("applNo")! } : {}),
    raw: body,
  }
}

function readPayments(raw: unknown): LedgerPayment[] {
  const rows = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[]
  const out: LedgerPayment[] = []
  for (const r of rows) {
    const year = Number(r["lastAnnl"])
    if (!Number.isFinite(year) || year <= 0) continue
    const date = isoDate(r["payDate"] == null ? undefined : String(r["payDate"]))
    const amount = Number(r["payAmount"])
    out.push({ year, ...(date ? { date } : {}), ...(Number.isFinite(amount) ? { amount } : {}) })
  }
  return out.sort((a, b) => a.year - b.year)
}

/**
 * 권리자는 finalOwnerYn="Y" 인 사람이 현재 권리자다.
 * 배열에는 이전 권리자도 함께 들어 있어서 첫 항목을 그냥 쓰면 양도 전 이름이 나온다.
 */
function readFinalOwner(raw: unknown): string | undefined {
  const rows = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[]
  if (rows.length === 0) return undefined
  const final = rows.find((o) => String(o["finalOwnerYn"] ?? "").toUpperCase() === "Y")
  const name = (final ?? rows[rows.length - 1])?.["ownerName"]
  return name ? String(name) : undefined
}

/** type=xml 로 받았거나 상류가 XML을 줄 때의 경로. */
function parseLedgerXml(xml: string): LedgerRecord | null {
  if (!xml.startsWith("<")) return null
  const scope = xmlItems(xml, "items")[0] ?? xml
  const expiry = isoDate(pick(scope, "cndrtExptnDate"))
  const holder = pick(scope, "ownerName")
  const status = pick(scope, "lastDspst")

  const payments: LedgerPayment[] = []
  for (const block of xmlItems(xml, "pay")) {
    const year = Number(pick(block, "lastAnnl") ?? "")
    if (!Number.isFinite(year) || year <= 0) continue
    const date = isoDate(pick(block, "payDate"))
    payments.push({ year, ...(date ? { date } : {}) })
  }
  payments.sort((a, b) => a.year - b.year)
  const last = payments[payments.length - 1]

  if (!expiry && !holder && !status && payments.length === 0) return null
  return {
    payments,
    ...(expiry ? { expiryDate: expiry } : {}),
    ...(holder ? { rightHolder: holder } : {}),
    ...(status ? { statusText: status } : {}),
    ...(last ? { annualFeeYear: last.year } : {}),
    ...(last?.date ? { annualFeePaidDate: last.date } : {}),
    raw: xml,
  }
}
