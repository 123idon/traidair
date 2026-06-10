// 연습모드 줌/팬 검증 (node, 의존성 없음)
//   - trading-hts.html 에서 줌 함수들 구문 파싱(정본)
//   - prcRender 윈도잉 + _prcSetZoom 커서앵커 수식을 재현해 룩어헤드/추종/확대폭 확인
// 실행:  node test/zoom.test.js
'use strict';
const fs = require('fs');
const path = require('path');
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('함수 못 찾음: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'trading-hts.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✖ FAIL: ' + m); } };

// ── [A] 새 줌 함수 구문 파싱 ──
console.log('[A] 줌 함수 구문');
for (const fn of ['_prcBind', '_prcLocal', '_prcSetZoom', '_prcZoomAt'])
  { try { new Function('return ' + extractFn(html, fn)); ok(true, fn); } catch (e) { ok(false, `${fn}: ${e.message}`); } }

// ── prcRender 윈도잉 재현(정본과 동일 수식) ──
function windowOf(n, fullSlots, vCountReq, vStartReq, follow) {
  let vCount = vCountReq > 0 ? Math.min(Math.max(10, Math.round(vCountReq)), fullSlots) : fullSlots;
  let vStart;
  if (vCount >= fullSlots) { vCount = fullSlots; vStart = 0; }
  else if (follow) { vStart = Math.max(0, n - vCount); }
  else { vStart = Math.max(0, Math.min(Math.round(vStartReq) || 0, fullSlots - vCount)); }
  const winLen = Math.max(0, Math.min(vStart + vCount, n) - vStart);
  const maxIdx = winLen > 0 ? vStart + winLen - 1 : -1;
  const slots = Math.max(winLen, vCount);   // _drawChartInner _slots
  return { vCount, vStart, winLen, maxIdx, slots };
}

// ── [B] 룩어헤드 — 줌/팬 어떤 상태에서도 미래봉(인덱스≥n) 안 들어옴 ──
console.log('[B] 룩어헤드 — 윈도우에 미래봉 없음');
const n = 200, full = 391;
for (const [vc, vs, fol] of [[0,0,true],[80,0,false],[80,150,false],[80,0,true],[40,380,false],[10,0,true],[120,100,false]]) {
  const w = windowOf(n, full, vc, vs, fol);
  ok(w.maxIdx < n, `vCount=${vc} vStart=${vs} follow=${fol}: maxIdx=${w.maxIdx} < n=${n} (미래봉 없음)`);
}

// ── [C] 확대 = 캔들 폭↑ ──  width = cw / slots, slots = vCount(확대 시 < fullSlots)
console.log('[C] 확대하면 캔들이 굵어짐');
const cw = 820;
const wFull = windowOf(n, full, 0, 0, true);     // 전체보기
const wZoom = windowOf(n, full, 60, 0, true);    // 60슬롯 확대
const widthFull = cw / wFull.slots, widthZoom = cw / wZoom.slots;
ok(widthZoom > widthFull * 2, `확대 캔들폭 ${widthZoom.toFixed(2)}px > 전체 ${widthFull.toFixed(2)}px`);
ok(wZoom.vCount === 60, `확대 vCount=60`);

// ── [D] 추종 — 봉이 늘면 최신이 우측 끝에 유지 ──
console.log('[D] follow — 다음 봉 넘겨도 최신 유지');
const a = windowOf(150, full, 60, 0, true);
const b = windowOf(180, full, 60, 0, true);   // 봉 30개 진행
ok(a.maxIdx === 149 && b.maxIdx === 179, `follow: 최신봉 추종 (${a.maxIdx}→${b.maxIdx})`);
ok(b.vStart > a.vStart, `follow: vStart 가 우측으로 이동(${a.vStart}→${b.vStart})`);

// ── [E] 커서앵커 줌 — 커서 아래 슬롯이 줌 후에도 같은 px ──  (_prcSetZoom 수식 재현)
console.log('[E] 커서 위치 기준 줌(앵커 고정)');
function anchorZoom(curStart, curCount, anchorPx, nc, fullSlots, PL, cw) {
  nc = Math.max(10, Math.min(Math.round(nc), fullSlots));
  const anchorSlot = curStart + (anchorPx - PL) / (cw / curCount);
  let nStart = Math.round(anchorSlot - (anchorPx - PL) / (cw / nc));
  nStart = Math.max(0, Math.min(nStart, Math.max(0, fullSlots - nc)));
  const pxAfter = PL + (anchorSlot - nStart) * (cw / nc);   // 줌 후 앵커슬롯의 px
  return { nStart, nc, pxAfter, anchorSlot };
}
const PL = 4;
for (const anchorPx of [120, 400, 700]) {
  const z = anchorZoom(0, full, anchorPx, 80, full, PL, cw);   // 전체→80 확대
  const slotPx = cw / z.nc;
  ok(Math.abs(z.pxAfter - anchorPx) <= slotPx, `앵커 px=${anchorPx} → 줌후 ${z.pxAfter.toFixed(1)} (±${slotPx.toFixed(1)} 슬롯 내)`);
}

// ── [F] HTS 무영향 ──
console.log('[F] HTS 무영향');
ok(html.includes('PRC.vCount') && html.includes('winBars = bars.slice'), '줌 윈도잉은 prcRender(연습) 안에만');
ok(html.includes("wrap._prcBound") && html.includes("getElementById('prcChartWrap')"), '줌 핸들러는 prcChartWrap 에만 바인딩');
ok(!extractFn(html, '_prcSetZoom').includes('chartViewCount'), '_prcSetZoom 은 HTS 전역 chartViewCount 미사용');
ok(html.includes('let chartViewStart=0,chartViewCount=60;'), 'HTS 전역 줌 상태 보존');

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
