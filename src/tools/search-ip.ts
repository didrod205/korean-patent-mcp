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
  applicant: z.string().optional().describe("출원인명으로 좁히기. 예: '삼성전자'"),
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
  total_matched: number
  returned: number
  alive_count: number
  dead_count: number
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
    register_number: hit.registerNumber ?? null,
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

  return {
    query: input.query,
    total_matched: total,
    returned: results.length,
    alive_count: aliveCount,
    dead_count: all.length - aliveCount,
    checked_at,
    results,
    notes,
  }
}
