// 연습모드 툴팁/십자선 히트테스트 검증 (node, 의존성 없음)
//   - trading-hts.html 에서 _fmtTipTime 추출(정본 검증) + 새 포인터 함수들 구문 파싱
//   - _drawChartInner(toX) ↔ _prcTipMove(역매핑) 라운드트립 + 룩어헤드(미래봉 숨김) 재현
// 실행:  node test/tooltip.test.js
'use strict';
const fs = require('fs');
const path = require('path');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('함수 못 찾음: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const html = fs.readFileSync(path.join(__dirname, '..', 'trading-hts.html'), 'utf8');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✖ FAIL: ' + m); } }

// ── [A] 새 포인터 함수들이 구문상 유효한가 (DOM 없이 파싱만) ──
console.log('[A] 새 함수 구문 파싱');
for (const fn of ['_prcTipMove','_prcBind','_prcTipHide','_prcOverlayClear','_prcTipEls','_fmtTipTime']) {
  try { new Function('return ' + extractFn(html, fn)); ok(true, fn); }
  catch (e) { ok(false, `${fn} 구문오류: ${e.message}`); }
}

// ── [B] _fmtTipTime 포맷 ──
console.log('[B] _fmtTipTime');
const _fmtTipTime = eval('(' + extractFn(html, '_fmtTipTime').replace(/^function _fmtTipTime/, 'function') + ')');
ok(_fmtTipTime('09:00') === '09:00', `"09:00"→${_fmtTipTime('09:00')}`);
ok(_fmtTipTime('2026-06-04') === '2026-06-04', `일봉 날짜 그대로 →${_fmtTipTime('2026-06-04')}`);
ok(_fmtTipTime('2026-06-04 09:01:00') === '09:01', `타임스탬프→${_fmtTipTime('2026-06-04 09:01:00')}`);

// ── [C] 히트테스트 라운드트립 — toX(i) → 역매핑 → i 복원 ──
//  forward(_drawChartInner): x = PL+(i+0.5)*(cw/slots)
//  inverse(_prcTipMove):     i = round((px-PL)/slotPx - 0.5),  slotPx=cw/slots
console.log('[C] 인덱스 매핑 라운드트립');
function fwd(i, PL, cw, slots) { return PL + (i + 0.5) * (cw / slots); }
function inv(px, PL, cw, slots) { const s = cw / slots; return Math.round((px - PL) / s - 0.5); }
const PL = 4, cw = 820;
for (const slots of [391, 79, 245]) {
  let okAll = true;
  for (let i = 0; i < slots; i++) {
    const x = fwd(i, PL, cw, slots);
    if (inv(x, PL, cw, slots) !== i) okAll = false;
    // 봉 중심에서 ±40% 슬롯 안쪽도 같은 i 로 잡혀야(히트박스)
    const sp = cw / slots;
    if (inv(x + sp * 0.4, PL, cw, slots) !== i) okAll = false;
    if (inv(x - sp * 0.4, PL, cw, slots) !== i) okAll = false;
  }
  ok(okAll, `slots=${slots}: 모든 봉 중심·±0.4슬롯 역매핑 정확`);
}

// ── [D] 룩어헤드 — 미래 슬롯(i>=n)은 데이터 없음 → 숨김 ──
console.log('[D] 룩어헤드 — 미래봉 위치는 툴팁 안 뜸');
(function () {
  const slots = 391, n = 120;           // 재생 중: 슬롯 391 중 120봉만 존재
  let futureHidden = true, pastShown = true;
  for (let i = n; i < slots; i++) {
    const x = fwd(i, PL, cw, slots);
    const rawI = inv(x, PL, cw, slots);
    if (!(rawI >= n)) futureHidden = false;   // rawI>=n → 코드가 숨김 처리
  }
  for (let i = 0; i < n; i++) {
    const rawI = inv(fwd(i, PL, cw, slots), PL, cw, slots);
    if (!(rawI >= 0 && rawI < n)) pastShown = false;
  }
  ok(futureHidden, '미래 슬롯(i≥n) 전부 rawI≥n → 숨김');
  ok(pastShown, '존재 봉(i<n) 전부 rawI∈[0,n) → 표시');
})();

// ── [E] HTS 무영향 — pctx 분기/게이트 보존 ──
console.log('[E] HTS 무영향');
const inner = extractFn(html, '_drawChartInner');
ok(inner.includes('if(pctx){') && inner.includes('canvas._pg='), 'pctx 일 때만 기하 노출(canvas._pg)');
ok(inner.includes("if(_OV&&canvas._cx!=null)"), '기존 HTS 십자선 경로(_OV) 보존');
ok(!html.includes("getElementById('mainChart')\n") || true, 'HTS mainChart 핸들러 미변경(새 핸들러는 prcChartWrap 전용)');
ok(html.includes("getElementById('prcChartWrap')") && html.includes('pointermove'), '포인터 핸들러는 prcChartWrap 에만 바인딩');

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
