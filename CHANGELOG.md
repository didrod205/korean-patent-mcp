# CHANGELOG

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [1.0.7]

### 더함

- `npm version` 시 `src/version.ts` 자동 동기화(`scripts/sync-version.mjs`).
  손으로 맞추던 동안 세 번 어긋났다. 잡는 것보다 안 생기게 하는 편이 낫다.

### 바뀜

- 배포 인증을 `NPM_TOKEN`에서 **Trusted Publishing(OIDC)** 으로 전환.
  npm granular token은 최대 90일이라 분기마다 만료돼 배포가 조용히 깨진다.
  OIDC는 워크플로 실행마다 발급되는 단기 증명이라 갱신할 것도 유출될 장기 비밀도 없다.
  워크플로에 시크릿 참조가 하나도 남지 않았다.
- 이미 배포된 버전이거나 인증이 안 되어 있으면 publish 워크플로가 실패 대신
  건너뛴다. 기록용 릴리스마다 빨간불이 뜨면 진짜 실패를 놓친다.
  단, 태그-버전 불일치는 그대로 실패시킨다.

## [1.0.6]

### 고침

- **`search_ip` 집계가 전체인 것처럼 읽히던 문제.** `total_matched: 21060`인데
  `alive_count: 0`이면 "유효 특허 없음"으로 오독된다. 실제로는 10건만 판정한 결과였다.
  `alive_count`/`dead_count` → `alive_in_inspected`/`dead_in_inspected`로 이름을 바꾸고,
  판정 건수 `inspected`와 `coverage_warning`을 추가했다. **호환성 깨짐.**

### 더함

- GitHub Actions CI — Node 20.19/22/24 매트릭스로 typecheck·test·build·패키지 검증.
- GitHub Actions publish — 릴리스 태그와 `package.json` 버전 일치를 강제한다.
  1.0.3 사고(로컬은 1.0.5인데 1.0.3이 배포됨)를 구조적으로 막는다.
- `npm run verify:package` — 실제로 pack해서 tarball을 검사한다.
  `build/` 누락, `.env`·소스 유출, 빌드-버전 불일치를 배포 전에 잡는다.
- 출원인 필터가 실제로 걸러졌는지 결과를 세어 확인하고, 안 걸러졌으면 알린다.
- CI에 live-probe 잡 — KIPRIS 응답 형태가 조용히 바뀌는 걸 감시한다(시크릿 있을 때만).

## [1.0.5]

### 고침

- **지어낸 번호가 무관한 실재 특허로 둔갑하던 버그.** `10-2019-0000000`(있을 수 없는
  출원번호)이 숫자만 보는 파싱 탓에 등록번호 `10-2019000`으로 읽혀 전혀 다른 특허를
  `verdict: "ok"`로 통과시켰다. 검증 도구가 창작된 인용에 도장을 찍어준 셈이다.
  `parseNumber`가 하이픈 구획을 먼저 보도록 고쳤고, 형태가 성립하지 않는 번호는
  조회 없이 `not_found`로 보고한다.

## [1.0.4]

### 고침

- `.env.example`을 두고도 `.env`를 읽지 않던 문제. 의존성 없는 로더를 추가했다.
  `./.env`와 `~/.config/korean-patent-mcp/.env`를 읽으며, 실제 환경변수가 우선한다.

## [1.0.3]

### 고침

- **날짜가 통째로 버려지던 버그.** 실제 응답은 `1985/12/30 00:00:00` 형식인데
  `YYYYMMDD` 8자리만 받도록 돼 있었다. 출원일이 없으면 존속기간이 계산되지 않아
  "등록 상태여도 만료됐으면 죽었다"는 핵심 판정이 무력화된다.
- `applicantName`·`ipcNumber`의 `|` 구분 복수값 처리.
- 발급처를 KIPRIS Plus로 정정(공공데이터포털이 아니다).

### 더함

- KIPRIS 공식 출력 샘플을 회귀 픽스처로 고정.

## [1.0.0]

첫 배포. `rights_alive` / `verify_citations` / `search_ip` 3개 도구.
