// 연습모드 거래량 눈금 렌더 검증 (node, 의존성 없음)
//   - trading-hts.html 에서 실제 _volScale/_fmtVol 소스를 추출해 평가(복사본 아님 → 정본 검증)
//   - 합성 케이스(사용자 예시) + 실제 데이터(삼성 005930 일봉, 최대 ~8,900만) 로 렌더 시뮬레이션
//   - 눈금선이 패널 안에 그어지는지 / 상한이 실제 최대치를 덮는지 / 막대가 안 잘리는지 직접 확인
// 실행:  node test/vol_scale.test.js
'use strict';
const fs = require('fs');
const path = require('path');

// ── trading-hts.html 에서 함수 1개를 중괄호 짝맞춰 추출 ──
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
const _volScale = eval('(' + extractFn(html, '_volScale').replace(/^function _volScale/, 'function') + ')');
const _fmtVol   = eval('(' + extractFn(html, '_fmtVol').replace(/^function _fmtVol/, 'function') + ')');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✖ FAIL: ' + msg); } }
function isNice(step) { // 1/2/5 × 10^k 인가
  if (!(step > 0)) return false;
  const p = Math.pow(10, Math.floor(Math.log10(step)));
  const u = step / p;
  return Math.abs(u - 1) < 1e-9 || Math.abs(u - 2) < 1e-9 || Math.abs(u - 5) < 1e-9;
}

// ── [A] 사용자 예시 규모: 예쁜 스텝 + 4~6 눈금 + 상한이 최대치 덮음 ──
console.log('[A] 스케일 — 사용자 예시 규모');
for (const [max, wantStep] of [[350000,100000],[800*1e4,2*1e6],[3*1e7,5*1e6],[503217,100000]]) {
  const s = _volScale(max);
  ok(s.step === wantStep, `max ${max}: step=${s.step} (기대 ${wantStep})`);
  ok(s.ticks.length >= 4 && s.ticks.length <= 6, `max ${max}: 눈금 ${s.ticks.length}개 (4~6 기대)`);
  ok(s.vMax >= max, `max ${max}: 상한 ${s.vMax} ≥ 최대치 (막대 안 잘림)`);
  ok(isNice(s.step), `max ${max}: step ${s.step} 이 1/2/5×10^k`);
}

// ── [B] 방어 — 이전 "10만 캡" 버그 재발 금지 ──
console.log('[B] 방어 — 비유한/0 입력이 100,000 에 고정되지 않음');
for (const bad of [NaN, 0, -1, -Infinity, Infinity, undefined, null]) {
  const s = _volScale(bad);
  ok(s.vMax !== 100000, `_volScale(${bad}) → vMax=${s.vMax} (100000 아님)`);
  ok(s.ticks.length === 0, `_volScale(${bad}) → 눈금 없음`);
}

// ── [C] 라벨 포맷 ──
console.log('[C] 라벨 — 억/만');
ok(_fmtVol(5000000) === '500만', `5,000,000 → ${_fmtVol(5000000)} (기대 500만)`);
ok(_fmtVol(30000000) === '3,000만', `30,000,000 → ${_fmtVol(30000000)} (기대 3,000만)`);
ok(_fmtVol(100000000) === '1억', `100,000,000 → ${_fmtVol(100000000)} (기대 1억)`);
ok(_fmtVol(89183583).includes('만') || _fmtVol(89183583).includes('억'), `89,183,583 → ${_fmtVol(89183583)}`);

// ── [D] 실제 데이터 렌더 시뮬레이션 — 삼성 005930 일봉(최대 ~8,900만) ──
console.log('[D] 실제 데이터 렌더 — 005930 일봉 (천만+ 거래량)');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_005930_daily.json'), 'utf8'));
const vols = fx.daily.map(d => d.v);
const rawMax = Math.max(...vols);
const sc = _volScale(rawMax);
console.log(`    rawMax=${rawMax.toLocaleString()} → vMax=${sc.vMax.toLocaleString()} step=${sc.step.toLocaleString()} 눈금=[${sc.ticks.map(_fmtVol).join(', ')}]`);

// _drawChartInner 와 동일한 거래량 패널 기하 재현
const W=900,H=500, PR=72,PL=4,PT=8,PB=22,SB=12;
const volH=Math.floor(H*0.20), mainH=H-PT-PB-volH-SB;
const vY0=PT+mainH+PB+2, vBot=vY0+volH-4, panelH=volH-4;
const vMax=Math.max(sc.vMax, rawMax, 1);

ok(sc.ticks.length >= 4 && sc.ticks.length <= 6, `눈금 ${sc.ticks.length}개 (4~6)`);
ok(sc.vMax >= rawMax, `상한 ${sc.vMax} ≥ 실제최대 ${rawMax}`);
// 모든 눈금선이 패널 [vY0, vBot] 안에 그어지는가
let ticksInPanel = true, topTickAtTop = false;
for (const v of sc.ticks) {
  const y = vBot - (v / vMax) * panelH;
  if (y < vY0 - 0.5 || y > vBot + 0.5) ticksInPanel = false;
  if (v === sc.vMax && Math.abs(y - vY0) < 0.5) topTickAtTop = true;
}
ok(ticksInPanel, '모든 눈금선이 거래량 패널 세로범위 안에 위치');
ok(topTickAtTop, '최상단 눈금(=상한)이 패널 맨 위에 정확히 정렬');
// 모든 막대가 패널 높이 안(상한 클램프) — 잘리지 않음
let maxBh = 0, clipped = 0;
for (const v of vols) {
  const bh = Math.max(1, Math.min(panelH, (v / vMax) * panelH));
  if ((v / vMax) * panelH > panelH + 0.5) clipped++;
  if (bh > maxBh) maxBh = bh;
}
ok(clipped === 0, `천장 넘어 잘린 막대 ${clipped}개 (0 기대)`);
ok(maxBh <= panelH + 0.001, `최대 막대 높이 ${maxBh.toFixed(1)}px ≤ 패널 ${panelH}px`);
ok(maxBh > panelH * 0.5, `최대 막대가 패널의 절반 이상 채움(${maxBh.toFixed(1)}/${panelH}) — 상한이 과대하지 않음`);

// ── 옛 버그 재현(대조) — 비유한 봉 하나로 rawMax 가 1 로 붕괴하던 경로 ──
console.log('[E] (대조) 옛 로직은 비유한 봉 1개로 vMax=100,000 에 고정됐음');
const oldRawMax = Math.max(...[5000000, NaN, 3000000]) || 1;   // = 1
let oldStep = 100000; while (Math.ceil(oldRawMax / oldStep) > 6) oldStep += 100000;
const oldVMax = Math.max(oldStep, Math.ceil(oldRawMax / oldStep) * oldStep);
ok(oldVMax === 100000, `옛 로직 vMax=${oldVMax} (버그=100000) — 새 로직은 [B]에서 방어됨`);

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
