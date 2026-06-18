// 연습모드 보조지표(RSI/MACD) 검증 (node, 의존성 없음)
//   - trading-hts.html 에서 calcRSI/calcMACD(정본) + prcToggleSub 추출
//   - 룩어헤드(미래봉 미사용) / 전일연결(09:00부터) / 토글 / 엔진 pctx 게이트(HTS 무영향) 확인
// 실행:  node test/rsi-macd.test.js
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

// 정본 함수 추출(엔진/연습 양쪽이 쓰는 그 함수 그대로)
const calcRSI = new Function(extractFn(html, 'calcRSI') + '; return calcRSI;')();
const calcMACD = new Function(extractFn(html, 'calcMACD') + '; return calcMACD;')();

// ── [A] calcRSI/calcMACD 기본 동작 ──
console.log('[A] calcRSI/calcMACD 기본');
(function () {
  const d = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  const rsi = calcRSI(d, 14);
  ok(rsi.slice(0, 14).every(v => v === null), 'RSI: 앞 n개(워밍업) null');
  ok(rsi[14] != null && rsi[14] > 0 && rsi[14] < 100, `RSI[14] 0~100 범위 (${rsi[14] != null ? rsi[14].toFixed(2) : null})`);
  const m = calcMACD(d);
  ok(Array.isArray(m.ml) && Array.isArray(m.sig) && m.ml.length === d.length && m.sig.length === d.length, 'MACD: ml/sig 길이 = 입력 길이');
})();

// ── [B] 룩어헤드 — RSI/MACD[i] 는 과거 봉만 사용(미래 잘라도 동일) ──
console.log('[B] 룩어헤드 — RSI/MACD 는 미래봉 안 씀');
(function () {
  const closes = [12, 15, 11, 18, 22, 19, 25, 30, 28, 33, 31, 29, 35, 40, 38, 42, 39, 45, 47, 44, 50, 53, 49, 55, 58, 54, 60, 62, 59, 65];
  // RSI
  const fullR = calcRSI(closes, 14);
  let sameR = true;
  for (let i = 0; i < closes.length; i++) {
    const upto = calcRSI(closes.slice(0, i + 1), 14)[i];
    const a = fullR[i], b = upto;
    if (a === null ? b !== null : Math.abs(a - b) > 1e-9) sameR = false;
  }
  ok(sameR, 'RSI[i]: 미래봉 잘라도 값 불변 → 룩어헤드 없음');
  // MACD (ml, sig 둘 다)
  const fullM = calcMACD(closes);
  let sameM = true;
  for (let i = 0; i < closes.length; i++) {
    const upto = calcMACD(closes.slice(0, i + 1));
    if (Math.abs(fullM.ml[i] - upto.ml[i]) > 1e-9 || Math.abs(fullM.sig[i] - upto.sig[i]) > 1e-9) sameM = false;
  }
  ok(sameM, 'MACD[i](ml/sig): 미래봉 잘라도 값 불변 → 룩어헤드 없음');
})();

// ── [C] 전일연결 — 전일 종가 prepend 시 당일 09:00(인덱스0)부터 RSI/MACD 가 이어진다 ──
console.log('[C] 전일연결 → 당일 첫 봉(09:00)부터 RSI/MACD 이어짐');
(function () {
  const prev = Array.from({ length: 120 }, (_, i) => 1000 + Math.sin(i / 5) * 20 + i * 0.1);  // 전일 120봉
  const today = Array.from({ length: 360 }, (_, i) => 1012 + Math.sin(i / 7) * 25 + i * 0.05); // 당일 360봉
  const n1 = 20;                                  // 재생 초반: 20봉만 노출
  const todayUpToN1 = today.slice(0, n1);
  const pn = prev.length;
  // prcRender 와 동일: closesAll = prev + 당일(0..n1), slice(pn, pn+len)
  const closesAll = prev.concat(todayUpToN1);

  // RSI — 당일 인덱스0(09:00)이 전일 워밍업 덕에 비-null
  const rsiW = calcRSI(closesAll, 14).slice(pn, pn + todayUpToN1.length);
  ok(rsiW[0] != null, `RSI: 당일 인덱스0(09:00) 비-null (전일 워밍업) = ${rsiW[0] != null ? rsiW[0].toFixed(2) : null}`);
  ok(rsiW.length === todayUpToN1.length, `RSI: 길이 당일 윈도우와 일치 (${rsiW.length})`);
  // 대조: 전일 없으면 09:00 RSI14=null(중간부터 시작) — 사용자가 본 증상
  ok(calcRSI(todayUpToN1, 14)[0] === null, '대조: 전일 없으면 09:00 RSI14=null — 전일연결이 해결');

  // MACD — 전일 워밍업 시 09:00 값이 0(no-warmup seed)이 아닌 실제 값
  const macdW = calcMACD(closesAll).ml.slice(pn, pn + todayUpToN1.length);
  const macdNo = calcMACD(todayUpToN1).ml;
  ok(macdNo[0] === 0, '대조: 전일 없으면 09:00 MACD=0(EMA seed) — 의미없음');
  ok(Math.abs(macdW[0]) > 1e-9, `MACD: 당일 09:00 전일연결로 실제값 (${macdW[0].toFixed(3)})`);

  // 룩어헤드: 당일은 n1 까지만 합치므로 미래봉 안 씀(전일은 과거)
  const future = today.slice(0, n1 + 50);
  const rsiFut = calcRSI(prev.concat(future), 14).slice(pn, pn + n1);
  const rsiPast = calcRSI(prev.concat(todayUpToN1), 14).slice(pn, pn + n1);
  ok(JSON.stringify(rsiFut) === JSON.stringify(rsiPast), '당일 RSI[0..n1] 는 미래봉과 무관(룩어헤드 없음)');
})();

// ── [D] prcToggleSub 토글 로직 ──
console.log('[D] prcToggleSub 토글');
(function () {
  const PRC = { rsi: false, macd: false };
  const fn = extractFn(html, 'prcToggleSub');
  const prcToggleSub = new Function('PRC', '_prcSyncSubUI', 'prcRender', fn + '; return prcToggleSub;')(PRC, () => {}, () => {});
  prcToggleSub('rsi'); ok(PRC.rsi === true && PRC.macd === false, `RSI 켜기 → rsi=${PRC.rsi}, macd=${PRC.macd}`);
  prcToggleSub('macd'); ok(PRC.rsi === true && PRC.macd === true, `MACD 켜기 → 둘 다 on`);
  prcToggleSub('rsi'); ok(PRC.rsi === false && PRC.macd === true, `RSI 끄기 → rsi=${PRC.rsi}`);
  prcToggleSub('xxx'); ok(PRC.rsi === false && PRC.macd === true, '알 수 없는 종류는 무시(무변화)');
})();

// ── [E] 엔진 _drawRSI/_drawMACD — pctx 게이트(HTS 무영향) ──
console.log('[E] 엔진 RSI/MACD pctx 게이트');
ok(html.includes('function _drawRSI(cs,cls,pctx){'), '_drawRSI 가 pctx 인자 받음');
ok(html.includes('function _drawMACD(cs,cls,pctx){'), '_drawMACD 가 pctx 인자 받음');
// HTS 경로(pctx 없음)는 기존 전역 id/inds 사용 — 무영향
ok(html.includes("const el=document.getElementById(pctx?(pctx.rsiSubId||'prcRsiSub'):'rsiSub');"), 'RSI: pctx 없으면 rsiSub(HTS 그대로)');
ok(html.includes("const el=document.getElementById(pctx?(pctx.macdSubId||'prcMacdSub'):'macdSub');"), 'MACD: pctx 없으면 macdSub(HTS 그대로)');
ok(html.includes('const _on=pctx?!!pctx.rsiOn:!!inds.rsi;'), 'RSI on: pctx 없으면 전역 inds.rsi(HTS 그대로)');
ok(html.includes('const _on=pctx?!!pctx.macdOn:!!inds.macd;'), 'MACD on: pctx 없으면 전역 inds.macd(HTS 그대로)');
ok(html.includes('const rsi=(pctx&&pctx.rsiData)?pctx.rsiData:calcRSI(cls,14);'), 'RSI: pctx.rsiData 우선, 없으면 calcRSI(cls,14)');
ok(html.includes('const{ml,sig}=(pctx&&pctx.macdData)?pctx.macdData:calcMACD(cls);'), 'MACD: pctx.macdData 우선, 없으면 calcMACD(cls)');
// 슬롯 분모: pctx 없으면 기존 _chartSlots(HTS 무영향)
ok(html.includes('const _den=pctx?(pctx.slots||cs.length):(_chartSlots||cs.length);'), '슬롯 분모: pctx 없으면 _chartSlots(HTS 그대로)');
// 호출부: _OV(HTS) 경로는 인자 없이(기존), pctx 경로만 pctx 주입
ok(html.includes('_drawRSI(cs,cls,pctx);') && html.includes('_drawMACD(cs,cls,pctx);'), '연습(pctx) 경로에서만 pctx 주입 호출');
ok(/if\(_OV\)\{\s*_drawRSI\(cs,cls\);\s*_drawMACD\(cs,cls\);\s*\}\s*else if\(pctx\)\{/.test(html.replace(/\/\/[^\n]*\n/g, '\n')), 'HTS(_OV) 경로는 기존대로 인자 없이 호출');

// ── [F] prcRender 연동(전일연결 데이터 + pctx 전달) ──
console.log('[F] prcRender 연동');
ok(html.includes('rsiData=calcRSI(closesAll,14).slice(pn+vStart, pn+vStart+winBars.length)'), 'prcRender: (전일+당일) RSI → 당일 윈도우 슬라이스');
ok(html.includes('const{ml,sig}=calcMACD(closesAll); macdData={ml:ml.slice(pn+vStart, pn+vStart+winBars.length), sig:sig.slice(pn+vStart, pn+vStart+winBars.length)}'), 'prcRender: (전일+당일) MACD → 당일 윈도우 슬라이스');
ok(html.includes('rsiOn: !!PRC.rsi'), 'pctx.rsiOn = PRC.rsi 전달');
ok(html.includes('macdOn: !!PRC.macd'), 'pctx.macdOn = PRC.macd 전달');
ok(html.includes('rsiData: rsiData') && html.includes('macdData: macdData'), 'pctx 로 전일연결 데이터 전달');
ok(html.includes('slots: vCount'), 'pctx.slots = vCount(메인차트와 동일 분모)');
ok(html.includes("PRC.rsi 만 바뀜") || html.includes('_prcSyncSubUI();'), '보조지표 토글 UI 동기화 존재');

// ── [G] PRC 상태 + 토글 UI 슬롯/버튼 존재 ──
console.log('[G] PRC 상태 + UI');
ok(html.includes('rsi:false,') && html.includes('macd:false,'), 'PRC 에 rsi/macd 초기 off 상태');
ok(html.includes('id="prcSubBtns"'), '보조지표 토글 버튼 컨테이너 존재');
ok(html.includes('onclick="prcToggleSub(\'rsi\')"') && html.includes('onclick="prcToggleSub(\'macd\')"'), 'RSI/MACD 토글 버튼 onclick');
ok(html.includes('id="prcRsiSub"') && html.includes('id="prcMacdSub"'), '연습 RSI/MACD 서브차트 슬롯 존재');

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
