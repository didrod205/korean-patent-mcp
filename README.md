# korean-patent-mcp

**특허 출원번호나 기술 설명을 넣으면, 그 권리가 지금 살아있는지를 판정해서 돌려주는 MCP 서버.**

KIPRIS Plus 기반. 도구는 3개다. 늘리지 않는다.

```bash
npx korean-patent-mcp@latest setup
```

---

## 왜 필요한가

LLM에게 특허를 물으면 세 가지 방식으로 틀린다.

| 거짓말 | 이 서버가 잡는 법 |
|---|---|
| 없는 특허번호를 지어낸다 | `exists: false` |
| 실재하는 번호에 엉뚱한 명칭을 붙인다 | `title_match: "mismatch"` |
| **20년 전에 소멸한 특허를 유효하다고 쓴다** | `alive: false` |

세 번째가 제일 위험하다. 번호도 실재하고 명칭도 맞는데, 그 권리는 이미 죽어 있다.
검색만 하는 도구는 이걸 절대 못 잡는다. 그래서 이 서버는 **검색 결과에도 `alive`를 강제로 붙인다.**

---

## 이렇게 물어보면 된다

설치하고 나면 클라이언트에서 그냥 한국어로 물으면 된다.

> **"10-2019-0123456 이 특허 아직 살아있어?"**

> **"이 IR 자료에 적힌 특허번호들 진짜인지 전부 확인해줘"** *(문서를 그대로 붙여넣기)*

> **"무선 충전 코일 정렬 관련 국내 특허 중에 아직 유효한 것만 찾아줘"**

---

## 도구 3개

### 1. `rights_alive(number)`

번호 하나 → 생사 판정. 이 서버의 존재 이유.

```json
{
  "alive": false,
  "status": "소멸(연차료 불납)",
  "stage": "소멸",
  "number": "10-2000-0012345",
  "title": "카세트 테이프 권취 장치",
  "holder": "다라산업",
  "expiry": "2020-05-10",
  "expiry_estimated": true,
  "raw_status": "소멸(연차료 불납)",
  "basis": "상태 문자열 \"소멸(연차료 불납)\"에서 소멸 신호 검출",
  "warnings": ["holder는 출원인 기준입니다. 등록 후 권리가 양도되었으면 현재 권리자와 다를 수 있습니다."],
  "latest_event": { "date": "2020-08-01", "description": "연차료 불납에 의한 소멸" },
  "checked_at": "2026-09-04",
  "source_url": "https://www.kipris.or.kr/khome/search/searchResult.do?tab=patent&query=10-2000-0012345"
}
```

**`alive`만 보지 말고 `stage`도 보라.** `alive: false`에는 정반대 두 가지가 섞여 있다.

| stage | alive | 뜻 |
|---|---|---|
| `등록유효` | `true` | 지금 행사 가능한 권리 |
| `소멸` | `false` | 있었는데 죽었다 (연차료 불납·존속기간 만료·무효·취소) |
| `출원종료` | `false` | 등록 못 하고 끝났다 (거절·취하·포기) |
| `출원계속` | `false` | **아직 안 태어났다.** 심사 중이라 장래 등록될 수 있다 |
| `불명` | `false` | 상태값을 해석 못 했다. `raw_status`를 직접 보라 |

FTO 관점에서 `소멸`은 안전 신호이고 `출원계속`은 위험 신호다. 둘 다 `alive: false`지만 의미가 반대다.

### 2. `verify_citations(text)`

LLM 답변을 통째로 넣으면 인용된 특허번호를 전부 검증한다.

```json
{
  "all_clear": false,
  "total_found": 3,
  "checked": 3,
  "citations": [
    {
      "number": "10-2019-0123456",
      "cited_as": "10-2019-0123456",
      "exists": true,
      "claimed_title": "인공지능 기반 신약 후보물질 탐색 방법",
      "actual_title": "무선 충전 장치 및 그 제어 방법",
      "title_match": "mismatch",
      "title_similarity": 0.04,
      "alive": true,
      "verdict": "title_mismatch",
      "note": "명칭 불일치. 인용: \"인공지능 기반 신약 후보물질 탐색 방법\" / 실제: \"무선 충전 장치 및 그 제어 방법\""
    }
  ],
  "warnings": ["명칭 불일치 1건: 10-2019-0123456 — 번호는 실재하나 다른 발명입니다."],
  "summary": "인용 3건 중 1건에 문제가 있습니다."
}
```

`verdict`는 `ok` / `dead` / `title_mismatch` / `not_found` / `pending` / `unknown` 중 하나다.

### 3. `search_ip(query, ...)`

검색. 단, **모든 결과에 `alive`가 붙는다.** 죽은 권리는 `display: "dimmed"`로 표시되고 뒤로 정렬된다.

```json
{
  "query": "무선 충전 코일 정렬",
  "total_matched": 412,
  "alive_count": 7,
  "dead_count": 13,
  "results": [
    { "alive": true,  "display": "normal", "status": "등록유효 (만료예정 2039-03-14)", "number": "10-2019-0123456", "…": "…" },
    { "alive": false, "display": "dimmed", "status": "소멸(존속기간 만료)",           "number": "10-2001-0009999", "…": "…" }
  ],
  "notes": ["생사 판정은 검색 결과의 등록상태 문자열에 근거합니다. 특정 건을 근거로 삼기 전에 그 번호로 rights_alive를 호출해 확정하세요."]
}
```

`alive_only: true`를 주면 살아있는 것만 나온다.

---

## 설치

### 1. KIPRIS 서비스 키 발급 (무료, 승인 대기 있음)

<https://www.data.go.kr/data/15058125/openapi.do> 에서 **활용신청**.
승인되면 마이페이지의 **"일반 인증키(Decoding)"** 값을 복사한다.

> 무료 등급은 **월 1,000회**다. `verify_citations`가 번호 20개를 검증하면 그것만으로 20회다.
> 서버는 같은 번호를 프로세스 내에서 1시간 캐시한다(`KIPRIS_CACHE_TTL`로 조절).

### 2. 설치

```bash
npx korean-patent-mcp@latest setup
```

키를 프롬프트로 받아 **실제 호출로 검증한 뒤** 선택한 클라이언트 설정 파일에 등록한다.
Claude Desktop / Claude Code / Cursor / VS Code / Windsurf / Gemini CLI / Zed 지원.

### 수동 설정

```json
{
  "mcpServers": {
    "korean-patent": {
      "command": "npx",
      "args": ["-y", "korean-patent-mcp@latest"],
      "env": { "KIPRIS_SERVICE_KEY": "여기에-키" }
    }
  }
}
```

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `KIPRIS_SERVICE_KEY` | (필수) | data.go.kr 일반 인증키 |
| `KIPRIS_CACHE_TTL` | `3600` | 응답 캐시 TTL(초) |
| `KIPRIS_BASE_URL` | KIPRIS Plus 공식 | 엔드포인트 오버라이드 |

---

## `probe` — 데이터를 믿어도 되는지 먼저 확인

이 서버 전체는 두 가지 전제 위에 서 있다. 하나라도 무너지면 코드가 아무리 좋아도 거짓말을 하게 된다.

1. **소멸·포기된 권리가 응답에서 명확히 구분되는가**
2. **상태 갱신이 며칠이나 지연되는가**

이걸 눈으로 확인하지 말고 명령 하나로 판정한다.

```bash
KIPRIS_SERVICE_KEY='...' npx korean-patent-mcp probe
```

```bash
# 상태를 확실히 아는 번호로 재는 쪽이 훨씬 정확하다
npx korean-patent-mcp probe 10-2019-0123456 10-1234567

# 응답 XML 원문까지
npx korean-patent-mcp probe --raw 10-2019-0123456
```

probe가 하는 일:

- 응답에 판정용 필드(`registerStatus`, `finalDisposal`, `applicationDate` …)가 실제로 있는지 확인
- 관측된 **상태값 분포**를 뽑아, 등록 계열과 소멸 계열이 서로 다른 값으로 갈리는지 판정
- **판정 규칙이 모르는 상태값**을 잡아내 (→ `src/lib/status.ts`에 추가하면 된다)
- 법적상태 이력 날짜로 갱신 지연을 가늠
- 마지막에 **"이 기획은 성립한다 / 확인포인트 1 미통과"** 를 한 줄로 결론

---

## 판정 규칙

`src/lib/status.ts` 하나에 모여 있다. 나머지는 전부 배관이다.

1. **"등록"이라는 글자만 보고 살아있다고 하지 않는다.** 죽음 어휘(소멸·무효·취소·말소·연차료 불납)를 먼저 본다. 등록된 뒤 소멸한 권리가 압도적으로 많고, 그게 정확히 사람들이 틀리는 지점이다.
2. **등록 상태라도 존속기간을 다시 계산한다.** KIPRIS 상태가 "등록"에 머물러 있어도 만료일이 지났으면 그 권리는 죽었다. 특허 = 출원일 + 20년, 실용신안 = 출원일 + 10년.
3. **모르면 모른다고 한다.** 모든 응답에 `basis`(판정 근거)와 `warnings`가 붙는다. 해석 못 한 상태값은 `stage: "불명"` + `alive: false`다 — 모르는 걸 살아있다고 하지 않는다.

---

## 한계 — 읽고 쓰세요

- **`expiry`는 대개 추정치다.** `expiry_estimated: true`면 출원일 + 법정 존속기간으로 계산한 값이다. **존속기간 연장등록**(의약품·농약)이 있으면 실제 만료일은 더 뒤다.
- **연차료 납부 여부는 확정하지 못한다.** 등록 상태로 나와도 최근 연차료를 안 냈으면 곧 소멸한다. KIPRIS 상태 반영에는 지연이 있다.
- **`holder`는 출원인 기준이다.** 등록 후 권리가 양도됐으면 현재 권리자와 다르다. 정확한 권리자는 **등록원부**를 봐야 한다.
- **거래·소송·실시 판단에 이 서버의 출력을 그대로 쓰지 마세요.** 스크리닝 도구다. 최종 확인은 등록원부와 변리사다.
- `search_ip`의 생사 판정은 검색 응답의 상태 문자열에만 근거한다. 특정 건을 근거로 삼기 전에 그 번호로 `rights_alive`를 다시 부르세요.

---

## 안 하는 것 (의도한 부재)

- **`fto_screen`** — 침해 가능성 판단. 유사도 로직이 필요하고, 틀렸을 때 손해가 크다.
- **상표·디자인** — 특허·실용신안만. `30-`·`40-` 번호는 명시적으로 거절한다.
- **해외 특허** — 국내만.
- **도구 10개** — 도구가 늘면 LLM이 어느 걸 부를지 헷갈리고, 그 순간 "생사 판정"이라는 유일한 약속이 흐려진다.

---

## 개발

```bash
npm install
npm test          # 93 tests
npm run typecheck
npm run build
```

```
src/
├── index.ts              진입점 (stdio / setup / probe)
├── tool-registry.ts      도구 3개 등록 — 여기가 늘어나면 안 된다
├── setup.ts              대화형 설치 (키 검증 포함)
├── probe.ts              응답 진단 — 기획 폐기 여부 판정
├── lib/
│   ├── status.ts         ★ 생사 판정 엔진. 이 프로젝트의 실체
│   ├── number.ts         번호 파싱·정규화·텍스트 추출
│   ├── kipris-client.ts  KIPRIS Plus HTTP (재시도·캐시·오류 해석)
│   ├── title-match.ts    인용 명칭 ↔ 실제 명칭 대조
│   ├── xml.ts            의존성 없는 XML 추출
│   ├── cache.ts          TTL 캐시 (월 1,000회 방어)
│   └── errors.ts         오류 → 도구 응답
└── tools/
    ├── rights-alive.ts
    ├── verify-citations.ts
    └── search-ip.ts
```

**상태값을 하나 더 알게 됐다면** `src/lib/status.ts`의 `DEAD_PATTERNS` / `PENDING_PATTERNS`에 추가하고 `src/lib/status.test.ts`에 케이스를 하나 넣으면 된다. `probe`가 모르는 상태값을 알려준다.

---

## 라이선스

MIT. 데이터 출처는 [KIPRIS Plus](https://plus.kipris.or.kr) (지식재산처 / 한국특허정보원).
