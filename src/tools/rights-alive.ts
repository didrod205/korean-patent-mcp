/**
 * rights_alive — 이 서버의 1번 도구이자 존재 이유.
 *
 * 출원번호나 등록번호 하나를 받아서 "그 권리가 지금 살아있는가"에 답한다.
 * 그 이상은 하지 않는다.
 */

import { z } from "zod"
import type { KiprisClient } from "../lib/kipris-client.js"
import type { LedgerClient } from "../lib/ledger-client.js"
import { parseNumber, kiprisUrl, type ParsedNumber } from "../lib/number.js"
import { judge } from "../lib/status.js"

export const RightsAliveSchema = z.object({
  number: z
    .string()
    .min(1)
    .describe(
      "특허·실용신안 출원번호 또는 등록번호. " +
        "출원번호 10-2019-0123456, 등록번호 10-1234567 형태. 하이픈 없어도 됩니다. " +
        "특허(10-)·실용신안(20-)만 지원하며 상표(40-)·디자인(30-)은 거절합니다."
    ),
})

export type RightsAliveInput = z.infer<typeof RightsAliveSchema>

export interface RightsAliveResult {
  /** 지금 이 순간 행사 가능한 권리가 존재하는가 */
  alive: boolean
  /** 사람이 읽는 상태. 예: "소멸(연차료 불납)" */
  status: string
  /** 등록유효 / 소멸 / 출원계속 / 출원종료 / 불명 — alive만으로는 안 갈리는 구분 */
  stage: string
  number: string
  title: string | null
  holder: string | null
  /** 존속기간 만료일 */
  expiry: string | null
  /** expiry가 출원일+법정기간으로 계산한 추정치인지 */
  expiry_estimated: boolean
  application_date: string | null
  register_number: string | null
  register_date: string | null
  /** KIPRIS 원문 상태 문자열 — 판정을 못 믿겠으면 이걸 본다 */
  raw_status: string | null
  /** 무엇을 보고 판정했는지 */
  basis: string
  /** 판정을 뒤집을 수 있는 사정 */
  warnings: string[]
  /** KIPRIS에 기록된 최신 법적상태 이벤트 날짜. 데이터 지연 가늠자. */
  latest_event: { date: string | null; description: string | null } | null
  /**
   * 등록원부에서 확인한 연차료 정보. 등록원부 조회가 꺼져 있거나
   * 등록번호가 없으면 null — "확인 못 했다"와 "안 냈다"는 다르다.
   */
  annual_fee: {
    /** 납부가 확인된 마지막 연차 */
    paid_year: number | null
    /** 그 연차의 납입일 */
    last_paid_date: string | null
    /** 확인된 납부 건수 */
    payment_count: number
  } | null
  /** 이 판정이 어떤 소스를 봤는지 */
  sources: string[]
  checked_at: string
  source_url: string
}

export async function rightsAlive(
  client: KiprisClient,
  input: RightsAliveInput,
  ledger?: LedgerClient
): Promise<RightsAliveResult | { error: string; hint?: string; number: string; checked_at: string }> {
  const checked_at = new Date().toISOString().slice(0, 10)
  const parsed: ParsedNumber = parseNumber(input.number)

  const rec = await client.resolve(parsed)

  if (!rec) {
    return {
      error: `KIPRIS에 ${parsed.pretty} 에 해당하는 특허·실용신안이 없습니다.`,
      hint:
        "번호를 다시 확인하세요. 존재하지 않는 번호라면, 이 번호를 인용한 문서는 " +
        "출처를 지어낸 것일 수 있습니다.",
      number: parsed.pretty,
      checked_at,
    }
  }

  // 등록원부는 등록번호가 있을 때만 의미가 있다.
  // 출원 중인 건은 원부 자체가 없으므로 호출하지 않는다 — 낭비다.
  const ledgerRec =
    ledger?.enabled && rec.registerNumber
      ? await ledger.lookup(rec.registerNumber.replace(/\D/g, ""), parsed.ip)
      : null

  const verdict = judge({
    statusText: rec.registerStatus,
    finalDisposal: rec.finalDisposal,
    registerDate: rec.registerDate,
    applicationDate: rec.applicationDate,
    // 등록원부의 확정 만료일이 있으면 추정을 쓰지 않는다.
    // 존속기간 연장등록(의약품·농약)이 반영된 값이라 추정보다 항상 정확하다.
    ...(ledgerRec?.expiryDate ? { expiryDate: ledgerRec.expiryDate } : {}),
    ip: parsed.ip,
  })

  const latest = rec.legalEvents[0]
  const sources = ["KIPRIS 서지상세"]
  const warnings = [...verdict.warnings]

  if (ledgerRec) {
    sources.push("등록원부")
    // 등록원부가 연차료를 알려줬으면 "확인 못 했다" 경고를 실제 정보로 대체한다.
    if (ledgerRec.annualFeeYear || ledgerRec.annualFeePaidDate) {
      const idx = warnings.findIndex((w) => /연차료 납부 여부까지는 확인되지 않았습니다/.test(w))
      if (idx !== -1) warnings.splice(idx, 1)
    }
  } else if (ledger && !ledger.enabled) {
    const reason = ledger.disabledReason
    if (reason) warnings.push(reason)
  }

  // holder는 등록원부의 등록권자가 있으면 그걸 쓴다. 출원인은 양도 전 이름이다.
  const holder = ledgerRec?.rightHolder ?? rec.applicantName ?? null
  if (!ledgerRec?.rightHolder && rec.applicantName) {
    warnings.push(
      "holder는 출원인 기준입니다. 등록 후 권리가 양도되었으면 현재 권리자와 다를 수 있습니다."
    )
  }

  return {
    alive: verdict.alive,
    status: verdict.status,
    stage: verdict.stage,
    number: parsed.pretty,
    title: rec.inventionTitle ?? null,
    holder,
    expiry: verdict.expiry ?? null,
    expiry_estimated: verdict.expiryEstimated,
    application_date: rec.applicationDate ?? null,
    register_number: rec.registerNumber ?? null,
    register_date: rec.registerDate ?? null,
    raw_status: rec.registerStatus ?? rec.finalDisposal ?? null,
    basis: ledgerRec?.expiryDate
      ? `${verdict.basis} (만료일은 등록원부 확정값)`
      : verdict.basis,
    warnings,
    latest_event: latest
      ? { date: latest.date ?? null, description: latest.description ?? null }
      : null,
    annual_fee:
      ledgerRec && (ledgerRec.annualFeeYear || ledgerRec.annualFeePaidDate)
        ? {
            paid_year: ledgerRec.annualFeeYear ?? null,
            last_paid_date: ledgerRec.annualFeePaidDate ?? null,
            payment_count: ledgerRec.payments.length,
          }
        : null,
    sources,
    checked_at,
    source_url: kiprisUrl(parsed),
  }
}
