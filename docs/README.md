# docs

| 파일 | 용도 |
|---|---|
| `screenshot.png` | README 상단 실행 화면. 도구 3개의 실제 출력 |
| `screenshot.svg` | 위 이미지의 원본. 내용이 바뀌면 여기를 고쳐 다시 만든다 |
| `thumbnail.png` | 248×93. 공공데이터포털 활용사례 등록용 대표 이미지 |
| `thumbnail.svg` | 위 이미지의 원본 |
| `sample-output.json` | 실 API 산출물 표본. 공공데이터포털 공유 데이터로 제출 |

이미지 재생성:

```bash
rsvg-convert -w 1280 -h 860 docs/screenshot.svg -o docs/screenshot.png
rsvg-convert -w 248  -h 93  docs/thumbnail.svg  -o docs/thumbnail.png
```

`screenshot.svg`의 내용은 실제 실행 결과를 옮긴 것이다.
도구 출력 형식이 바뀌면 실제로 돌려본 값으로 갱신한다 — 목업을 넣지 않는다.

## demo.gif

README 상단 데모. 실제 실행 결과를 프레임으로 그린 것이다.

```bash
python3 scripts/make-demo.py     # 프레임 렌더 → docs/demo.gif
```

프레임마다 지속시간을 따로 준다. 같은 프레임을 여러 장 반복하는 방식은
PIL이 중복을 병합해버려 멈춤이 사라진다 — 실제로 그렇게 한 번 날아갔다.
