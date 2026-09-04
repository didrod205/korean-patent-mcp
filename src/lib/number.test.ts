import { describe, it, expect } from "vitest"
import { parseNumber, tryParseNumber, extractNumbers, digitsOnly, NumberParseError } from "./number.js"

describe("parseNumber", () => {
  it("하이픈 있는 출원번호", () => {
    const n = parseNumber("10-2019-0123456")
    expect(n.kind).toBe("application")
    expect(n.ip).toBe("patent")
    expect(n.normalized).toBe("1020190123456")
    expect(n.pretty).toBe("10-2019-0123456")
    expect(n.year).toBe(2019)
  })

  it("하이픈 없는 출원번호", () => {
    expect(parseNumber("1020190123456").pretty).toBe("10-2019-0123456")
  })

  it("실용신안 출원번호", () => {
    const n = parseNumber("20-2020-0001234")
    expect(n.ip).toBe("utility")
    expect(n.kind).toBe("application")
  })

  it("등록번호 9자리", () => {
    const n = parseNumber("10-1234567")
    expect(n.kind).toBe("registration")
    expect(n.normalized).toBe("101234567")
    expect(n.pretty).toBe("10-1234567")
  })

  it("등록번호 + 부기번호 13자리 — 중간이 연도로 안 읽히면 등록번호", () => {
    const n = parseNumber("1012345670000")
    expect(n.kind).toBe("registration")
    expect(n.normalized).toBe("101234567")
  })

  it("13자리 등록번호+부기번호(뒤 4자리 0000)는 '등록' 힌트로 갈린다", () => {
    // 1019990000000: 연도로 읽히지만 뒤 4자리가 0000이라 등록번호+부기일 수 있다
    const n = parseNumber("등록번호 1019990000000")
    expect(n.kind).toBe("registration")
    expect(n.pretty).toBe("10-1999000")
  })

  it("출원번호 형태가 명확하면 '등록'이라는 말이 앞에 있어도 출원번호로 읽는다", () => {
    // "등록특허 10-2025-0001111" — 실무·LLM 출력에서 흔한 표기.
    // 여기서 힌트를 따르면 멀쩡한 번호가 조회 불가가 된다.
    const n = parseNumber("등록특허 10-2025-0001111")
    expect(n.kind).toBe("application")
    expect(n.normalized).toBe("1020250001111")
  })

  it("일련번호가 0으로 시작하지 않으면 등록번호+부기로 읽는다", () => {
    // 1023456780000: 연도 자리가 2345라 연도로도 안 읽힌다
    expect(parseNumber("1023456780000").kind).toBe("registration")
  })

  it("전각 숫자와 유니코드 하이픈", () => {
    expect(parseNumber("１０‑２０１９‑０１２３４５６").normalized).toBe("1020190123456")
  })

  it("상표·디자인은 명시적으로 거절", () => {
    expect(() => parseNumber("40-2019-0123456")).toThrow(NumberParseError)
    expect(() => parseNumber("30-2019-0123456")).toThrow(/디자인/)
    expect(() => parseNumber("40-2019-0123456")).toThrow(/상표/)
  })

  it("알 수 없는 권리구분", () => {
    expect(() => parseNumber("99-2019-0123456")).toThrow(/권리구분/)
  })

  it("자릿수가 틀리면 거절", () => {
    expect(() => parseNumber("10-123")).toThrow(/자릿수/)
  })

  it("빈 입력", () => {
    expect(() => parseNumber("   ")).toThrow(/비어/)
  })

  it("tryParseNumber는 던지지 않는다", () => {
    expect(tryParseNumber("쓰레기")).toBeNull()
  })
})

describe("digitsOnly", () => {
  it("전각 숫자를 반각으로", () => {
    expect(digitsOnly("１０-２０１９")).toBe("102019")
  })
})

describe("extractNumbers", () => {
  it("문장 속 출원번호를 뽑는다", () => {
    const got = extractNumbers("본 기술은 특허 10-2019-0123456 및 20-2020-0001234 에 기반합니다.")
    expect(got.map((g) => g.pretty)).toEqual(["10-2019-0123456", "20-2020-0001234"])
  })

  it("등록번호 표기", () => {
    const got = extractNumbers("등록특허 제10-1234567호를 보유하고 있습니다.")
    expect(got).toHaveLength(1)
    expect(got[0]!.kind).toBe("registration")
  })

  it("구분자 없는 13자리", () => {
    expect(extractNumbers("출원번호 1020190123456").map((g) => g.pretty)).toEqual(["10-2019-0123456"])
  })

  it("중복 번호는 한 번만", () => {
    const got = extractNumbers("10-2019-0123456 ... 다시 10-2019-0123456")
    expect(got).toHaveLength(1)
  })

  it("상표·디자인 번호는 무시", () => {
    expect(extractNumbers("상표 40-2019-0123456 만 있음")).toHaveLength(0)
  })

  it("일반 숫자를 특허번호로 오인하지 않는다", () => {
    expect(extractNumbers("전화 02-1234-5678, 금액 1,000,000원, 날짜 2019-01-15")).toHaveLength(0)
  })

  it("한 번호가 두 패턴에 겹쳐 잡히지 않는다", () => {
    const got = extractNumbers("10-2019-0123456")
    expect(got).toHaveLength(1)
    expect(got[0]!.kind).toBe("application")
  })

  it("max로 개수를 제한한다", () => {
    const text = Array.from({ length: 10 }, (_, i) => `10-2019-012345${i}`).join(" ")
    expect(extractNumbers(text, 3)).toHaveLength(3)
  })
})
