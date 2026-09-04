/**
 * 등록원부 실시간 조회 클라이언트 (공공데이터포털 15124946).
 *
 * KIPRIS Plus와는 별개 API다. 키도 다르고 신청도 따로 한다.
 *   - KIPRIS Plus       → 서지정보·검색 (KIPRIS_SERVICE_KEY)
 *   - 등록원부 실시간조회 → 연차료·존속기간·등록권자 (DATA_GO_KR_SERVICE_KEY)
 *
 * 이걸 붙이면 rights_alive의 가장 큰 한계 두 개가 사라진다:
 *   1. expiry가 "출원일+20년" 추정치가 아니라 확정 만료일이 된다
 *   2. "연차료 납부 여부는 확인 못 했습니다" 경고가 실제 납부 이력으로 바뀐다
 *
 * ── 엔드포인트가 왜 환경변수인가 ──
 * 이 API의 오퍼레이션 경로와 응답 필드명은 공공데이터포털의 PDF
 * ("특허청_등록원부_오픈API활용자가이드_V1.0.pdf") 안에만 있고 웹으로 공개돼 있지 않다.
 * 추측한 URL을 기본값으로 박으면 사용자는 "키가 잘못됐나" 하고 엉뚱한 데를 파게 된다.
 * 그래서 확정 전까지는 명시적으로 받는다. `probe --ledger` 로 한 번에 확인할 수 있다.
 */

import { TtlCache } from "./cache.js"
import { KiprisError } from "./errors.js"
import { pick, isoDate, items } from "./xml.js"

export interface LedgerOptions {
  serviceKey?: string
  endpoint?: string
  cacheTtlSec?: number
  fetchImpl?: typeof fetch
}

/** 등록원부에서 건진, 판정에 실제로 쓰는 사실들. */
export interface LedgerRecord {
  /** 존속기간 만료일 (확정값) */
  expiryDate?: string
  /** 등록권자 — 출원인과 다를 수 있다(양도) */
  rightHolder?: string
  /** 권리 상태 문자열 */
  statusText?: string
  /** 연차료를 낸 마지막 년차 */
  annualFeeYear?: number
  /** 연차료 납부 기한/최종 납부일 */
  annualFeePaidUntil?: string
  /** 원문 — probe 전용. 도구 응답에는 안 싣는다. */
  raw?: string
}

/** 필드명이 확정되지 않았으므로 후보를 넓게 잡는다. 한글·영문 표기 모두. */
const F = {
  expiry: [
    "존속기간만료일자", "존속기간만료일", "권리존속기간만료일", "expirationDate",
    "expireDate", "durationExpirationDate", "rightDuration",
  ],
  holder: [
    "권리자명", "등록권자", "등록권자명", "권리자", "rightHolderName",
    "registrationHolder", "holderName",
  ],
  status: [
    "권리상태", "등록상태", "최종권리상태", "소멸여부", "rightStatus",
    "registerStatus", "legalStatus",
  ],
  feeYear: ["최종납부년차", "납부년차", "연차수", "lastPaymentYear", "annualFeeYear"],
  feePaid: [
    "연차료납부기한", "최종납부일자", "연차료납부일", "차기납부기한",
    "lastPaymentDate", "nextPaymentDeadline",
  ],
} as const

export class LedgerClient {
  private readonly key: string
  private readonly endpoint: string
  private readonly cache: TtlCache<string>
  private readonly doFetch: typeof fetch
  private calls = 0

  constructor(opts: LedgerOptions = {}) {
    this.key = opts.serviceKey ?? process.env["DATA_GO_KR_SERVICE_KEY"] ?? ""
    this.endpoint = (opts.endpoint ?? process.env["LEDGER_ENDPOINT"] ?? "").trim()
    const ttl = opts.cacheTtlSec ?? Number(process.env["KIPRIS_CACHE_TTL"] ?? 3600)
    this.cache = new TtlCache<string>(ttl * 1000)
    this.doFetch = opts.fetchImpl ?? fetch
  }

  /** 키와 엔드포인트가 둘 다 있어야 동작한다. 하나라도 없으면 이 기능은 꺼진 것이다. */
  get enabled(): boolean {
    return this.key.length > 0 && this.endpoint.length > 0
  }

  /** 왜 꺼져 있는지 사람이 읽을 수 있게. rights_alive의 note에 실린다. */
  get disabledReason(): string | null {
    if (this.enabled) return null
    if (!this.key && !this.endpoint) {
      return (
        "등록원부 조회가 설정되지 않아 만료일은 추정치이고 연차료는 확인되지 않았습니다. " +
        "DATA_GO_KR_SERVICE_KEY 와 LEDGER_ENDPOINT 를 설정하면 확정값으로 바뀝니다."
      )
    }
    if (!this.key) return "DATA_GO_KR_SERVICE_KEY 가 없어 등록원부를 조회하지 못했습니다."
    return "LEDGER_ENDPOINT 가 없어 등록원부를 조회하지 못했습니다."
  }

  get callCount(): number {
    return this.calls
  }

  private url(registerNumber: string): string {
    const sep = this.endpoint.includes("?") ? "&" : "?"
    const key = /%[0-9A-Fa-f]{2}/.test(this.key) ? this.key : encodeURIComponent(this.key)
    // 등록번호 파라미터명도 확정 전이라 흔한 표기를 모두 실어 보낸다.
    // 서버는 모르는 파라미터를 무시하므로 이렇게 해도 안전하다.
    const params = [
      `registerNumber=${registerNumber}`,
      `regNo=${registerNumber}`,
      `registrationNumber=${registerNumber}`,
      "numOfRows=10",
      "pageNo=1",
      "type=xml",
    ].join("&")
    return `${this.endpoint}${sep}${params}&serviceKey=${key}`
  }

  /** 원문을 그대로 돌려준다. probe가 필드 목록을 뽑는 데 쓴다. */
  async fetchRaw(registerNumber: string): Promise<string> {
    if (!this.enabled) {
      throw new KiprisError(
        "등록원부 조회가 설정되지 않았습니다.",
        this.disabledReason ?? undefined
      )
    }
    const url = this.url(registerNumber)
    const cached = this.cache.get(url)
    if (cached !== undefined) return cached

    this.calls++
    const res = await this.doFetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/xml, application/json" },
    })
    if (!res.ok) {
      throw new KiprisError(
        `등록원부 조회 실패 (HTTP ${res.status})`,
        res.status === 404
          ? "LEDGER_ENDPOINT 경로가 맞는지 확인하세요. 공공데이터포털 15124946의 " +
            "활용가이드 PDF에 오퍼레이션 경로가 있습니다."
          : "공공데이터포털 마이페이지에서 활용신청 승인 상태를 확인하세요."
      )
    }
    const body = await res.text()

    const code = pick(body, "resultCode", "returnReasonCode", "errorCode")
    if (code && !/^(00|0|000)$/.test(code.trim())) {
      throw new KiprisError(
        `등록원부 오류 ${code}: ${pick(body, "resultMsg", "returnAuthMsg") ?? "알 수 없음"}`,
        "이 API는 KIPRIS Plus와 별개입니다. 공공데이터포털 15124946에 따로 활용신청해야 합니다."
      )
    }

    this.cache.set(url, body)
    return body
  }

  /**
   * 등록번호로 조회한다.
   * @returns 못 찾거나 기능이 꺼져 있으면 null — 던지지 않는다.
   *   등록원부는 부가정보이므로, 여기서 실패해도 rights_alive의 본 판정은 나가야 한다.
   */
  async lookup(registerNumber: string): Promise<LedgerRecord | null> {
    if (!this.enabled) return null
    let body: string
    try {
      body = await this.fetchRaw(registerNumber)
    } catch {
      return null
    }
    return parseLedger(body)
  }
}

/** XML·JSON 어느 쪽으로 와도 읽는다. 이 API는 JSON+XML 둘 다 제공한다. */
export function parseLedger(body: string): LedgerRecord | null {
  const trimmed = body.trim()
  const flat = trimmed.startsWith("{") || trimmed.startsWith("[")
    ? flattenJson(trimmed)
    : null

  const get = (names: readonly string[]): string | undefined => {
    if (flat) {
      for (const n of names) {
        const v = flat.get(n.toLowerCase())
        if (v) return v
      }
      return undefined
    }
    // XML: 반복 블록이 있으면 첫 블록을 우선 본다
    const scope = items(trimmed, "item")[0] ?? trimmed
    return pick(scope, ...names) ?? pick(trimmed, ...names)
  }

  const expiryDate = isoDate(get(F.expiry))
  const rightHolder = get(F.holder)
  const statusText = get(F.status)
  const feeYearRaw = get(F.feeYear)
  const annualFeePaidUntil = isoDate(get(F.feePaid))

  // 하나도 못 읽었으면 빈 레코드를 만들지 않는다 — 못 읽은 걸 읽은 척하면 안 된다.
  if (!expiryDate && !rightHolder && !statusText && !feeYearRaw && !annualFeePaidUntil) {
    return null
  }

  const parsedYear = feeYearRaw ? Number(feeYearRaw.replace(/\D/g, "")) : Number.NaN

  return {
    ...(expiryDate ? { expiryDate } : {}),
    ...(rightHolder ? { rightHolder } : {}),
    ...(statusText ? { statusText } : {}),
    ...(Number.isFinite(parsedYear) && parsedYear > 0 ? { annualFeeYear: parsedYear } : {}),
    ...(annualFeePaidUntil ? { annualFeePaidUntil } : {}),
    raw: body,
  }
}

/** 중첩 JSON을 키 소문자 → 값 문자열의 평평한 맵으로. 응답 구조를 몰라도 값을 찾는다. */
function flattenJson(text: string): Map<string, string> | null {
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return null
  }
  const out = new Map<string, string>()
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const x of node) walk(x)
      return
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (v !== null && typeof v === "object") walk(v)
        else if (v !== null && v !== undefined && String(v) !== "") {
          const key = k.toLowerCase()
          if (!out.has(key)) out.set(key, String(v))
        }
      }
    }
  }
  walk(root)
  return out
}
