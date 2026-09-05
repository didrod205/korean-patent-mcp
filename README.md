# korean-patent-mcp

**특허 출원번호나 기술 설명을 넣으면, 그 권리가 지금 살아있는지를 판정해서 돌려주는 MCP 서버.**

KIPRIS Plus 기반. 도구는 3개다. 늘리지 않는다.

```bash
npx korean-patent-mcp@latest setup
```

![korean-patent-mcp 데모](https://raw.githubusercontent.com/didrod205/korean-patent-mcp/main/docs/demo.gif)

<sub>도구 3개의 실제 실행 결과입니다. 재현한 화면이 아니라 KIPRIS·등록원부에서 받은 값입니다.</sub>

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
| `소멸` | `false` | 있었는데 죽었다. 등록원부를 붙이면 **연차료 불납**인지 **존속기간 만료**인지까지 갈린다 |
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
  "inspected": 20,
  "alive_in_inspected": 7,
  "dead_in_inspected": 13,
  "coverage_warning": "전체 412건 중 20건만 판정했습니다. ...",
  "results": [
    { "alive": true,  "display": "normal", "status": "등록유효 (만료예정 2039-03-14)", "number": "10-2019-0123456", "…": "…" },
    { "alive": false, "display": "dimmed", "status": "소멸(존속기간 만료)",           "number": "10-2001-0009999", "…": "…" }
  ],
  "notes": ["생사 판정은 검색 결과의 등록상태 문자열에 근거합니다. 특정 건을 근거로 삼기 전에 그 번호로 rights_alive를 호출해 확정하세요."]
}
```

`alive_only: true`를 주면 살아있는 것만 나온다.

> **집계는 `inspected` 기준이지 `total_matched` 기준이 아니다.** 전체를 다 보지 못했으면
> `coverage_warning`이 채워진다. `alive_in_inspected: 0`을 "그런 유효 특허가 없다"로
>읽으면 안 된다 — 21,060건 중 10건만 본 결과일 수 있다.

---

## 설치

### 1. KIPRIS 서비스 키 발급 (무료, 승인 대기 있음)

**KIPRIS Plus에서 직접 신청한다.** 공공데이터포털(data.go.kr)이 아니다.

<https://plus.kipris.or.kr> → 회원가입 → 서비스 신청 → **"특허·실용 공개·등록공보"**
(국내 IP데이터 > 공보 > 특허·실용, REST)

발급된 **ServiceKey** 를 `KIPRIS_SERVICE_KEY` 에 넣는다.
**무료 이용자 구간이 있다.** 초당 호출 제한은 무료 50회 / 유료 75회다.

> **공공데이터포털에서 찾지 마세요.** 포털의 KIPRISPlus 항목들은 "활용신청"이 아니라
> **"제공처 바로가기"** 로 KIPRIS Plus를 가리키기만 합니다. 예전에 있던
> `data.go.kr/data/15058788` 항목은 현재 폐지(404)됐습니다.
> 포털에서 직접 신청 가능한 건 별개 API인 등록원부 실시간 조회(`15124946`) 쪽입니다.

> **다른 KIPRIS 서비스 키로는 동작하지 않습니다.** KIPRIS에는 등록사항·해외특허·심판 등
> 서비스가 여러 개 있고 신청은 각각 따로 승인됩니다. 이 서버는 `patUtiModInfoSearchSevice`
> 하나만 호출하므로 위 서비스를 신청해야 합니다.
> 엉뚱한 서비스 키를 넣으면 모든 호출이 `SERVICE KEY IS NOT REGISTERED` 로 실패합니다.

호출 한도보다 **호출량**을 먼저 신경 쓰세요. `verify_citations`가 번호 20개를 검증하면
그것만으로 20회입니다. 서버는 같은 번호를 프로세스 내에서 1시간 캐시하고
(`KIPRIS_CACHE_TTL`로 조절), 동시 요청을 3개로 묶어 초당 제한에 여유를 둡니다.

### 2. 설치

```bash
npx korean-patent-mcp@latest setup
```

키를 프롬프트로 받아 **실제 호출로 검증한 뒤** 선택한 클라이언트 설정 파일에 등록한다.
Claude Desktop / Claude Code / Cursor / VS Code / Windsurf / Gemini CLI / Zed 지원.

> **설치 전에 MCP 클라이언트를 완전히 종료하세요(Cmd+Q).**
> Claude Desktop은 `claude_desktop_config.json` 을 자기 preferences 저장소로도 씁니다.
> 켜진 채로 고치면 앱이 종료할 때 덮어써서 방금 추가한 서버가 조용히 사라집니다.
> `setup` 이 실행 중인 클라이언트를 감지해 막아주지만, 수동 설정 시에는 직접 확인하세요.

> **최초 실행은 30초쯤 걸립니다.** `npx` 가 패키지를 받는 시간입니다(2회차부터 1초 내외).
> 그 사이 "연결 실패"로 보이면 클라이언트를 한 번 더 재시작하세요.
> 매번 빠르게 뜨길 원하면 `npm i -g korean-patent-mcp` 후 `command` 를
> `korean-patent-mcp` 로 바꾸면 됩니다.

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

### 키를 어디에 둘 것인가

셋 중 하나. 위에서부터 권장한다.

**1) MCP 클라이언트에서 쓸 때 — `setup`이 알아서 넣는다**

```bash
npx korean-patent-mcp@latest setup
```

클라이언트 설정 파일의 `env` 블록에 기록하고 파일 권한을 `600`으로 조인다.

**2) 여러 곳에서 공용으로 — 홈 설정 파일**

```bash
mkdir -p ~/.config/korean-patent-mcp
printf 'KIPRIS_SERVICE_KEY=발급받은키\n' > ~/.config/korean-patent-mcp/.env
chmod 600 ~/.config/korean-patent-mcp/.env
```

MCP 클라이언트는 서버를 임의의 작업 디렉토리에서 띄우므로, 프로젝트 `.env`보다
이 경로가 안정적이다. 서버가 시작할 때 자동으로 읽는다.

**3) 이 저장소에서 개발할 때 — 프로젝트 `.env`**

```bash
cp .env.example .env && chmod 600 .env
```

`.gitignore`에 이미 들어 있어 커밋되지 않는다.

우선순위는 **실제 환경변수 > 프로젝트 `.env` > 홈 `.env`** 다.
일회성으로 다른 키를 쓰려면 그냥 앞에 붙이면 된다:

```bash
KIPRIS_SERVICE_KEY='다른키' npx korean-patent-mcp probe
```

> `~/.zshrc`에 `export` 하는 방법도 되지만 권하지 않는다.
> 셸을 띄우는 모든 프로세스에 키가 노출되고, dotfiles를 저장소에 올리는 사람이 많다.

> **키를 이슈·PR·채팅에 붙여넣지 마세요.** 노출됐으면 KIPRIS Plus 마이페이지에서 재발급하세요.

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `KIPRIS_SERVICE_KEY` | (필수) | KIPRIS Plus ServiceKey. 위 3가지 방법 중 하나로 설정 |
| `KIPRIS_CACHE_TTL` | `3600` | 응답 캐시 TTL(초) |
| `DATA_GO_KR_SERVICE_KEY` | (선택) | 등록원부 API 키 — 연차료·확정 만료일 |
| `LEDGER_ENDPOINT` | (선택) | 등록원부 오퍼레이션 URL (활용가이드 PDF 참조) |
| `KIPRIS_BASE_URL` | KIPRIS Plus 공식 | 엔드포인트 오버라이드 |

---

## 선택: 등록원부 연동 — 추정을 확정으로

기본 상태에서 `rights_alive`의 만료일은 **출원일 + 법정 존속기간**으로 계산한 추정치이고,
연차료 납부 여부는 확인되지 않는다. 등록원부 API를 붙이면 둘 다 확정된다.

| | 기본 | 등록원부 연동 |
|---|---|---|
| `expiry` | 추정 (`expiry_estimated: true`) | **확정** (연장등록 반영) |
| `holder` | 출원인 | **실제 등록권자** (양도 반영) |
| `annual_fee` | `null` | `{ paid_year, paid_until }` |

**KIPRIS Plus와 별개 API다.** 키도 신청도 따로 한다.

1. <https://www.data.go.kr/data/15124946/openapi.do> 에서 활용신청 (자동승인)
2. `DATA_GO_KR_SERVICE_KEY` = 일반 인증키(Decoding)

**이게 전부다.** 엔드포인트는 기본값이 들어 있고, 번호의 권리구분을 보고
특허는 `getPatentRegisterHistory`로, 실용신안은 `getUtilityModelHistory`로 자동으로 나뉜다.

설정하면 이렇게 바뀐다:

```json
{
  "expiry": "2034-11-26",
  "expiry_estimated": false,
  "holder": "삼성전자주식회사",
  "annual_fee": { "paid_year": 6, "last_paid_date": "2026-03-27", "payment_count": 4 },
  "sources": ["KIPRIS 서지상세", "등록원부"],
  "warnings": []
}
```

`warnings`가 빈 배열인 것에 주목. 추정치도 미확인 항목도 없으니 붙일 경고가 없다.

```bash
npx korean-patent-mcp probe --ledger 10-2245822
```

**설정하지 않아도 서버는 그대로 동작한다.** 등록원부는 부가정보라,
호출이 실패해도 생사 판정은 KIPRIS 서지정보만으로 나간다. 어떤 소스를 봤는지는
응답의 `sources` 필드에 적힌다.

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

KIPRIS 문서가 명시한 `registerStatus` 값은 **공개 · 등록 · 거절 · 무효 · 소멸 · 취하 · 포기** 7개다.
7개 모두 규칙이 커버하며([kipris-fixture.test.ts](src/lib/kipris-fixture.test.ts)에서 고정),
이 중 `alive: true`가 되는 값은 **`등록` 하나뿐**이다.

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
│   ├── ledger-client.ts  등록원부 실시간 조회 (선택 — 연차료·확정 만료일)
│   ├── title-match.ts    인용 명칭 ↔ 실제 명칭 대조
│   ├── xml.ts            의존성 없는 XML 추출
│   ├── cache.ts          TTL 캐시 (호출량 방어)
│   └── errors.ts         오류 → 도구 응답
└── tools/
    ├── rights-alive.ts
    ├── verify-citations.ts
    └── search-ip.ts
```

**상태값을 하나 더 알게 됐다면** `src/lib/status.ts`의 `DEAD_PATTERNS` / `PENDING_PATTERNS`에 추가하고 `src/lib/status.test.ts`에 케이스를 하나 넣으면 된다. `probe`가 모르는 상태값을 알려준다.

---

## 배포

`main`에 푸시하면 CI가 Node 20.19/22/24에서 typecheck·test·build·패키지 검증을 돌린다.

릴리스를 만들면 npm에 자동 배포된다:

```bash
npm version patch && git push --follow-tags
gh release create "v$(node -p "require('./package.json').version")" --generate-notes
```

`publish.yml`이 **릴리스 태그와 `package.json` 버전 일치를 강제**한다.
로컬 버전과 배포 버전이 어긋나는 사고를 구조적으로 막는 게이트다.

인증은 **Trusted Publishing(OIDC)** 을 쓴다. `NPM_TOKEN` 시크릿이 없다 —
npm granular token은 최대 90일이라 분기마다 만료되고 그때마다 배포가 조용히 깨진다.
OIDC는 GitHub가 워크플로 실행마다 발급하는 단기 증명이라 갱신할 것도, 유출될 장기 비밀도 없다.

최초 1회만 npmjs.com > 패키지 > Settings > Trusted Publisher 에 등록한다:

| 항목 | 값 |
|---|---|
| Repository | `didrod205/korean-patent-mcp` |
| Workflow | `publish.yml` |

등록 전까지는 로컬에서 `npm publish` 하면 된다 (`prepublishOnly`가 빌드와
`verify:package`를 자동으로 돌려 빌드-버전 불일치를 막는다).

## 문제가 생기면

### 서버가 안 붙습니다

클라이언트 로그를 먼저 보세요. Claude Desktop은
`~/Library/Logs/Claude/mcp*.log` 에 원인이 그대로 찍힙니다.

| 로그에 보이는 것 | 원인 | 해결 |
|---|---|---|
| `notarget No matching version found` | 방금 배포된 버전을 `@latest` 가 가리키는데 레지스트리 전파가 끝나지 않음 | 몇 분 뒤 클라이언트를 다시 시작 |
| 아무 로그도 없음 | 클라이언트가 설정을 아직 안 읽음 | 완전 종료(Cmd+Q) 후 재시작 |
| `Server disconnected` 만 반복 | 최초 실행 다운로드(30초) 중 타임아웃 | 재시작하면 캐시가 있어 1초 내에 뜸 |
| `KIPRIS_SERVICE_KEY 가 없습니다` | 설정의 `env` 가 비었음 | 아래 "설정이 사라졌습니다" 참조 |

### 설정이 사라졌습니다

`mcpServers` 에 넣었는데 없어졌다면, **클라이언트가 켜진 상태에서 파일을 고쳤을 가능성이 큽니다.**
Claude Desktop은 `claude_desktop_config.json` 을 자기 preferences 저장소로도 써서,
앱이 종료할 때 메모리 상태로 덮어씁니다. 완전히 종료한 뒤 다시 설정하세요.
`setup` 은 실행 중인 클라이언트를 감지해 이 상황을 막습니다.

### 매번 최신을 받는 게 부담스럽다면

`args` 의 `@latest` 를 빼면 캐시된 버전을 쓰므로 전파 지연에 걸리지 않습니다.
버전을 고정하고 싶으면 `korean-patent-mcp@1.3.3` 처럼 명시하세요.

## 데이터 출처

특허·실용신안 서지정보와 등록상태는 **KIPRIS Plus**(지식재산처 / 한국특허정보원)에서,
존속기간 만료일·연차 납부 이력·등록권자는 **등록원부 실시간 정보 조회 서비스**
(지식재산처, 공공데이터포털 15124946)에서 조회합니다.

API 인증키는 **각자 발급**받아야 하며, 발급받은 본인만 사용할 수 있습니다.
이 소프트웨어는 인증키를 수집하거나 전송하지 않습니다.

**법적 효력이 필요한 판단에는 반드시 등록원부 원본을 확인하세요.**
이 도구는 조회 결과를 가공·요약하며, 상태 반영에는 지연이 있을 수 있습니다.

## 라이선스

[MIT](./LICENSE)

제3자 구현 참조 및 데이터 출처 고지는 [NOTICE](./NOTICE)를 참조하세요.

---

<sub>Made by 양경찬 @E:LAB STUDIO</sub>
