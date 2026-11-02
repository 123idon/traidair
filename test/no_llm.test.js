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
const missing = new Set(); { const re = /on(?:click|change|input|keydown|keyup|submit|mouseover|mouseout)=\\?["']\s*(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(/g; let m; while ((m = re.exec(html))) if (!builtins.has(m[1]) && !defs.has(m[1])) missing.add(m[1]); }
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

console.log('[K] 가짜 데이터 금지(규칙 3) + 폴링 단일화');
const filtersSrc = (/const FILTERS=\[[\s\S]*?\];/.exec(html) || [''])[0];
ok(filtersSrc && !/stocks\s*:/.test(filtersSrc), 'FILTERS 에 고정 종목 "결과" 없음');
ok(/const NEWS=\[\];/.test(html), 'NEWS 고정 헤드라인 없음(실시간 피드 연동 전 빈 목록)');
ok(!/HBM4/.test(html), '가짜 뉴스 문구 없음');
ok(!/\.stocks\b/.test(extractFn(html, 'applySelectedFilters')), '조건검색이 고정 종목으로 결과를 만들지 않음');
ok((html.match(/btOnTick\(/g) || []).length >= 3 && !/setInterval\(tick,\s*[23]000\)/.test(html), '상태 위젯은 공용 2초 주기(btOnTick) 하나만 사용');
ok(/if\(document\.hidden\) return;/.test(extractFn(html, '_btTickRun')), '숨겨진 탭에서는 위젯 폴링 중지');

console.log('[L] saveToServer — 키별 큐(순서 보장·즉시 저장·실패 재시도·이탈 시 전송) + 매매 상태 localStorage 금지');
const saveTests = (async () => {
  const src = ['_nextSaveRev', 'saveToServer', '_saveFlush', '_saveOnPageHide'].map((fn) => extractFn(html, fn)).join('\n');
  const mk = (respond) => {
    const timers = [], posts = [], ls = {}, alerts = [];
    const ctx = {
      _saveQ: {}, _saveWarned: false, _saveRevSeq: 0, _SERVER_ONLY_KEYS: { htsMock: 1, htsStopOrders: 1 }, JSON, Math, Date, Object, console, Blob,
      localStorage: { setItem: (k, v) => { ls[k] = v; } },
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (id) => { if (id) timers[id - 1] = null; },
      showAlert: (t) => alerts.push(t),
      fetch: (u, o) => { const b = JSON.parse(o.body); const p = { key: u.split('/').pop(), value: b.value, rev: b.rev, keepalive: !!o.keepalive }; posts.push(p); return respond(p); },
    };
    vm.createContext(ctx); vm.runInContext(src, ctx);
    const run = async () => { for (let k = 0; k < 20; k++) { const t = timers.find((x) => x); if (!t) break; timers[timers.indexOf(t)] = null; t.fn(); await new Promise((r) => setImmediate(r)); } };
    return { ctx, timers, posts, ls, alerts, run };
  };
  const okResp = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });

  let t = mk(okResp);
  t.ctx.saveToServer('htsMock', { trades: [1] }); t.ctx.saveToServer('htsStopOrders', {}); t.ctx.saveToServer('htsJournals', 'j1'); t.ctx.saveToServer('htsJournals', 'j2');
  ok(t.timers.filter((x) => x && x.ms === 0).length === 2, '매매 상태 키는 기다리지 않고(0ms) 바로 저장 예약');
  await t.run();
  const keys = t.posts.map((p) => p.key);
  ok(keys.includes('htsMock') && keys.includes('htsStopOrders'), '연달아 저장한 두 키가 모두 서버로 전송(htsMock 유실 버그 회귀 방지)');
  ok(keys.filter((k) => k === 'htsJournals').length === 1 && t.posts.find((p) => p.key === 'htsJournals').value === 'j2', '일반 키는 디바운스로 마지막 값 1회만 전송');
  ok(!('htsMock' in t.ls) && !('htsStopOrders' in t.ls) && t.ls.htsJournals === 'j2', '매매 상태는 localStorage 금지(규칙 4), 그 외 키는 사본 유지');

  // 같은 키: 진행 중이면 다음 값을 기다렸다가 최신 값 1개만 이어서 전송
  let release; t = mk((p) => p.value === 'a' ? new Promise((r) => { release = () => r({ ok: true, json: () => Promise.resolve({ ok: true }) }); }) : okResp());
  t.ctx.saveToServer('htsMock', 'a'); await t.run();
  t.ctx.saveToServer('htsMock', 'b'); t.ctx.saveToServer('htsMock', 'c'); await t.run();
  ok(t.posts.length === 1, '같은 키 요청이 진행 중이면 다음 요청을 겹쳐 보내지 않음(순서 역전 방지)');
  release(); await new Promise((r) => setImmediate(r)); await t.run();
  ok(t.posts.map((p) => p.value).join() === 'a,c', '앞 요청이 끝난 뒤 최신 값(c)만 전송');

  // 실패(ok:false) → 재시도 + 경고 1회
  let n = 0; t = mk(() => (++n === 1 ? Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: 'disk' }) }) : okResp()));
  t.ctx.saveToServer('htsMock', 'x'); await t.run();
  ok(t.posts.length === 2 && t.posts[1].value === 'x', '서버가 저장을 거부하면 같은 값을 재시도');
  ok(t.alerts.length === 1, '저장 실패는 사용자에게 1회 경고');
  // 연속 실패 시 재시도 간격 2s → 4s → 8s … (최대 64s), 활성 타이머는 하나
  t = mk(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false }) }));
  t.ctx.saveToServer('htsMock', 'z');
  const delays = [];
  for (let k = 0; k < 8; k++) { const live = t.timers.filter((x) => x); if (live.length !== 1) break; const tm = live[0]; delays.push(tm.ms); t.timers[t.timers.indexOf(tm)] = null; tm.fn(); for (let w = 0; w < 4; w++) await new Promise((r) => setImmediate(r)); }
  ok(delays.join() === '0,2000,4000,8000,16000,32000,64000,64000', '재시도 간격 2s→…→64s 상한, 활성 타이머 1개 (실제 ' + delays.join() + ')');

  ok(t.posts.every((p) => typeof p.rev === 'number') && t.posts[0].rev <= t.posts[1].rev, '저장마다 rev(순번)를 함께 전송');

  // 응답이 ok:true 가 아니면(예: {}) 성공으로 보지 않음
  let m = 0; t = mk(() => (++m === 1 ? Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) : okResp()));
  t.ctx.saveToServer('htsMock', 'y'); await t.run();
  ok(t.posts.length === 2, 'ok:true 가 아닌 200 응답({})도 실패로 보고 재시도');

  // 페이지 이탈: 진행 중(응답 대기) 값과 대기 값 중 최신을 같은 rev 로 keepalive 재전송
  t = mk(() => new Promise(() => {}));   // 응답이 오지 않는 상태
  t.ctx.saveToServer('htsMock', 'inflight-v'); await t.run();
  ok(!!t.ctx._saveQ.htsMock.inflight && !t.ctx._saveQ.htsMock.pending, '(준비) 값이 진행 중 상태');
  t.ctx._saveOnPageHide();
  const ka = t.posts.filter((p) => p.keepalive);
  ok(ka.length === 1 && ka[0].value === 'inflight-v' && ka[0].rev === t.posts[0].rev, '이탈 시 진행 중 값도 같은 rev 로 keepalive 재전송');
  t.ctx.saveToServer('htsMock', 'newer'); t.ctx._saveOnPageHide();
  const ka2 = t.posts.filter((p) => p.keepalive);
  ok(ka2[ka2.length - 1].value === 'newer', '대기 값이 있으면 그 최신 값을 전송');
  ok(/addEventListener\('pagehide', _saveOnPageHide\)/.test(html), 'pagehide 이벤트에 연결됨');
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
  await saveTests;
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
