// LLM 미사용 회귀 검증 (node, 의존성 없음) — 절대 규칙 1: 매매 판단·계산 경로에서 LLM API 호출 금지
// 실행:  node test/no_llm.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✖ FAIL: ' + m); } };

function extractFn(src, name) {
  const re = new RegExp('(?:async )?function ' + name + '\\(');
  const m = re.exec(src);
  if (!m) throw new Error('함수 못 찾음: ' + name);
  let i = src.indexOf('{', m.index), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(m.index, i);
}
const count = (src, name) => (src.match(new RegExp('(?:^|\\n)(?:async )?function ' + name + '\\(', 'g')) || []).length;

const files = ['trading-hts.html', 'trading-dashboard.html', 'server.js', 'build.js', 'src/dashboard/script.js', 'src/dashboard/body.html'];
const html = read('trading-hts.html');

console.log('[A] LLM 호출 흔적 0건');
const banned = [/\/api\/claude/, /\bcallClaude(Stream)?\b/, /ANTHROPIC_API_KEY/, /api\.anthropic\.com/, /sk-ant-/, /set-claude-key/, /\bclaudeAsk\b/, /\bconsComplete\b/,
  /\/v1\/messages/, /claude-(sonnet|haiku|opus)/, /x-api-key/i, /anthropic-version/i, /mcp\.notion\.com/, /['"`]\/api\/['"`]\s*\+\s*['"`]claude/];
for (const f of files) {
  const src = read(f);
  for (const re of banned) ok(!re.test(src), `${f} 에 ${re} 없음`);
}
// 옛 키 정리용 guard(delete o.claudeKey) 외에 claudeKey 참조가 없어야 한다
const ckLines = html.split('\n').filter((l) => /claudeKey/.test(l));
ok(ckLines.every((l) => /delete o\.claudeKey|옛 claudeKey/.test(l)), 'trading-hts.html claudeKey 는 옛 키 정리 guard 에만 남음');
ok(!/claudeKey/.test(read('server.js')), 'server.js 에 claudeKey 없음');

console.log('[B] 질문 복사 부품 + 바꾼 함수');
for (const n of ['copyAsk', '_copyAskDo', 'copyAskInline']) ok(count(html, n) === 1, `${n} 정의 1개`);
const converted = ['runMaterialAnalysis', 'runNewsImpact', 'runAIPatternAnalysis', 'runMySetupAI', 'askAIForFeatureSuggestion', 'ctxAskAI', 'genJModal', 'sendChat', 'loadSectorRanking', 'runIdxAIPrediction', 'addToWatchlistWithAnalysis', 'cleanupLearning', 'runFullAnalysis', 'consAsk', 'consRunMeeting', 'consCopyRow'];
for (const n of converted) ok(count(html, n) === 1, `${n} 정의 1개`);
const removed = ['runAISectorAnalysis', 'runAIStockScreening', '_aiRefineGenes', '_saveJournalToNotion', 'applyCoachingToAI', 'appendLesson', 'trackApiCall', 'updateUsageUI', 'checkApiKeyExpiry', 'consCollaborate', 'consExtractParams', 'consApplyParam'];
for (const n of removed) ok(!new RegExp('\\b' + n + '\\b').test(html), `${n} 제거됨(참조 포함)`);
// 비동기 호출부(.catch/.then)가 있는 함수는 Promise 를 돌려줘야 한다
ok(/async function runIdxAIPrediction\(/.test(html), 'runIdxAIPrediction 은 async 유지(.catch 호출부)');
ok(/async function cleanupLearning\(/.test(html), 'cleanupLearning 은 async 유지(.then 호출부)');

console.log('[C] runFullAnalysis — 로컬 분석만, 질문 복사는 🔍버튼(userInitiated)일 때만');
const rfa = extractFn(html, 'runFullAnalysis');
ok(/detectTechnique\(/.test(rfa), 'runFullAnalysis 가 로컬 detectTechnique 사용');
const gate = /if\s*\(\s*!\s*userInitiated\s*\)\s*return\s*;?/.exec(rfa);
ok(!!gate, '자동 호출(userInitiated 아님)은 여기서 종료');
ok(gate && rfa.indexOf('copyAsk(') > gate.index, 'copyAsk 는 userInitiated 분기 뒤에서만 호출');
ok(!/fetch\(/.test(rfa), 'runFullAnalysis 에 fetch 없음');

console.log('[D] 모든 바꾼 함수에 네트워크 호출 없음(강세섹터 로컬 서버 제외)');
// loadSectorRanking 은 로컬 서버(/api/local/hot-sectors), consAsk 는 결정적 자동반영(/api/agent/consult/apply-text) 경유
for (const n of converted.filter((x) => x !== 'loadSectorRanking' && x !== 'consAsk')) {
  const body = extractFn(html, n);
  ok(!/fetch\(/.test(body), `${n} 에 fetch 없음`);
}
ok(/fetch\('\/api\/local\/hot-sectors/.test(extractFn(html, 'loadSectorRanking')), 'loadSectorRanking 은 로컬 강세섹터 API 만 호출');

console.log('[F] 인라인 <script> 문법 + 대시보드 빌드 동기화');
for (const f of ['trading-hts.html', 'trading-dashboard.html']) {
  const h = read(f), re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0, bad = 0;
  while ((m = re.exec(h))) { n++; try { new vm.Script(m[1], { filename: f + '#' + n }); } catch (e) { bad++; console.error('   ', f, '#' + n, e.message); } }
  ok(n > 0 && bad === 0, `${f} 인라인 스크립트 ${n}개 문법 오류 0`);
}
const nl = (s) => s.replace(/\r\n/g, '\n');
const dash = nl(read('trading-dashboard.html'));
// build.js 는 __BUILD_TS__ 를 빌드 시각으로 바꾸므로, 그 자리를 기준으로 나눠 조각별로 포함 여부를 본다
const builtFrom = (p) => nl(read(p)).trim().split('__BUILD_TS__').every((piece) => dash.includes(piece));
ok(builtFrom('src/dashboard/script.js'), 'trading-dashboard.html 이 src/dashboard/script.js 최신 빌드 (node build.js)');
ok(builtFrom('src/dashboard/body.html'), 'trading-dashboard.html 이 src/dashboard/body.html 최신 빌드 (node build.js)');

console.log('[G] onclick 등 인라인 핸들러가 부르는 함수가 모두 정의돼 있음');
const defs = new Set();
for (const re of [/function\s+([A-Za-z_$][\w$]*)/g, /window\.([A-Za-z_$][\w$]*)\s*=/g, /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g]) { let m; while ((m = re.exec(html))) defs.add(m[1]); }
const builtins = new Set(['if', 'document', 'window', 'this', 'event', 'alert', 'confirm', 'location', 'setTimeout', 'var', 'const', 'let', 'return', 'navigator', 'history']);
const KNOWN_MISSING = new Set(['quickSwitch']);   // main 에서부터 정의 없음(기존 문제, 별도 수정 대상)
const missing = new Set(); { const re = /on(?:click|change|input|keydown|keyup|submit|mouseover|mouseout)=\\?["']\s*(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(/g; let m; while ((m = re.exec(html))) if (!builtins.has(m[1]) && !defs.has(m[1]) && !KNOWN_MISSING.has(m[1])) missing.add(m[1]); }
ok(missing.size === 0, '정의 안 된 인라인 핸들러 없음' + (missing.size ? ': ' + [...missing].join(', ') : ''));

console.log('[I] btState — /api/backtest/state 요청 합치기');
ok((html.match(/fetch\('\/api\/backtest\/state'/g) || []).length === 1, '/api/backtest/state 직접 fetch 는 btState 한 곳뿐');
const btSrc = extractFn(html, 'btState');
const btTests = (async () => {
  let n = 0, now = 1000;
  const ctx = { _btStateShared: { ts: 0, p: null }, Date: { now: () => now }, JSON, fetch: async () => { n++; return { text: async () => '{"ok":true,"v":' + n + '}' }; } };
  vm.createContext(ctx);
  vm.runInContext(btSrc, ctx);
  const [a, b] = await Promise.all([ctx.btState(), ctx.btState()]);
  ok(n === 1, '동시 호출 2번 → 서버 요청 1번');
  a.v = 99; ok(b.v === 1, '호출마다 별도 객체(한쪽 수정이 다른 쪽에 안 섞임)');
  now += 500; await ctx.btState(); ok(n === 2, '0.45초가 지나면 새로 요청');
})();

console.log('[J] 상담 전략 변경은 확인 후 적용');
const caat = extractFn(html, 'consAutoApplyText');
ok(/dry:true/.test(caat) && !/apply-param/.test(caat), 'consAutoApplyText 는 미리보기(dry)만 요청하고 직접 적용하지 않음');
const capc = extractFn(html, 'consApplyPreviewCard');
ok(capc.indexOf("addEventListener('click'") >= 0 && capc.indexOf('apply-param') > capc.indexOf("addEventListener('click'"), '실제 적용(apply-param)은 ✅ 적용 클릭 핸들러 안에서만');
ok(/dry \? \['--dry-run'\]/.test(read('server.js')), 'server.js apply-text 가 dry 를 --dry-run 으로 전달');

const lss = extractFn(html, 'loadSectorStocks');
ok(!/innerHTML/.test(lss) && !/onclick=/.test(lss), 'loadSectorStocks 는 HTML 문자열 없이 DOM/textContent 로만 그림(XSS 차단)');
ok(/\^\[0-9A-Z\]\{6\}\$/.test(lss), 'loadSectorStocks 는 종목코드 6자리 형식 검증');

console.log('[H] loadSectorRanking — 리플레이 미래참조 차단 + 관심종목/후보 미변경');
const lsrSrc = extractFn(html, 'loadSectorRanking');
const mkEl = () => ({ innerHTML: '', textContent: '', disabled: false, firstChild: { textContent: '' }, appendChild() {}, querySelector: () => ({ textContent: '', style: {} }) });
const runLSR = async (simDate, sectors) => {
  const el = mkEl(), calls = [];
  const ctx = {
    sim: { date: simDate }, _prevSectorRank: [], WGS: [['A'], [], []], CANDS: ['X'],
    _kstToday: () => '2026-11-02', loadSectorStocks() {},
    document: { getElementById: (id) => (id === 'sectorRankList' ? el : null), createElement: () => mkEl() },
    fetch: async (u) => { calls.push(u); return { json: async () => ({ ok: true, sectors }) }; },
  };
  vm.createContext(ctx);
  await vm.runInContext(lsrSrc + '; loadSectorRanking()', ctx);
  return { el, calls, ctx };
};
const lsrTests = (async () => {
  await btTests;
  const past = await runLSR('2026-10-15', []);
  ok(past.calls.length === 0, '과거 날짜 리플레이에서는 강세섹터 API 를 부르지 않음');
  ok(/과거 리플레이/.test(past.el.firstChild.textContent), '과거 날짜 리플레이 안내 표시');
  const live = await runLSR('2026-11-02', [{ rank: 1, name: '반도체', stocks: [{ name: 'X' }] }]);
  ok(live.calls.length === 1 && /hot-sectors/.test(live.calls[0]), '당일에는 로컬 강세섹터 API 1회 호출');
  ok(!/\b(WGS|CANDS|saveToServer|syncCandidatesToWatchlist|refreshHotSectors)\b/.test(lsrSrc), '순위 보기는 관심종목·진입후보·서버 저장을 건드리지 않음(코드에 참조 없음)');
  const none = await runLSR('2026-11-02', []);
  ok(/관망/.test(none.el.firstChild.textContent), '강세섹터가 없으면 관망 안내');
})();

console.log('[E] cleanupLearning 로컬 중복 정리 동작');
const src = extractFn(html, 'cleanupLearning');
const run = async (notes) => {
  const msgs = [];
  const ctx = {
    learningMemory: notes, window: {}, localStorage: { setItem() {} }, msgs,
    _backupLearning() {}, saveToServer() {}, renderLearningMgmt() {}, updateLearnerStage() {},
    addMsg(r, t) { msgs.push(t); }, showAlert(t, m) { msgs.push(m); },
    document: { querySelectorAll: () => [] },
  };
  vm.createContext(ctx);
  await vm.runInContext(src + '; cleanupLearning()', ctx);
  return { out: ctx.learningMemory, msgs };
};
(async () => {
  await lsrTests;
  const notes = [
    { date: '2026-11-01', category: '반성', text: '손절을 늦게 잡았다' },
    { date: '2026-11-02', category: '반성', text: '손절을  늦게 잡았다!' },      // 공백·기호만 다른 중복
    { date: '2026-11-02', category: '개선', text: '손절을 늦게 잡았다' },         // 분류가 다르면 유지
    { date: '2026-11-02', category: '개선', text: '## 오늘의 노트' },            // 제목줄 삭제
    { date: '2026-11-02', category: '심리', text: '연속 손절 뒤에는 쉬어간다 — 추가 설명' },
    { date: '2026-11-02', category: '반성', text: '# 반성\n손절이 늦었다' },          // 제목+본문 메모는 유지
  ];
  const r = await run(notes);
  ok(r.out.length === 4, `중복·제목줄 정리 후 4개 (실제 ${r.out.length})`);
  ok(r.out.some((n) => n.text === '# 반성\n손절이 늦었다'), '제목으로 시작해도 본문이 있는 메모는 유지');
  ok(r.out.filter((n) => n.category === '반성' && /늦게 잡았다/.test(n.text)).length === 1, '같은 분류·같은 문장은 1개만');
  ok(r.out.some((n) => n.category === '개선' && n.text === '손절을 늦게 잡았다'), '분류가 다르면 유지');
  ok(!r.out.some((n) => n.text === '## 오늘의 노트'), '제목만 있는 한 줄 메모 삭제');
  const r2 = await run([{ date: 'd', category: 'x', text: '## 제목만' }]);
  ok(r2.out.length === 1 && r2.msgs.some((t) => /원본 유지/.test(t)), '정리 결과가 비면 원본 유지');
  const r3 = await run([]);
  ok(r3.msgs.some((t) => /정리할 노트가 없습니다/.test(t)), '빈 노트는 안내만');

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
