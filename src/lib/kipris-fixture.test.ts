/**
 * KIPRIS 공식 문서의 실제 응답 샘플로 고정하는 회귀 테스트.
 *
 * 출처: KIPRIS Plus "특허·실용 공개·등록공보" > 일반검색 > getWordSearch 출력값(샘플)
 *
 * 이 파일이 존재하는 이유: 날짜 형식을 YYYYMMDD로 가정했다가
 * 실제 응답이 "1985/12/30 00:00:00"인 걸 놓쳤다. 그러면 출원일이 통째로 버려지고
 * 존속기간 만료 판정이 조용히 죽는다. 실제 응답을 박아두면 같은 실수가 반복되지 않는다.
 */
import { describe, it, expect } from "vitest"
import { parseHits } from "./kipris-client.js"
import { isoDate, splitMulti } from "./xml.js"
import { parseNumber } from "./number.js"
import { judge } from "./status.js"

const OFFICIAL_SAMPLE = `<response>
<header>
<requestMsgID></requestMsgID>
<responseTime>2014-10-30 16:25:03.253</responseTime>
<responseMsgID></responseMsgID>
<successYN></successYN>
<resultCode>00</resultCode>
<resultMsg>NORMAL SERVICE.</resultMsg></header>
<body>
<items>
<item><applicantName>이두수</applicantName>
<applicationDate>1985/12/30 00:00:00</applicationDate>
<applicationNumber>1019850010013</applicationNumber>
<astrtCont>내용 없음.</astrtCont>
<bigDrawing></bigDrawing>
<drawing></drawing>
<indexNo>1</indexNo>
<inventionTitle>회전체의센서와센서의엔코더(SENSOR AND SENSOR ENCODER FOR
                    ROTATOR)</inventionTitle>
<ipcNumber>G01D 5/00</ipcNumber>
<openDate>1987/07/11 00:00:00</openDate>
<openNumber>1019870006388</openNumber>
<publicationDate>1989/06/30 00:00:00</publicationDate>
<publicationNumber>1019890002319</publicationNumber>
<registerDate>1990/02/28 00:00:00</registerDate>
<registerNumber>1000319440000</registerNumber>
<registerStatus>소멸</registerStatus></item>
<item><applicantName>스나미사다가쓰</applicantName>
<applicationDate>1988/09/23 00:00:00</applicationDate>
<applicationNumber>1019880012313</applicationNumber>
<astrtCont>내용 없음</astrtCont>
<indexNo>2</indexNo>
<inventionTitle>자동차도난방지시스템</inventionTitle>
<ipcNumber>B60R 25/00 | B60R 25/01</ipcNumber>
<openDate>1990/04/12 00:00:00</openDate>
<openNumber>1019900004564</openNumber>
<registerDate>1991/12/19 00:00:00</registerDate>
<registerNumber>1000470810000</registerNumber>
<registerStatus>소멸</registerStatus></item>
</items>
</body>
<count><numOfRows>10</numOfRows>
<pageNo>1</pageNo>
<totalCount>414120</totalCount></count>
</response>`

describe("공식 샘플 응답 파싱", () => {
  const hits = parseHits(OFFICIAL_SAMPLE)

  it("item 2건을 읽는다", () => {
    expect(hits).toHaveLength(2)
  })

  it('"1985/12/30 00:00:00" 형식의 날짜를 버리지 않는다', () => {
    // 이 한 줄이 존속기간 만료 판정 전체를 지탱한다
    expect(hits[0]!.applicationDate).toBe("1985-12-30")
    expect(hits[0]!.registerDate).toBe("1990-02-28")
    expect(hits[1]!.applicationDate).toBe("1988-09-23")
  })

  it("발명의명칭에 줄바꿈·들여쓰기가 섞여도 읽는다", () => {
    expect(hits[0]!.inventionTitle).toContain("회전체의센서와센서의엔코더")
  })

  it("IPC 복수값을 | 로 쪼갠다", () => {
    expect(hits[1]!.ipcNumber).toBe("B60R 25/00, B60R 25/01")
    expect(hits[0]!.ipcNumber).toBe("G01D 5/00")
  })

  it("출원인명과 등록상태를 읽는다", () => {
    expect(hits[0]!.applicantName).toBe("이두수")
    expect(hits[0]!.registerStatus).toBe("소멸")
  })

  it("13자리 출원번호와 등록번호+부기번호를 각각 맞게 읽는다", () => {
    const app = parseNumber(hits[0]!.applicationNumber!)
    expect(app.kind).toBe("application")
    expect(app.pretty).toBe("10-1985-0010013")

    // 1000319440000 = 등록번호 10-0031944 + 부기 0000
    const reg = parseNumber(hits[0]!.registerNumber!)
    expect(reg.kind).toBe("registration")
    expect(reg.pretty).toBe("10-0031944")
  })

  it("소멸 건을 살아있다고 하지 않는다", () => {
    for (const h of hits) {
      const v = judge({
        statusText: h.registerStatus,
        applicationDate: h.applicationDate,
        registerDate: h.registerDate,
        ip: "patent",
      })
      expect(v.alive).toBe(false)
      expect(v.stage).toBe("소멸")
    }
  })
})

describe("문서에 명시된 registerStatus 7개 값", () => {
  // KIPRIS 문서: "공개, 등록, 거절, 무효, 소멸, 취하, 포기"
  const DOCUMENTED = ["공개", "등록", "거절", "무효", "소멸", "취하", "포기"] as const

  it("7개 값 모두 불명으로 떨어지지 않는다", () => {
    const unclassified = DOCUMENTED.filter(
      (s) => judge({ statusText: s, applicationDate: "2015-01-01", ip: "patent" }).stage === "불명"
    )
    expect(unclassified).toEqual([])
  })

  it("살아있는 값은 등록 하나뿐이다", () => {
    const alive = DOCUMENTED.filter(
      (s) => judge({ statusText: s, applicationDate: "2015-01-01", ip: "patent" }).alive
    )
    expect(alive).toEqual(["등록"])
  })

  it("소멸·무효는 소멸로, 거절·취하·포기는 출원종료로, 공개는 출원계속으로 갈린다", () => {
    const stage = (s: string) =>
      judge({ statusText: s, applicationDate: "2015-01-01", ip: "patent" }).stage
    expect(stage("소멸")).toBe("소멸")
    expect(stage("무효")).toBe("소멸")
    expect(stage("거절")).toBe("출원종료")
    expect(stage("취하")).toBe("출원종료")
    expect(stage("포기")).toBe("출원종료")
    expect(stage("공개")).toBe("출원계속")
  })
})

describe("isoDate — 실제로 관측되는 형식들", () => {
  it("YYYY/MM/DD HH:MM:SS (공보 검색)", () => {
    expect(isoDate("1985/12/30 00:00:00")).toBe("1985-12-30")
  })
  it("YYYYMMDD (서지상세)", () => expect(isoDate("19851230")).toBe("1985-12-30"))
  it("YYYY.MM.DD", () => expect(isoDate("1985.12.30")).toBe("1985-12-30"))
  it("YYYY-MM-DD", () => expect(isoDate("1985-12-30")).toBe("1985-12-30"))
  it("빈 값·짧은 값은 undefined", () => {
    expect(isoDate("")).toBeUndefined()
    expect(isoDate("1985")).toBeUndefined()
  })
  it("연도가 말이 안 되면 버린다", () => expect(isoDate("00001230")).toBeUndefined())
  it("월/일이 말이 안 되면 버린다", () => expect(isoDate("19851330")).toBeUndefined())
})

describe("splitMulti", () => {
  it('"|" 로 쪼개 ", " 로 잇는다', () => {
    expect(splitMulti("A | B|C")).toBe("A, B, C")
  })
  it("단일값은 그대로", () => expect(splitMulti("A")).toBe("A"))
  it("빈 값은 undefined", () => expect(splitMulti("")).toBeUndefined())
})
