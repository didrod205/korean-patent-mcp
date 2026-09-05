/**
 * search_ip — 검색. 단, 모든 결과에 alive를 강제로 붙인다.
 *
 * 기존 KIPRIS MCP들과 갈리는 지점이 정확히 여기다. 검색 결과를 그대로 흘려보내면
 * LLM은 20년 전에 소멸한 특허를 "선행기술로 유효하다"고 쓴다.
 * 그래서 여기서는 alive 없는 hit를 반환하지 않는다.
 *
 * 검색 결과의 registerStatus만으로 판정하므로 hit당 추가 API 호출은 없다.
 * 정밀 판정이 필요하면 그 번호로 rights_alive를 부르면 된다.
 */

import { z } from "zod"
import type { KiprisClient, SearchHit } from "../lib/kipris-client.js"
import { tryParseNumber, kiprisUrl } from "../lib/number.js"
import { judge } from "../lib/status.js"

export const SearchIpSchema = z.object({
  query: z.string().min(1).describe("검색어. 기술 키워드나 발명의 명칭. 예: '무선 충전 코일 정렬'"),
  type: z
    .enum(["patent", "utility", "all"])
    .optional()
    .default("all")
    .describe("권리 종류. patent=특허, utility=실용신안, all=둘 다(기본)"),
  applicant: z
    .string()
    .optional()
    .describe(
      "출원인명으로 좁히기. 부분 명칭도 동작합니다 — '삼성'은 삼성전자·삼성에스디아이를 모두 잡습니다. " +
        "특정 법인만 원하면 '삼성전자주식회사'처럼 정식 명칭을 쓰세요."
    ),
  date_from: z
    .string()
    .optional()
    .describe("출원일 하한 YYYY-MM-DD 또는 YYYYMMDD"),
  date_to: z.string().optional().describe("출원일 상한 YYYY-MM-DD 또는 YYYYMMDD"),
  alive_only: z
    .boolean()
    .optional()
    .default(false)
    .describe("true면 살아있는 권리만 반환합니다. 기본 false — 죽은 것도 보여주되 표시합니다."),
  limit: z.number().int().min(1).max(50).optional().default(20).describe("최대 결과 수(기본 20)"),
})

export type SearchIpInput = z.infer<typeof SearchIpSchema>

export interface SearchResultItem {
  alive: boolean
  status: string
  stage: string
  /** 죽은 권리는 dimmed — 클라이언트가 회색 처리할 수 있게 */
  display: "normal" | "dimmed"
  number: string
  title: string | null
  holder: string | null
  application_date: string | null
  register_number: string | null
  expiry: string | null
  expiry_estimated: boolean
  raw_status: string | null
  source_url: string
}

export interface SearchIpResult {
  query: string
  /** KIPRIS가 보고한 전체 매칭 건수 */
  total_matched: number
  /** 이번 호출에서 실제로 생사를 판정한 건수. 아래 집계는 전부 이 범위 안의 수치다. */
  inspected: number
  returned: number
  /** inspected 안에서 살아있는 건수. 전체(total_matched) 기준이 아니다. */
  alive_in_inspected: number
  /** inspected 안에서 죽은 건수. 전체(total_matched) 기준이 아니다. */
  dead_in_inspected: number
  /**
   * 전체를 다 보지 못했을 때 채워진다.
   * "살아있는 게 0건"을 "그런 특허가 없다"로 읽는 오독을 막기 위한 필드다.
   */
  coverage_warning: string | null
  checked_at: string
  results: SearchResultItem[]
  notes: string[]
}

function toItem(hit: SearchHit): SearchResultItem | null {
  const appNo = hit.applicationNumber
  if (!appNo) return null
  const parsed = tryParseNumber(appNo)
  if (!parsed) return null

  const v = judge({
    statusText: hit.registerStatus,
    applicationDate: hit.applicationDate,
    registerDate: hit.registerDate,
    ip: parsed.ip,
  })

  return {
    alive: v.alive,
    status: v.status,
    stage: v.stage,
    display: v.alive ? "normal" : "dimmed",
    number: parsed.pretty,
    title: hit.inventionTitle ?? null,
    holder: hit.applicantName ?? null,
    application_date: hit.applicationDate ?? null,
    register_number: hit.registerNumber
      ? (tryParseNumber(hit.registerNumber, "registration")?.pretty ?? hit.registerNumber)
      : null,
    expiry: v.expiry ?? null,
    expiry_estimated: v.expiryEstimated,
    raw_status: hit.registerStatus ?? null,
    source_url: kiprisUrl(parsed),
  }
}

export async function searchIp(client: KiprisClient, input: SearchIpInput): Promise<SearchIpResult> {
  const checked_at = new Date().toISOString().slice(0, 10)

  const { total, hits } = await client.search({
    word: input.query,
    applicant: input.applicant,
    dateFrom: input.date_from,
    dateTo: input.date_to,
    patent: input.type === "all" || input.type === "patent",
    utility: input.type === "all" || input.type === "utility",
    numOfRows: input.limit,
    pageNo: 1,
  })

  const all = hits.map(toItem).filter((x): x is SearchResultItem => x !== null)
  // 살아있는 것을 먼저, 그 안에서 출원일 최신순
  all.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1
    return (b.application_date ?? "").localeCompare(a.application_date ?? "")
  })

  const aliveCount = all.filter((r) => r.alive).length
  const results = input.alive_only ? all.filter((r) => r.alive) : all

  const notes: string[] = [
    "생사 판정은 검색 결과의 등록상태 문자열에 근거합니다. " +
      "특정 건을 근거로 삼기 전에 그 번호로 rights_alive를 호출해 확정하세요.",
  ]
  if (all.length < hits.length) {
    notes.push(`응답 ${hits.length}건 중 ${hits.length - all.length}건은 출원번호를 읽지 못해 제외했습니다.`)
  }
  if (input.alive_only && aliveCount < all.length) {
    notes.push(`alive_only=true — 소멸·출원계속 ${all.length - aliveCount}건을 숨겼습니다.`)
  }

  // 전체를 다 본 게 아니라는 사실을 집계 옆에 붙여둔다.
  // "21,060건 중 10건을 보고 alive 0건"을 "유효 특허 없음"으로 읽으면
  // 이 서버가 없애려던 종류의 오답이 그대로 재생산된다.
  const partial = total > all.length
  const coverage_warning = partial
    ? `전체 ${total.toLocaleString("en-US")}건 중 ${all.length}건만 판정했습니다. ` +
      `alive_in_inspected/dead_in_inspected는 이 ${all.length}건 안의 수치이며 전체 분포가 아닙니다.` +
      (aliveCount === 0
        ? " 이 표본에 살아있는 권리가 없다고 해서 전체에 없다고 결론내리지 마세요 — " +
          "limit을 늘리거나 검색어를 좁혀 다시 확인하세요."
        : "")
    : null

  // KIPRIS 출원인 검색은 부분 명칭도 받는다("삼성" → 삼성전자·삼성에스디아이).
  // 그래도 결과를 실제로 세어본다 — 상류 동작이 바뀌거나 예상 못 한 매칭이 섞이면
  // 사용자는 좁혀진 결과라고 믿은 채 틀린 결론을 낸다. 안 걸러졌으면 그 사실을 말한다.
  if (input.applicant && all.length > 0) {
    const needle = input.applicant.replace(/\s+/g, "")
    const mismatched = all.filter(
      (r) => !(r.holder ?? "").replace(/\s+/g, "").includes(needle)
    ).length
    if (mismatched > 0) {
      notes.push(
        `출원인 "${input.applicant}" 로 걸렀으나 판정한 ${all.length}건 중 ${mismatched}건의 출원인이 이 이름을 포함하지 않습니다. ` +
          `표기 차이(법인격 표기·띄어쓰기·영문명)일 수 있으니 결과의 holder를 직접 확인하세요.`
      )
    }
  }

  return {
    query: input.query,
    total_matched: total,
    inspected: all.length,
    returned: results.length,
    alive_in_inspected: aliveCount,
    dead_in_inspected: all.length - aliveCount,
    coverage_warning,
    checked_at,
    results,
    notes,
  }
}
