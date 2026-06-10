// 연습모드 이동평균선(MA) 검증 (node, 의존성 없음)
//   - trading-hts.html 에서 calcMA(정본) + prcToggleMa 추출
//   - 룩어헤드(미래봉 미사용) / 선택 기간 토글 / HTS 무영향 확인
// 실행:  node test/ma.test.js
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

// calcMA 추출(arrow const, 한 줄)
const calcMA = eval('(' + html.match(/const calcMA=(\([^\n]*?);[ \t]*$/m)[1] + ')');

// ── [A] SMA 값 + 워밍업 null ──
console.log('[A] calcMA 정확도');
const d = [10, 20, 30, 40, 50];
const ma3 = calcMA(d, 3);
ok(ma3[0] === null && ma3[1] === null, '워밍업(앞 n-1개) null');
ok(ma3[2] === 20 && ma3[3] === 30 && ma3[4] === 40, `SMA3 = [.. ,20,30,40] (got ${ma3.slice(2)})`);

// ── [B] 룩어헤드 — MA[i] 는 과거 봉만 사용(미래 잘라도 동일) ──
console.log('[B] 룩어헤드 — MA 는 미래봉 안 씀');
const closes = [12,15,11,18,22,19,25,30,28,33,31,29,35,40,38];
for (const n of [5, 20, 60]) {
  const full = calcMA(closes, n);
  let same = true;
  for (let i = 0; i < closes.length; i++) {
    // 현재 시점 i 까지만(winBars=과거~현재)으로 계산한 MA[i] 가 전체로 계산한 값과 같아야
    const upto = calcMA(closes.slice(0, i + 1), n);
    const a = full[i], b = upto[i];
    if (a === null ? b !== null : Math.abs(a - b) > 1e-9) same = false;
  }
  ok(same, `MA${n}: 미래봉 잘라도 과거 MA 값 불변 → 룩어헤드 없음`);
}

// ── [C] prcToggleMa 토글 로직 ──
console.log('[C] prcToggleMa 토글');
const PRC = { ma: [5, 20, 60] };
const ctx = { PRC, _prcSyncMaUI(){}, prcRender(){}, Array };
const fn = extractFn(html, 'prcToggleMa');
const prcToggleMa = new Function('PRC', '_prcSyncMaUI', 'prcRender', fn + '; return prcToggleMa;')(PRC, () => {}, () => {});
prcToggleMa(20); ok(JSON.stringify(PRC.ma) === '[5,60]', `MA20 끄기 → ${JSON.stringify(PRC.ma)}`);
prcToggleMa(20); ok(JSON.stringify(PRC.ma) === '[5,20,60]', `MA20 다시 켜기(정렬) → ${JSON.stringify(PRC.ma)}`);
prcToggleMa(5); prcToggleMa(20); prcToggleMa(60);
ok(PRC.ma.length === 0, `전부 끄면 빈 배열 → MA off (${JSON.stringify(PRC.ma)})`);

// ── [D] 엔진 MA 블록 — pctx 선택 게이트(HTS 무영향) ──
console.log('[D] 엔진 MA 선택 게이트');
ok(html.includes('const _maSel=(pctx&&pctx.maPeriods)?pctx.maPeriods:null;'), 'pctx.maPeriods 로 선택(HTS=null→전체)');
ok(html.includes('if(_maSel && _maSel.indexOf(n)<0) return;'), '꺼진 기간은 건너뜀');
ok(html.includes("[['MA5','#f59e0b',5],['MA20','#10b981',20],['MA60','#ef4444',60]]"), 'HTS 기본 5/20/60 정의 보존');

// ── [E] prcRender 연동 ──
console.log('[E] prcRender 연동');
ok(html.includes('ma:(PRC.ma&&PRC.ma.length>0)'), 'inds.ma = 선택 여부에 연동');
ok(html.includes('maPeriods: PRC.ma'), 'maPeriods 로 선택 기간 전달');
ok(html.includes('_prcSyncMaUI();'), 'MA 토글 UI 동기화 호출');
ok(html.includes('const ma=(pctx&&pctx.maData&&pctx.maData[n])?pctx.maData[n]:calcMA(cls,n);'), '엔진이 pctx.maData(전체계산본) 우선 사용');
ok(html.includes('maData[n]=calcMA(closesAll,n).slice(pn+vStart, pn+vStart+winBars.length)'), 'prcRender: (전일+당일) MA → 당일 윈도우 슬라이스(pn 오프셋)');
ok(html.includes('const closesAll = prevC.concat(bars.map(c=>+c.c))'), 'prcRender: closesAll = 전일 + 당일');

// ── [F] 줌 정합성 — 전체봉 계산 후 윈도우 슬라이스 시 좌측 MA 안 끊김 ──
console.log('[F] 줌 시 윈도우 좌측 MA 끊김 없음');
(function () {
  const all = Array.from({ length: 200 }, (_, i) => 100 + i);   // 전체 200봉
  const n = 60, vStart = 100, winLen = 60;                       // 줌: 100~159 구간(60봉)
  const windowed = calcMA(all, n).slice(vStart, vStart + winLen);
  ok(windowed[0] != null, `줌 좌측(글로벌#100, ≥${n - 1}) MA${n} 비-null = 안 끊김 (${windowed[0]})`);
  // 같은 구간을 윈도우만으로 계산하면(옛 방식) 좌측이 워밍업 null → 대조
  const naive = calcMA(all.slice(vStart, vStart + winLen), n);
  ok(naive[0] === null, '대조: 윈도우만 계산하면 좌측 null(끊김) — maData 방식이 해결');
  // 룩어헤드: 윈도우 우측 끝값이 미래봉을 안 씀(전체를 현재까지로 잘라도 동일)
  const cutAtEnd = calcMA(all.slice(0, vStart + winLen), n).slice(vStart, vStart + winLen);
  ok(JSON.stringify(windowed) === JSON.stringify(cutAtEnd), 'maData 도 현재 시점까지로만 계산 → 룩어헤드 없음');
})();

// ── [G] B안 — 전일 종가 prepend 시 당일 09:00(인덱스 0)부터 MA 비-null ──
console.log('[G] 전일 포함 → 당일 첫 봉(09:00)부터 MA 이어짐');
(function () {
  const prev = Array.from({ length: 80 }, (_, i) => 1000 + i);   // 전일 80봉
  const today = Array.from({ length: 360 }, (_, i) => 1080 + i); // 당일 360봉
  const n1 = 30;                                                 // 재생 초반: 30봉만 노출
  const todayUpToN1 = today.slice(0, n1);
  // prcRender 와 동일: closesAll = prev + 당일(0..n1), maData = calcMA(all,n).slice(pn, pn+len)
  const pn = prev.length;
  for (const n of [5, 20, 60]) {
    const closesAll = prev.concat(todayUpToN1);
    const md = calcMA(closesAll, n).slice(pn, pn + todayUpToN1.length);
    ok(md[0] != null, `MA${n}: 당일 인덱스0(09:00) 비-null (전일 워밍업) = ${md[0]}`);
    ok(md.length === todayUpToN1.length, `MA${n}: 길이 당일 윈도우와 일치(${md.length})`);
  }
  // 대조: 전일 없으면 09:00 MA60 은 null(끊김) — 사용자가 본 증상
  const noPrev = calcMA(todayUpToN1, 60);
  ok(noPrev[0] === null, '대조: 전일 없으면 09:00 MA60=null(중간부터 시작) — B안이 해결');
  // 룩어헤드: 당일은 n1 까지만 합치므로 미래봉 안 씀(전일은 과거)
  const future = today.slice(0, n1 + 50);                        // 미래 50봉 더 있다고 가정
  const withFuture = calcMA(prev.concat(future), 60).slice(pn, pn + n1);   // 만약 미래까지 합치면
  const onlyPast = calcMA(prev.concat(todayUpToN1), 60).slice(pn, pn + n1);
  ok(JSON.stringify(withFuture) === JSON.stringify(onlyPast), '당일 MA[0..n1] 는 미래봉과 무관(룩어헤드 없음)');
})();

// ── [H] _prcPrevCloses — 전일 1분봉 종가를 tf 로 집계 ──
console.log('[H] _prcPrevCloses tf 집계');
(function () {
  const fn = extractFn(html, '_prcPrevCloses');
  const PRC2 = { prevCloses: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], tf: 1 };
  const _prcPrevCloses = new Function('PRC', fn + '; return _prcPrevCloses;')(PRC2);
  ok(JSON.stringify(_prcPrevCloses()) === JSON.stringify(PRC2.prevCloses), '1분봉: 그대로');
  PRC2.tf = 5;   // 5분봉: 각 5그룹의 마지막(종가) → [14, 19]
  ok(JSON.stringify(_prcPrevCloses()) === '[14,19]', `5분 집계 → ${JSON.stringify(_prcPrevCloses())} (기대 [14,19])`);
  PRC2.tf = 'D'; // 일봉 모드: 전일 prepend 불필요지만 호출돼도 tf=1 취급(안전)
  ok(Array.isArray(_prcPrevCloses()), '일봉 모드 호출도 배열 반환(무예외)');
})();

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
