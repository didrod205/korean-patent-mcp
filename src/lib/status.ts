/**
 * 생사 판정 엔진.
 *
 * 이 서버의 실체는 이 파일이다. 나머지는 전부 배관이다.
 *
 * 판정 원칙 세 가지:
 *  1. "등록"이라는 글자만 보고 살아있다고 하지 않는다. 등록된 뒤 소멸한 권리가
 *     압도적으로 많고, 그게 정확히 사람들이 틀리는 지점이다.
 *  2. 출원계속(공개·심사중)은 살아있는 권리가 아니다. 아직 태어나지 않았다.
 *     alive=false지만 stage로 "소멸"과 구분한다 — FTO 관점에서 둘은 정반대 신호다.
 *  3. 모르면 모른다고 한다. 판정 근거(basis)를 항상 같이 돌려준다.
 */

export type Stage =
  | "등록유효"    // 등록되었고 존속기간 내
  | "소멸"        // 등록되었다가 죽음 (존속기간만료·연차료불납·무효·포기·취소)
  | "출원계속"    // 아직 등록 전 (출원·공개·심사중) — 권리 미발생
  | "출원종료"    // 등록 못 하고 끝남 (거절·취하·출원포기)
  | "불명"        // 상태 문자열을 해석하지 못함

export interface StatusJudgment {
  /** 지금 이 순간 행사 가능한 특허권/실용신안권이 존재하는가 */
  alive: boolean
  stage: Stage
  /** 사람이 읽는 상태 문자열. 예: "소멸(연차료 불납)" */
  status: string
  /** 무엇을 보고 그렇게 판정했는지 */
  basis: string
  /** 판정을 뒤집을 수 있는 사정 */
  warnings: string[]
}

/**
 * 죽음을 뜻하는 어휘. 순서가 곧 우선순위 — 먼저 걸리는 것이 이긴다.
 * "등록"과 함께 나타나는 경우가 많아서("등록 → 소멸"), 죽음 어휘를 먼저 본다.
 */
const DEAD_PATTERNS: ReadonlyArray<{ re: RegExp; stage: Stage; label: string }> = [
  { re: /연차료|등록료.{0,4}불납|미납/, stage: "소멸", label: "소멸(연차료 불납)" },
  { re: /존속기간\s*만료|기간만료/, stage: "소멸", label: "소멸(존속기간 만료)" },
  { re: /무효/, stage: "소멸", label: "소멸(무효)" },
  { re: /취소/, stage: "소멸", label: "소멸(취소)" },
  { re: /말소|실효/, stage: "소멸", label: "소멸(말소)" },
  { re: /소멸/, stage: "소멸", label: "소멸" },
  { re: /거절/, stage: "출원종료", label: "거절" },
  { re: /취하/, stage: "출원종료", label: "취하" },
  { re: /포기/, stage: "출원종료", label: "포기" },
]

/** 아직 등록 전. 권리 미발생. */
const PENDING_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /심사청구|심사중|심사대기/, label: "출원계속(심사중)" },
  { re: /재심사|거절결정불복/, label: "출원계속(불복심판)" },
  { re: /공고/, label: "출원계속(등록결정공고)" },
  { re: /공개/, label: "출원계속(공개)" },
  { re: /출원/, label: "출원계속" },
]

/** 등록 상태. 죽음·계속 어휘가 하나도 안 걸렸을 때만 여기까지 온다. */
const REGISTERED_RE = /등록|설정등록|특허결정/

export interface JudgeInput {
  /** KIPRIS registerStatus 등 상태 문자열 (원문 그대로) */
  statusText?: string
  /** 최종처분 문자열 (있으면 상태보다 강한 신호) */
  finalDisposal?: string
  /** 등록일 YYYY-MM-DD */
  registerDate?: string
  /** 출원일 YYYY-MM-DD */
  applicationDate?: string
  /** API가 알려준 존속기간 만료일 YYYY-MM-DD */
  expiryDate?: string
  /** 특허 20년 / 실용신안 10년 */
  ip: "patent" | "utility"
  /** 판정 기준일 (테스트 주입용). 기본 오늘 */
  today?: Date
}

export interface StatusResult extends StatusJudgment {
  /** 확정 또는 추정된 존속기간 만료일 */
  expiry?: string
  /** expiry가 API 확정값이 아니라 출원일+존속기간으로 계산한 추정치인지 */
  expiryEstimated: boolean
}

function toDate(s?: string): Date | undefined {
  if (!s) return undefined
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** 출원일 + 존속기간. 특허 20년, 실용신안 10년 (특허법 §88①, 실용신안법 §22①). */
export function estimateExpiry(applicationDate: string, ip: "patent" | "utility"): string | undefined {
  const d = toDate(applicationDate)
  if (!d) return undefined
  const years = ip === "patent" ? 20 : 10
  const e = new Date(d)
  e.setUTCFullYear(e.getUTCFullYear() + years)
  return fmt(e)
}

export function judge(input: JudgeInput): StatusResult {
  const today = input.today ?? new Date()
  const warnings: string[] = []

  // 최종처분이 있으면 그게 상태 문자열보다 강한 신호다.
  const primary = (input.finalDisposal || "").trim()
  const secondary = (input.statusText || "").trim()
  const haystack = `${primary} ${secondary}`.trim()

  if (!haystack) {
    return {
      alive: false,
      stage: "불명",
      status: "상태 정보 없음",
      basis: "API 응답에 상태 필드가 비어 있음",
      warnings: ["생사를 판정할 수 없습니다. KIPRIS 웹에서 직접 확인하세요."],
      expiryEstimated: false,
    }
  }

  // 존속기간 만료일 확정/추정
  let expiry = input.expiryDate
  let expiryEstimated = false
  if (!expiry && input.applicationDate) {
    expiry = estimateExpiry(input.applicationDate, input.ip)
    expiryEstimated = expiry !== undefined
  }

  // 1) 죽음 어휘 우선
  for (const p of DEAD_PATTERNS) {
    if (p.re.test(haystack)) {
      return {
        alive: false,
        stage: p.stage,
        status: p.label,
        basis: `상태 문자열 "${haystack}"에서 ${p.stage} 신호 검출`,
        warnings,
        expiry,
        expiryEstimated,
      }
    }
  }

  // 2) 등록 — 여기서 존속기간을 반드시 다시 본다.
  //    KIPRIS 상태가 "등록"에 머물러 있어도 만료일이 지났으면 그 권리는 죽었다.
  if (REGISTERED_RE.test(haystack)) {
    const exp = toDate(expiry)
    if (exp && exp.getTime() < today.getTime()) {
      return {
        alive: false,
        stage: "소멸",
        status: "소멸(존속기간 만료)",
        basis: expiryEstimated
          ? `상태는 "${haystack}"이나 출원일 기준 존속기간(${expiry})이 이미 지남`
          : `상태는 "${haystack}"이나 존속기간 만료일(${expiry})이 이미 지남`,
        warnings: expiryEstimated
          ? [
              "만료일은 출원일 + 법정 존속기간으로 계산한 추정치입니다. " +
                "존속기간 연장등록(의약품·농약)이 있으면 실제 만료일은 더 뒤입니다.",
            ]
          : warnings,
        expiry,
        expiryEstimated,
      }
    }

    if (expiryEstimated) {
      warnings.push(
        "만료일은 출원일 + 법정 존속기간으로 계산한 추정치입니다(연장등록 미반영)."
      )
    }
    warnings.push(
      "등록 상태여도 연차료 납부 여부까지는 확인되지 않았습니다. " +
        "실제 거래·소송 전에는 등록원부를 확인하세요."
    )

    return {
      alive: true,
      stage: "등록유효",
      status: expiry ? `등록유효 (만료예정 ${expiry})` : "등록유효",
      basis: `상태 문자열 "${haystack}" + 존속기간 미도래`,
      warnings,
      expiry,
      expiryEstimated,
    }
  }

  // 3) 출원계속 — 아직 권리가 아니다
  for (const p of PENDING_PATTERNS) {
    if (p.re.test(haystack)) {
      return {
        alive: false,
        stage: "출원계속",
        status: p.label,
        basis: `상태 문자열 "${haystack}" — 등록 전 단계`,
        warnings: [
          "아직 등록되지 않아 특허권이 발생하지 않았습니다(alive=false). " +
            "다만 소멸한 것이 아니라 심사가 진행 중이므로, 장래 등록되어 권리가 생길 수 있습니다.",
        ],
        expiry,
        expiryEstimated,
      }
    }
  }

  // 4) 해석 실패
  return {
    alive: false,
    stage: "불명",
    status: haystack,
    basis: `상태 문자열 "${haystack}"을 등록/소멸/출원계속 어디로도 분류하지 못함`,
    warnings: ["판정 규칙이 이 상태값을 모릅니다. 원문 상태를 그대로 확인하세요."],
    expiry,
    expiryEstimated,
  }
}
