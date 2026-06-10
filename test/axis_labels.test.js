// 연습모드 시간축 레이블 겹침 방지 검증 (node, 의존성 없음)
//   - trading-hts.html 에서 실제 _fmtAxisTime 추출(정본 검증)
//   - _drawChartInner 의 X축 솎아내기 로직(픽셀폭 기반)을 재현해 "어떤 줌/봉수에서도 안 겹침" 확인
// 실행:  node test/axis_labels.test.js
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
const _fmtAxisTime = eval('(' + extractFn(html, '_fmtAxisTime').replace(/^function _fmtAxisTime/, 'function') + ')');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  ✖ FAIL: ' + msg); } }

// ── [A] 포맷 ──
console.log('[A] _fmtAxisTime 포맷');
ok(_fmtAxisTime('09:00') === '09:00', `"09:00" → ${_fmtAxisTime('09:00')}`);
ok(_fmtAxisTime('14:28') === '14:28', `"14:28" → ${_fmtAxisTime('14:28')}`);
ok(_fmtAxisTime('2026-06-04') === '06/04', `"2026-06-04" → ${_fmtAxisTime('2026-06-04')}`);
ok(_fmtAxisTime('20260604') === '06/04', `"20260604" → ${_fmtAxisTime('20260604')}`);
ok(_fmtAxisTime('2026-06-04 09:01:00') === '09:01', `타임스탬프 → ${_fmtAxisTime('2026-06-04 09:01:00')}`);
ok(_fmtAxisTime('0900') === '09:00', `"0900" → ${_fmtAxisTime('0900')}`);
// 모든 결과는 5글자 이하(겹침 방지의 전제)
for (const t of ['09:00','2026-06-04','20260604','2026-06-04 09:01:00'])
  ok(_fmtAxisTime(t).length <= 5, `"${t}" 결과 5자 이하: "${_fmtAxisTime(t)}"`);

// ── [B] 픽셀폭 기반 솎아내기 재현 — 어떤 줌/봉수에서도 레이블 간격 ≥ 임계 ──
//  _drawChartInner 와 동일: _slotPx=cw/_slots, _everyN=ceil(46/_slotPx), i+= _everyN, toX(i)=PL+(i+0.5)*_slotPx
console.log('[B] 솎아내기 — 레이블이 항상 ≥46px 간격(안 겹침)');
function drawnXs(barCount, slots, cw, PL) {
  const slotPx = cw / Math.max(slots, 1);
  const everyN = Math.max(1, Math.ceil(46 / Math.max(slotPx, 0.001)));
  const xs = [];
  for (let i = 0; i < barCount; i += everyN) {
    const x = PL + (i + 0.5) * slotPx;
    xs.push(x);
  }
  return xs;
}
const cw = 820, PL = 4;
// 다양한 상황: 재생초기(봉 적음·슬롯 큼=옛 겹침 케이스), 풀세션 1분/5분, 일봉, 좁은화면
const cases = [
  { name: '재생초기 1분(봉30/슬롯391)', bars: 30,  slots: 391 },
  { name: '풀세션 1분(봉391/슬롯391)',  bars: 391, slots: 391 },
  { name: '풀세션 5분(봉79/슬롯79)',    bars: 79,  slots: 79  },
  { name: '일봉(봉245/슬롯245)',        bars: 245, slots: 245 },
  { name: '소수봉(봉5/슬롯391)',        bars: 5,   slots: 391 },
];
for (const c of cases) {
  const xs = drawnXs(c.bars, c.slots, cw, PL);
  let minGap = Infinity;
  for (let i = 1; i < xs.length; i++) minGap = Math.min(minGap, xs[i] - xs[i - 1]);
  const gapOk = xs.length <= 1 || minGap >= 45.9;   // 46px 목표(부동소수 여유)
  ok(gapOk, `${c.name}: 레이블 ${xs.length}개, 최소간격 ${isFinite(minGap)?minGap.toFixed(1):'-'}px (≥46 기대)`);
  ok(xs.length >= 1, `${c.name}: 최소 1개는 표시`);
  console.log(`    ${c.name}: ${xs.length}개 · 최소간격 ${isFinite(minGap)?minGap.toFixed(1):'-'}px`);
}

// ── [C] 옛 로직 대조 — 봉수 기반이라 재생초기에 촘촘히 겹쳤음 ──
console.log('[C] (대조) 옛 로직: 봉수/8 기준 → 재생초기 심한 겹침');
(function () {
  const bars = 30, slots = 391, slotPx = cw / slots;
  const step = Math.max(1, Math.floor(bars / 8));   // = 3
  const xs = [];
  for (let i = 0; i < bars; i += step) xs.push(PL + (i + 0.5) * slotPx);
  let minGap = Infinity;
  for (let i = 1; i < xs.length; i++) minGap = Math.min(minGap, xs[i] - xs[i - 1]);
  ok(minGap < 20, `옛 로직 최소간격 ${minGap.toFixed(1)}px (<20=겹침) — 새 로직 [B]에서 해소`);
})();

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
