// 스캘핑 차단(보유 1분 미만 매도) + params.json 단일 출처 검증 (node, 의존성 없음)
// 실행:  node test/scalp_params.test.js
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
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'trading-hts.html'), 'utf8');
const P = JSON.parse(fs.readFileSync(path.join(root, 'params.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✖ FAIL: ' + m); } };

console.log('[A] params.json 구조');
const need = { entry: ['minScore'], risk: ['maxPositionPct', 'stopPct', 'dailyLossPct', 'maxStopsPerStockPerDay', 'maxConsecutiveLosses'], exit: ['t1Pct', 't2Pct', 'minRR'], scalp: ['minHoldSec'] };
for (const g of Object.keys(need)) for (const k of need[g]) ok(typeof (P[g] || {})[k] === 'number' && P[g][k] > 0, `${g}.${k} 양수`);
ok(P.scalp.minHoldSec >= 60, 'scalp.minHoldSec ≥ 60초');
// 코드가 참조하는 TP.<group>.<key> 가 전부 params.json 에 있어야 함
const refs = new Set((html.match(/TP\.(entry|risk|exit|scalp)\.[A-Za-z0-9]+/g) || []));
for (const r of refs) { const [, g, k] = r.split('.'); ok(typeof (P[g] || {})[k] === 'number', `코드 참조 ${r} 가 params.json 에 존재`); }

console.log('[B] 보유시간 계산');
const _tmSec = eval('(' + extractFn(html, '_tmSec') + ')');
const holdSrc = extractFn(html, '_holdSecSinceBuy');
const mkHold = (env) => new Function('mock', 'sim', 'backtest', '_tmSec', 'window', 'return (' + holdSrc + ')')(env.mock, env.sim, env.backtest, _tmSec, env.window);
const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
{
  const bt = { running: true };
  const env = { mock: { trades: [{ side: 'buy', tk: 'A', barTime: '09:05', barDate: '20250102', ts: 1 }] }, sim: { date: '2025-01-02', idx: 0, candles: [{ t: '09:05', date: '20250102' }] }, backtest: bt, window: { backtest: bt } };
  const h = mkHold(env);
  ok(h('A') === 0, `같은 봉 매도 = 0초 (got ${h('A')})`);
  env.sim.candles[0].t = '09:06'; ok(h('A') === 60, '다음 1분봉 = 60초');
  env.sim.candles[0].t = '09:10'; ok(h('A') === 300, '5분 후 = 300초');
  env.sim.candles[0].date = '20250103'; ok(h('A') === Infinity, '다른 날짜면 제한 없음');
  ok(h('B') === Infinity, '매수 기록 없는 종목은 제한 없음');
}
{
  const env = { mock: { trades: [{ side: 'buy', tk: 'A', ts: Date.now() - 30000 }] }, sim: { date: kst, idx: 0, candles: [] }, backtest: { running: false }, window: {} };
  env.window.backtest = env.backtest;
  const s = mkHold(env)('A');
  ok(s >= 29 && s <= 32, `실시간은 실제 시각 기준 (~30초, got ${s})`);
}

console.log('[C] 예외 사유 (손절·강제청산만 허용)');
const ex = eval(html.match(/var _SCALP_EXEMPT=(\/[^\n]*\/);/)[1]);
for (const r of ['손절 실행 — 손절가 1원', '긴급 청산 — 돌발', '종가 청산 — 백테스트', '15:20 마감 자동청산']) ok(ex.test(r), '예외: ' + r);
for (const r of ['1차 목표가 1원 도달', '2차 목표가', '다중청산신호: x', '갈아타기 — A', '모멘텀 약화 — 5MA', '']) ok(!ex.test(r), '차단 대상: ' + (r || '(사유 없음)'));

console.log('[D] 적응형 파라미터 = 기존 고정값과 동일 (기준값 기본일 때)');
const adaptSrc = extractFn(html, 'computeAdaptiveConfig');
const TP = { entry: { minScore: 6 }, risk: { stopPct: 3, maxPositionPct: 20 }, exit: { t1Pct: 3, t2Pct: 5, minRR: 1.5 } };
for (const sc of [1, 29, 30, 49, 50, 69, 70, 100]) {
  const cfg = {};
  new Function('TP', '_perfProfile', '_adaptiveCfg', 'console', adaptSrc + '; computeAdaptiveConfig();')(TP, { totalSells: 10, recentScore: sc, recentWr: 55, recentRr: 1.2 }, cfg, { log() {} });
  const old = { stop: sc >= 70 ? 3.5 : sc >= 50 ? 3 : sc >= 30 ? 2.5 : 2, rr: sc >= 70 ? 1.2 : sc >= 50 ? 1.5 : 2.0, minScore: sc >= 70 ? 5 : sc >= 50 ? 6 : sc >= 30 ? 7 : 8 };
  ok(Math.abs(cfg.stop - old.stop) < 1e-9 && Math.abs(cfg.rr - old.rr) < 1e-9 && cfg.minScore === old.minScore, `score ${sc}: stop ${cfg.stop}/${old.stop} rr ${cfg.rr}/${old.rr} min ${cfg.minScore}/${old.minScore}`);
}

console.log('[E] 진입 점수 기준은 한 곳');
ok(!/var _minS=/.test(html), '최종 판단부 별도 최소점수(_minS) 제거');
ok(!/best\.score >= 4 \|\| \(best\.score >= 3/.test(html), '고속 경로 별도 기준 제거');
ok(!/detectTechnique\(scored\[0\]/.test(html), '작동하지 않던 스캘핑 판정 호출 제거');

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
