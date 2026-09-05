#!/usr/bin/env python3
"""
README 데모 GIF 생성기.

내용은 실제 실행 결과다. 도구 출력이 바뀌면 실제로 돌려본 값으로 갱신한다 —
데모가 실물과 다르면 문서 전체의 신뢰가 깎인다.

    python3 scripts/make-demo.py

프레임마다 지속시간을 따로 준다. 같은 프레임을 반복하는 방식은
PIL이 중복 프레임을 병합해버려 의도한 멈춤이 사라진다.
"""
import os, subprocess, html
W, H = 940, 470
OUT = "docs/frames"
os.makedirs(OUT, exist_ok=True)
C = dict(bg="#0b1220", bar="#111c31", dim="#64748b", txt="#cbd5e1", cyan="#38bdf8",
         green="#4ade80", red="#f87171", amber="#fbbf24", grey="#475569", white="#e8eef7")

def esc(s): return html.escape(s, quote=False)

def render(lines, caret=None):
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         '<style>.m{font-family:"SF Mono","Menlo",monospace}.k{font-family:"Apple SD Gothic Neo",sans-serif}</style>',
         f'<rect width="{W}" height="{H}" fill="{C["bg"]}"/>',
         f'<rect width="{W}" height="44" fill="{C["bar"]}"/>',
         '<circle cx="24" cy="22" r="6" fill="#ef4444"/><circle cx="45" cy="22" r="6" fill="#f59e0b"/><circle cx="66" cy="22" r="6" fill="#22c55e"/>',
         f'<text x="90" y="27" class="k" font-size="13.5" fill="{C["dim"]}">Claude — korean-patent-mcp</text>']
    y = 88
    for item in lines:
        if item is None:
            y += 14; continue
        t, col, sz = item
        o.append(f'<text x="30" y="{y}" class="m" font-size="{sz}" fill="{col}">{esc(t)}</text>')
        y += sz + 11
    if caret:
        o.append(f'<rect x="{caret[0]}" y="{caret[1]-13}" width="9" height="17" fill="{C["cyan"]}"/>')
    o.append("</svg>")
    return "\n".join(o)

seq = []   # (lines, caret, duration_ms)
def add(lines, ms, caret=None): seq.append((lines, caret, ms))

P,T,G,R,A,CY,GR,WH = C["dim"],C["txt"],C["green"],C["red"],C["amber"],C["cyan"],C["grey"],C["white"]

def typing(prefix_lines, q, size, base_y):
    for i in range(3, len(q)+1, 3):
        add(prefix_lines + [("❯ " + q[:i], WH, size)], 55,
            caret=(30 + size*0.62*(len(q[:i])+2), base_y))

# ── 1 ──
q1 = "10-2245822 이 특허 아직 살아있어?"
typing([], q1, 17, 88)
b1 = [("❯ " + q1, WH, 17)]
add(b1, 500)
add(b1 + [None, ("⚙  rights_alive(\"10-2245822\")", P, 14)], 900)
r1 = b1 + [None, ("⚙  rights_alive(\"10-2245822\")", P, 14), None]
s1 = [('✓  alive: true       stage: "등록유효"', G, 16),
      ('   불휘발성 메모리 장치를 포함하는 저장 장치 및 그것의 프로그램 방법', T, 14),
      ('   삼성전자주식회사      (등록원부 최종권리자)', T, 14),
      ('   만료 2034-11-26      expiry_estimated: false', CY, 14),
      ('   연차료 6년차까지 납부 (2026-03-27)', CY, 14),
      ('   sources: ["KIPRIS 서지상세", "등록원부"]   ·   warnings 없음', P, 13)]
for i in range(1, len(s1)+1):
    add(r1 + s1[:i], 260 if i < len(s1) else 2600)

# ── 2 ──
q2a = "이 문장 검증해줘 — 「인공지능 기반 신약 후보물질 탐색 방법」(10-1995-0048202)과"
q2b = "  특허 10-2019-0000000 을 보유하고 있으며, 「무선충전코일」(10-2019-0023102)도 확보"
b2 = [("❯ " + q2a, WH, 14), (q2b, WH, 14)]
add(b2, 1400)
add(b2 + [None, ("⚙  verify_citations(...)", P, 14)], 900)
r2 = b2 + [None, ("⚙  verify_citations(...)", P, 14), None]
s2 = [('✗  10-1995-0048202    명칭 불일치', R, 16),
      ('      인용: "인공지능 기반 신약 후보물질 탐색 방법"', P, 13),
      ('      실제: "카세트테이프의한면반복재생장치및그방법"', P, 13),
      ('✗  10-2019-0000000    존재하지 않는 번호', R, 16),
      ('      일련번호가 전부 0입니다. 지어낸 번호일 가능성이 큽니다.', P, 13),
      ('✓  10-2019-0023102    ok — 「무선충전코일」 등록유효', G, 16),
      None,
      ('인용 3건 중 2건에 문제가 있습니다', A, 15)]
for i in range(1, len(s2)+1):
    add(r2 + s2[:i], 300 if i < len(s2) else 3200)

# ── 3 ──
q3 = "무선 충전 코일 특허 중 아직 유효한 것만 찾아줘"
b3 = [("❯ " + q3, WH, 16)]
add(b3, 900)
add(b3 + [None, ('⚙  search_ip(query="무선 충전 코일", alive_only=true)', P, 14)], 900)
r3 = b3 + [None, ('⚙  search_ip(query="무선 충전 코일", alive_only=true)', P, 14), None]
s3 = [('●  10-2019-0023102   등록유효 (만료 2039-02-27)   무선충전코일', G, 14.5),
      ('●  10-2018-0020941   등록유효 (만료 2038-02-22)   무선 통신 코일을 구비한 무선충전장치', G, 14.5),
      ('○  10-2022-0044657   거절                        (숨김)', GR, 14.5),
      ('○  10-2019-0044820   취하                        (숨김)', GR, 14.5),
      None,
      ('⚠  전체 30,693건 중 10건만 판정했습니다 — 전체 분포가 아닙니다', A, 14)]
for i in range(1, len(s3)+1):
    add(r3 + s3[:i], 300 if i < len(s3) else 3600)

print("고유 프레임", len(seq), "장")
durs = []
for i, (lines, caret, ms) in enumerate(seq):
    sp, pp = f"{OUT}/f{i:03d}.svg", f"{OUT}/f{i:03d}.png"
    open(sp, "w", encoding="utf-8").write(render(lines, caret))
    subprocess.run(["rsvg-convert","-w",str(W),"-h",str(H),sp,"-o",pp], check=True)
    os.remove(sp); durs.append(ms)
print("총 재생시간: %.1f초" % (sum(durs)/1000))

# ── GIF 조립 ──
from PIL import Image
import glob

SCALE = 0.78
paths = sorted(glob.glob(f"{OUT}/f*.png"))
imgs = []
for p in paths:
    im = Image.open(p).convert("RGB")
    imgs.append(im.resize((int(im.width * SCALE), int(im.height * SCALE)), Image.LANCZOS))

# 팔레트를 마지막 프레임으로 고정한다. 프레임마다 새로 뽑으면 색이 튀고 용량이 는다.
pal = imgs[-1].quantize(colors=64, method=Image.MEDIANCUT)
gif = [im.quantize(palette=pal, dither=Image.NONE) for im in imgs]
gif[0].save("docs/demo.gif", save_all=True, append_images=gif[1:],
            duration=durs, loop=0, optimize=True, disposal=2)

for p in paths:
    os.remove(p)
os.rmdir(OUT)

print("docs/demo.gif  %s  %.2f MB" % (gif[0].size, os.path.getsize("docs/demo.gif") / 1024 / 1024))
