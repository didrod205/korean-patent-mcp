import { describe, it, expect } from "vitest"
import { tag, pick, items, isoDate, decodeEntities } from "./xml.js"

const SAMPLE = `<response><body><items>
  <item><applicationNumber>1020190123456</applicationNumber><inventionTitle><![CDATA[무선 충전 장치]]></inventionTitle><registerStatus>등록</registerStatus><openDate/></item>
  <item><applicationNumber>1020200000001</applicationNumber><inventionTitle>배터리</inventionTitle><registerStatus>소멸</registerStatus></item>
</items></body></response>`

describe("tag", () => {
  it("일반 태그", () => expect(tag(SAMPLE, "registerStatus")).toBe("등록"))
  it("CDATA", () => expect(tag(SAMPLE, "inventionTitle")).toBe("무선 충전 장치"))
  it("self-closing은 undefined", () => expect(tag(SAMPLE, "openDate")).toBeUndefined())
  it("없는 태그는 undefined", () => expect(tag(SAMPLE, "nope")).toBeUndefined())
  it("엔티티를 푼다", () => expect(tag("<a>A&amp;B</a>", "a")).toBe("A&B"))
})

describe("pick", () => {
  it("첫 번째로 값 있는 후보를 고른다", () => {
    expect(pick(SAMPLE, "nope", "alsoNope", "registerStatus")).toBe("등록")
  })
  it("전부 없으면 undefined", () => expect(pick(SAMPLE, "a", "b")).toBeUndefined())
  it('문자열 "null"은 값으로 안 친다', () => {
    expect(pick("<a>null</a><b>실제값</b>", "a", "b")).toBe("실제값")
  })
})

describe("items", () => {
  it("반복 요소를 자른다", () => {
    const got = items(SAMPLE, "item")
    expect(got).toHaveLength(2)
    expect(tag(got[1]!, "registerStatus")).toBe("소멸")
  })
})

describe("isoDate", () => {
  it("YYYYMMDD", () => expect(isoDate("20190315")).toBe("2019-03-15"))
  it("점 표기", () => expect(isoDate("2019.03.15")).toBe("2019-03-15"))
  it("빈 값", () => expect(isoDate("")).toBeUndefined())
  it("자릿수 부족", () => expect(isoDate("2019")).toBeUndefined())
  it("월이 이상하면 거절", () => expect(isoDate("20191515")).toBeUndefined())
})

describe("decodeEntities", () => {
  it("숫자 엔티티", () => expect(decodeEntities("&#65;&#66;")).toBe("AB"))
})
