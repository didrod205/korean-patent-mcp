/**
 * 도구 등록부. 도구는 3개다. 늘리지 않는다.
 *
 * 도구가 늘어나면 LLM이 어느 걸 부를지 헷갈리기 시작하고, 그 순간
 * "권리 생사 판정"이라는 이 서버의 유일한 약속이 흐려진다.
 * fto_screen·상표·디자인·해외특허는 여기 없다. 의도한 부재다.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"

import type { KiprisClient } from "./lib/kipris-client.js"
import { toToolError } from "./lib/errors.js"
import { RightsAliveSchema, rightsAlive } from "./tools/rights-alive.js"
import { VerifyCitationsSchema, verifyCitations } from "./tools/verify-citations.js"
import { SearchIpSchema, searchIp } from "./tools/search-ip.js"

const TOOLS: Tool[] = [
  {
    name: "rights_alive",
    description:
      "특허·실용신안 번호 하나를 받아 그 권리가 지금 살아있는지 판정합니다. " +
      "등록 여부만 보지 않고 소멸·무효·포기·존속기간 만료까지 반영해 alive를 냅니다. " +
      "특허를 근거로 어떤 주장을 하기 전에 반드시 이 도구로 확인하세요. " +
      "출원번호(10-2019-0123456)와 등록번호(10-1234567) 둘 다 받습니다.",
    inputSchema: {
      type: "object",
      properties: {
        number: {
          type: "string",
          description:
            "특허·실용신안 출원번호 또는 등록번호. 하이픈 유무 무관. 특허 10-, 실용신안 20- 로 시작.",
        },
      },
      required: ["number"],
    },
  },
  {
    name: "verify_citations",
    description:
      "텍스트에 인용된 특허번호가 진짜인지 통째로 검증합니다. " +
      "번호를 모두 추출해 KIPRIS에 실재하는지, 적힌 명칭이 실제 명칭과 같은지, " +
      "그 권리가 아직 살아있는지를 한 번에 대조합니다. " +
      "LLM이 생성한 기술 문서·IR 자료·특허 분석 보고서를 그대로 넣어 환각을 잡아내는 용도입니다.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "검증할 텍스트 전체. 특허번호가 인용된 문서를 통째로 넣습니다.",
        },
        max_citations: {
          type: "number",
          description: "검증할 최대 번호 개수(1~30, 기본 15). KIPRIS 무료 등급 월 1,000회를 고려한 상한.",
          default: 15,
        },
      },
      required: ["text"],
    },
  },
  {
    name: "search_ip",
    description:
      "특허·실용신안을 키워드로 검색합니다. 모든 결과에 생사(alive) 판정이 붙어서 나오며, " +
      "소멸한 권리는 display:\"dimmed\"로 표시됩니다. " +
      "선행기술 조사나 경쟁사 포트폴리오 파악에 쓰되, 특정 건을 근거로 삼기 전에는 " +
      "그 번호로 rights_alive를 다시 호출해 확정하세요.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "검색어. 기술 키워드나 발명의 명칭." },
        type: {
          type: "string",
          enum: ["patent", "utility", "all"],
          description: "권리 종류. 기본 all.",
          default: "all",
        },
        applicant: { type: "string", description: "출원인명으로 좁히기. 예: 삼성전자" },
        date_from: { type: "string", description: "출원일 하한 YYYY-MM-DD" },
        date_to: { type: "string", description: "출원일 상한 YYYY-MM-DD" },
        alive_only: {
          type: "boolean",
          description: "true면 살아있는 권리만. 기본 false(죽은 것도 표시해서 보여줌).",
          default: false,
        },
        limit: { type: "number", description: "최대 결과 수(1~50, 기본 20)", default: 20 },
      },
      required: ["query"],
    },
  },
]

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] }
}

function fail(e: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(toToolError(e), null, 2) }],
    isError: true,
  }
}

export function registerTools(server: Server, client: KiprisClient): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    try {
      switch (name) {
        case "rights_alive":
          return ok(await rightsAlive(client, RightsAliveSchema.parse(args ?? {})))
        case "verify_citations":
          return ok(await verifyCitations(client, VerifyCitationsSchema.parse(args ?? {})))
        case "search_ip":
          return ok(await searchIp(client, SearchIpSchema.parse(args ?? {})))
        default:
          return fail(new Error(`알 수 없는 도구: ${name}. 이 서버의 도구는 rights_alive, verify_citations, search_ip 3개입니다.`))
      }
    } catch (e) {
      return fail(e)
    }
  })
}
