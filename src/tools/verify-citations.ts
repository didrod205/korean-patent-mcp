/**
 * verify_citations — "AI가 방금 한 말, 진짜냐"를 검사한다.
 *
 * LLM 답변 텍스트를 통째로 받아서:
 *   1. 특허·실용신안 번호를 전부 추출하고
 *   2. 각 번호를 KIPRIS에 조회해 실재 여부와 생사를 확인하고
 *   3. 텍스트가 주장한 명칭과 실제 명칭을 대조한다.
 *
 * 세 가지 거짓말을 각각 잡는다:
 *   - 없는 번호를 지어냄        → exists: false
 *   - 실재 번호 + 가짜 명칭     → title_match: "mismatch"
 *   - 죽은 권리를 살아있다고 함  → alive: false
 */

import { z } from "zod"
import type { KiprisClient } from "../lib/kipris-client.js"
import { extractNumbers, kiprisUrl } from "../lib/number.js"
import { judge } from "../lib/status.js"
import { compareTitles, extractClaimedTitle, type TitleVerdict } from "../lib/title-match.js"

export const VerifyCitationsSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe(
      "검증할 텍스트 전체. LLM 답변, 보고서, 계약서, IR 자료 등 특허번호가 인용된 문서를 통째로 넣습니다."
    ),
  max_citations: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .default(15)
    .describe("검증할 최대 번호 개수. KIPRIS 무료 등급은 월 1,000회이므로 기본 15로 제한합니다."),
})

export type VerifyCitationsInput = z.infer<typeof VerifyCitationsSchema>

export interface CitationCheck {
  number: string
  /** 원문에 적힌 그대로 */
  cited_as: string
  /** KIPRIS에 실재하는가 */
  exists: boolean
  /** 텍스트가 주장한 명칭 */
  claimed_title: string | null
  /** KIPRIS의 실제 명칭 */
  actual_title: string | null
  title_match: TitleVerdict
  title_similarity: number
  /** 지금 살아있는 권리인가. 실재하지 않으면 null */
  alive: boolean | null
  status: string | null
  stage: string | null
  holder: string | null
  source_url: string
  /** 이 인용에 대한 한 줄 판정 */
  verdict: "ok" | "dead" | "title_mismatch" | "not_found" | "pending" | "unknown"
  note: string | null
}

export interface VerifyCitationsResult {
  checked_at: string
  total_found: number
  checked: number
  /** 하나라도 문제가 있으면 false */
  all_clear: boolean
  citations: CitationCheck[]
  /** 사람이 먼저 읽어야 할 경고 */
  warnings: string[]
  summary: string
}

/** 동시 호출 상한. KIPRIS를 몰아치면 429가 난다. */
const CONCURRENCY = 3

async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, xs.length) }, async () => {
    while (true) {
      const idx = i++
      if (idx >= xs.length) return
      out[idx] = await fn(xs[idx] as T)
    }
  })
  await Promise.all(workers)
  return out
}

export async function verifyCitations(
  client: KiprisClient,
  input: VerifyCitationsInput
): Promise<VerifyCitationsResult> {
  const checked_at = new Date().toISOString().slice(0, 10)
  const found = extractNumbers(input.text, 50)
  const targets = found.slice(0, input.max_citations)

  const citations = await mapLimit(targets, CONCURRENCY, async (n): Promise<CitationCheck> => {
    const claimed = extractClaimedTitle(input.text, n.index, n.match.length)
    const base = {
      number: n.pretty,
      cited_as: n.match,
      claimed_title: claimed ?? null,
      source_url: kiprisUrl(n),
    }

    let rec
    try {
      rec = await client.resolve(n)
    } catch (e) {
      return {
        ...base,
        exists: false,
        actual_title: null,
        title_match: "not_claimed",
        title_similarity: 0,
        alive: null,
        status: null,
        stage: null,
        holder: null,
        verdict: "unknown",
        note: `조회 실패: ${e instanceof Error ? e.message : String(e)}`,
      }
    }

    if (!rec) {
      return {
        ...base,
        exists: false,
        actual_title: null,
        title_match: "not_claimed",
        title_similarity: 0,
        alive: null,
        status: null,
        stage: null,
        holder: null,
        verdict: "not_found",
        note: "KIPRIS에 존재하지 않는 번호입니다. 인용이 지어낸 것일 가능성이 큽니다.",
      }
    }

    const v = judge({
      statusText: rec.registerStatus,
      finalDisposal: rec.finalDisposal,
      registerDate: rec.registerDate,
      applicationDate: rec.applicationDate,
      ip: n.ip,
    })
    const t = compareTitles(claimed, rec.inventionTitle)

    const verdict: CitationCheck["verdict"] =
      t.verdict === "mismatch"
        ? "title_mismatch"
        : v.stage === "소멸" || v.stage === "출원종료"
          ? "dead"
          : v.stage === "출원계속"
            ? "pending"
            : v.stage === "불명"
              ? "unknown"
              : "ok"

    const note =
      verdict === "title_mismatch"
        ? `명칭 불일치. 인용: "${claimed}" / 실제: "${rec.inventionTitle}"`
        : verdict === "dead"
          ? `이미 ${v.status} 상태입니다. 유효한 권리로 인용되었다면 틀린 서술입니다.`
          : verdict === "pending"
            ? "아직 등록 전(출원계속)입니다. '등록특허'로 인용되었다면 틀린 서술입니다."
            : verdict === "unknown"
              ? v.basis
              : t.verdict === "partial"
                ? `명칭이 부분 일치합니다(유사도 ${t.similarity.toFixed(2)}). 축약 인용일 수 있습니다.`
                : null

    return {
      ...base,
      exists: true,
      actual_title: rec.inventionTitle ?? null,
      title_match: t.verdict,
      title_similarity: Number(t.similarity.toFixed(3)),
      alive: v.alive,
      status: v.status,
      stage: v.stage,
      holder: rec.applicantName ?? null,
      verdict,
      note,
    }
  })

  const problems = citations.filter((c) => c.verdict !== "ok")
  const warnings: string[] = []

  const notFound = citations.filter((c) => c.verdict === "not_found")
  const mismatch = citations.filter((c) => c.verdict === "title_mismatch")
  const dead = citations.filter((c) => c.verdict === "dead")
  const pending = citations.filter((c) => c.verdict === "pending")

  if (notFound.length) {
    warnings.push(
      `존재하지 않는 번호 ${notFound.length}건: ${notFound.map((c) => c.number).join(", ")} — 인용이 창작되었을 가능성이 높습니다.`
    )
  }
  if (mismatch.length) {
    warnings.push(
      `명칭 불일치 ${mismatch.length}건: ${mismatch.map((c) => c.number).join(", ")} — 번호는 실재하나 다른 발명입니다.`
    )
  }
  if (dead.length) {
    warnings.push(
      `이미 소멸·종료된 권리 ${dead.length}건: ${dead.map((c) => `${c.number}(${c.status})`).join(", ")}`
    )
  }
  if (pending.length) {
    warnings.push(
      `등록 전 출원 ${pending.length}건: ${pending.map((c) => c.number).join(", ")} — 아직 특허권이 없습니다.`
    )
  }
  if (found.length > targets.length) {
    warnings.push(
      `번호 ${found.length}건 중 ${targets.length}건만 검증했습니다(max_citations=${input.max_citations}). 나머지는 미확인입니다.`
    )
  }

  const summary =
    targets.length === 0
      ? "텍스트에서 특허·실용신안 번호를 찾지 못했습니다. 검증할 인용이 없습니다."
      : problems.length === 0
        ? `인용 ${targets.length}건 전부 실재하고 명칭이 일치하며 권리가 유효합니다.`
        : `인용 ${targets.length}건 중 ${problems.length}건에 문제가 있습니다.`

  return {
    checked_at,
    total_found: found.length,
    checked: targets.length,
    all_clear: targets.length > 0 && problems.length === 0,
    citations,
    warnings,
    summary,
  }
}
