const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

// 멘토 시스템 프롬프트 — 클라이언트가 system 없이 호출 시 자동 주입
const MENTOR_SYSTEM = `당신은 주식 단타 전문 트레이딩 멘토이자 실전 파트너다. 20년 이상의 단타 경험을 가진 전문가로서 학습·분석·실전 조언을 모두 제공한다. 수익보다 손실 방어를 항상 우선하고 틀린 판단은 직접적으로 지적한다.

# 행동 원칙
- 틀린 판단은 직접 틀렸다고 한다. 애매한 표현 금지.
- 좋은 점보다 리스크와 문제점을 먼저 짚는다.
- 추측은 "(추정)", 확인 불가는 "확인 불가"로 명시.
- 결론 먼저, 근거는 그 다음.
- 수익보다 손실 방어가 우선.
- 단순 동조 없이 논리로 반박. 사용자 판단이 감정적으로 보이면 뇌동매매 경고를 먼저 발동.
- 투자 조언임을 인지하고 최종 판단은 본인이 내림을 전제.

# 사용자 현황
- 단타 경험 중급, 당일매매·스윙 해본 적 있음, 스캘핑은 학습 필요
- 주된 방식: 이슈/수급 기반 타점 진입 후 목표가 도달 시 익절

# 리스크 기본값
- 1회 매매 최대 비중: 자산의 20% 이하
- 종목당 최대 손실: 진입가 대비 -3%
- 일일 최대 손실: 자산의 -2%

# 보조지표 기본
- RSI 70+ 과매수 / 30- 과매도, 단타는 60 돌파 모멘텀
- MACD 12/26/9, 골든크로스 진입
- 볼린저 20/2σ, 수축 후 확장 시 돌파
- MA: 스캘핑 5/10, 당일 20/60, 스윙 60/120
- 거래량 전일 대비 300%+면 강한 수급

# 매매 시간대
- 스캘핑: 수초~수분, 0.3~1%
- 당일: 수분~당일청산, 1~5%
- 스윙: 2일~수주, 5~20%

# 뇌동매매 경고 신호
"빨리 들어가야", "다들 사고 있는", "본전만 오면", "물타기", 손실 중 추가매수, 손절 기준 낮추기, 연속 손실 후 즉각 재진입 → 분석 전에 경고 먼저.

# 면책
모든 분석은 참고용. 최종 판단은 본인. 원금 손실 가능.`;


// ── 환경변수 기반 설정 (Railway Variables에서 영구 유지)
// cfg.json에서 키 로드 (git 제외, Railway에 영구 보존)
let _localCfg = {};
try { _localCfg = JSON.parse(require('fs').readFileSync('./cfg.json','utf8')); } catch(e) {}

let runtimeConfig = {
  claudeKey:    process.env.ANTHROPIC_API_KEY || _localCfg.ck || '',
  kisAppKey:    process.env.KIS_APP_KEY       || _localCfg.ak || 'PSrI4OkbeIl4zTuwKEO1ORdKbPklB2NeeAp4',
  kisAppSecret: process.env.KIS_APP_SECRET    || _localCfg.as || 't8js7Q3Mh2HVkKdjWq4WK2QJAZtmi2oabSgLg1Y8ofaLde7ManMljS/D9hFjbw9csXRVncC2RRGBm8OUN+BabR+5u8hpsJx4s6wCh7X68hH6ETFyNn+Fzx/gt5zUDgNbS+ukh4KFKBntqVKt5MCCiD/vJ9IKv4ytAzrml3WyAp7uz5kZYjA=',
  kisAccount:   process.env.KIS_ACCOUNT       || _localCfg.ac || '',
  kisMode:      process.env.KIS_MODE          || _localCfg.md || 'real',
  dartKey:      process.env.DART_API_KEY      || _localCfg.dk || '',
  notionToken:  process.env.NOTION_TOKEN      || _localCfg.nt || '',
  notionPageId: process.env.NOTION_LECTURE_PAGE_ID || _localCfg.np || '35a0717882e381ce8fc3d257a5c24e4b',
};

// 파일 저장 경로 (Railway 볼륨 없으면 /tmp 사용 — 재시작 후 날아가지만 환경변수로 복원됨)
const CONFIG_PATH = path.join('/tmp', 'traidair_config.json');

function saveToFile(data) {
  try {
    const merged = { ...runtimeConfig, ...data, updatedAt: new Date().toISOString() };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  } catch(e) {}
}

console.log('✅ 설정 로드:', {
  claude: runtimeConfig.claudeKey ? '✅' : '❌',
  kis: runtimeConfig.kisAppKey ? '✅' : '❌',
  dart: runtimeConfig.dartKey ? '✅' : '❌',
  notion: runtimeConfig.notionToken ? '✅' : '❌',
});

// ── KIS 토큰 캐시 (메모리 + 디스크 영속)
// KIS access_token은 24시간 유효하지만 발급은 "앱키당 1분 1회"로 제한된다(EGW00133).
// 잦은 재발급이 레이트리밋을 유발 → soft TTL을 23h로 늘리고 디스크에 영속화한다.
// (특히 부팅 직후 mock 토큰 발급 → 곧바로 real 토큰 발급 시 같은 앱키라 real이
//  레이트리밋에 걸려 volume-rank/investor가 "토큰 없음"으로 실패하던 문제 해소)
const kisTokenCache = {};
const TOKEN_CACHE_PATH = path.join(__dirname, 'kis_token_cache.json');
const TOKEN_SOFT_TTL_MS = 23 * 60 * 60 * 1000;
const TOKEN_HARD_TTL_MS = 24 * 60 * 60 * 1000;

(function loadTokenCache() {
  try { Object.assign(kisTokenCache, JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf8'))); }
  catch (e) {}
})();

function saveTokenCache() {
  try { fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(kisTokenCache)); } catch (e) {}
}

function tokenErrorMessage(data) {
  return data.error_description || data.msg1 || data.error || data.msg_cd || 'unknown';
}

function isTokenRateLimited(data) {
  const m = `${tokenErrorMessage(data)} ${data.msg_cd || ''} ${data.error_code || ''}`;
  return /EGW00133|1\s*분|초과|접근.*토큰.*발급/i.test(m);
}

function kisHost(mode) {
  return mode === 'real'
    ? 'openapi.koreainvestment.com'
    : 'openapivts.koreainvestment.com';
}

function kisPort(mode) {
  // Railway 등 일부 cloud 환경은 9443/29443 outbound가 차단됨 → 443으로 강제 가능.
  // 로컬에서는 KIS 공식 포트(real=9443, mock=29443)를 사용해야 정상 응답.
  if (process.env.KIS_FORCE_PORT_443 === 'true') return 443;
  return mode === 'real' ? 9443 : 29443;
}

function kisRequest(opts, body) {
  return new Promise((resolve, reject) => {
    // port가 없으면 모드에 따라 자동 설정
    if (!opts.port) {
      const mode = opts._mode || 'real';
      opts.port = kisPort(mode);
    }
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, data: {} }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('KIS 서버 응답 없음 (8초 초과)')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function getKisToken(appKey, appSecret, mode) {
  const cacheKey = appKey + mode;
  const now = Date.now();
  const cached = kisTokenCache[cacheKey];
  if (cached && cached.token && cached.expires > now) return cached.token;

  const body = JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret });
  const result = await kisRequest({
    hostname: kisHost(mode),
    port: kisPort(mode),
    path: '/oauth2/tokenP',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, body);

  const token = result.data.access_token;
  if (token) {
    kisTokenCache[cacheKey] = {
      token,
      expires: now + TOKEN_SOFT_TTL_MS,
      hardExpires: now + TOKEN_HARD_TTL_MS,
    };
    saveTokenCache();
    return token;
  }

  // ── 발급 실패 — 사유 분류 + 캐시 폴백 ──
  console.error('[KIS 토큰 실패]', 'mode:', mode, 'host:', kisHost(mode),
    'port:', kisPort(mode), 'status:', result.status,
    'response:', JSON.stringify(result.data).slice(0, 300));

  // 24시간 하드 만료 전이면 (soft 만료됐어도) 기존 토큰 재사용 → 레이트리밋 회피
  if (cached && cached.token && cached.hardExpires && cached.hardExpires > now) {
    console.warn('[KIS 토큰] 재발급 실패 — 캐시 토큰 재사용 (hard TTL 내)');
    return cached.token;
  }

  const msg = tokenErrorMessage(result.data);
  if (isTokenRateLimited(result.data)) {
    // ai-agent가 auth-error로 오해해 즉시 재발급(해머링)하지 않도록 별도 메시지 사용
    throw new Error(`토큰 발급 제한(1분당 1회, 잠시 후 재시도): ${msg}`);
  }
  throw new Error(`토큰 발급 실패: ${msg}`);
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve({}); }
      });
    }).on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const CORP_CODE_MAP = {
  '삼성전자': '00126380', 'SK하이닉스': '00164779', '현대차': '00164742',
  'POSCO홀딩스': '00146163', 'NAVER': '00266961', 'LG화학': '00116003',
  '삼성SDI': '00126355', 'LG': '00108320', '삼성물산': '00149655',
  '현대모비스': '00164742', 'LG전자': '00109662', '삼성생명': '00115368',
  '신한지주': '00381622', 'KB금융': '00222348', '기아': '00109439',
  'SK이노베이션': '00126186', 'LG에너지솔루션': '01596564', '삼성바이오로직스': '00935816',
  '셀트리온': '00421045', '카카오': '00918444', 'SK바이오팜': '01330714',
  '에코프로': '00641417', '에코프로비엠': '01024671', 'HLB': '00104321',
  '알테오젠': '00562360', '한미반도체': '00109533', 'HMM': '00107517',
  '대한항공': '00104667', '크래프톤': '01520734',
};

// ── ai-agent 현황 요약 빌더 (대시보드 패널용) ───────────────────────────
const AGENT_DIR = process.env.AI_AGENT_DIR || 'C:\\ai-team';

// ── 백테스트 프로세스 제어 (traidair 시작/중지/리셋 버튼, §17.7) ──
const { spawn } = require('child_process');
let btProc = null;   // 실행 중인 run_backtest.py 자식 프로세스

function btPython() {
  const venv = path.join(AGENT_DIR, '.venv', 'Scripts', 'python.exe');
  return process.env.AI_AGENT_PY || (fs.existsSync(venv) ? venv : 'python');
}

function btStopSentinel()  { return path.join(AGENT_DIR, 'state', 'BACKTEST_STOP'); }
function btPauseSentinel() { return path.join(AGENT_DIR, 'state', 'BACKTEST_PAUSE'); }
function btStateFile()     { return path.join(AGENT_DIR, 'state', 'backtest_live.json'); }

// 백테스트 엔진이 "지금 살아서 진행 중"인지 — 추적 PID + 상태파일 신선도(2초)로 판정.
// 일시정지 중에도 대시보드가 250ms마다 파일을 갱신하므로 fresh=true → 살아있음으로 본다.
function btAlive() {
  if (btProc && !btProc.killed) return true;
  try { return (Date.now() - fs.statSync(btStateFile()).mtimeMs) < 2000; } catch (e) { return false; }
}
function btPaused() { try { return fs.existsSync(btPauseSentinel()); } catch (e) { return false; } }

// 새 백테스트 시작 — 가상잔고는 **항상 정확히 100만원**(요구 3, 엔진이 하드코딩),
// 날짜 범위는 주입하지 않아 로컬 수집 데이터 전체에서 **랜덤 추첨**(요구 2).
function startBacktest(extraEnv = {}) {
  if (btAlive()) return { ok: false, error: '이미 실행 중이에요' };
  try { fs.unlinkSync(btStopSentinel());  } catch (e) {}
  try { fs.unlinkSync(btPauseSentinel()); } catch (e) {}
  try { fs.unlinkSync(btStateFile());     } catch (e) {}   // 깨끗한 시작(이전 잔재 제거)
  const env = { ...process.env, ...extraEnv };
  env.BACKTEST_AUTO_SPEED = env.BACKTEST_AUTO_SPEED || '1';   // 자동 배속 기본 ON
  env.BACKTEST_STEP_MS = env.BACKTEST_STEP_MS || '45';        // 캔들 하나씩 보이는 속도
  const script = path.join(AGENT_DIR, 'scripts', 'run_backtest.py');
  try {
    btProc = spawn(btPython(), [script], { cwd: AGENT_DIR, env, windowsHide: true, stdio: 'ignore' });
    btProc.on('exit', () => { btProc = null; });
    return { ok: true, state: 'started', pid: btProc.pid };
  } catch (e) {
    btProc = null;
    return { ok: false, error: e.message };
  }
}

// 일시정지(센티넬 기록) — 엔진은 살아있고 가상 시각 전진만 멈춘다('이어서 진행' 가능).
function pauseBacktest()  { try { fs.writeFileSync(btPauseSentinel(), String(Date.now())); } catch (e) {} return { ok: true, state: 'paused' }; }
function resumeBacktest() { try { fs.unlinkSync(btPauseSentinel()); } catch (e) {} return { ok: true, state: 'resumed' }; }

// 토글(요구 1) — 버튼 하나로 시작 ↔ 일시정지 ↔ 이어서 진행.
function toggleBacktest() {
  if (!btAlive()) return startBacktest();          // 정지/완료 → 새로 시작
  if (btPaused())  return resumeBacktest();         // 일시정지 → 이어서 진행
  return pauseBacktest();                           // 진행 중 → 일시정지
}

// 완전 정지 + 초기화 — 프로세스 종료, 센티넬/상태파일 제거(다음 시작은 100만원부터).
function stopBacktest() {
  try { fs.writeFileSync(btStopSentinel(), String(Date.now())); } catch (e) {}
  try { fs.unlinkSync(btPauseSentinel()); } catch (e) {}
  if (btProc && !btProc.killed) {
    const pid = btProc.pid;
    try {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch (e) {
      try { btProc.kill(); } catch (_) {}
    }
    btProc = null;
    return { ok: true, pid };
  }
  btProc = null;
  return { ok: true, msg: '정지 센티넬 기록 (추적 PID 없음 — 고아 프로세스도 곧 종료)' };
}

// ── 메타 진화(최적화 제안 실행) 프로세스 제어 (HTS 🧬 진화+ 버튼, §2.7) ──
let evProc = null;   // 실행 중인 run_evolve.py 자식 프로세스

function startEvolve({ days } = {}) {
  if (evProc && !evProc.killed) return { ok: false, error: '진화가 이미 실행 중이에요' };
  const env = { ...process.env };
  if (days) env.EVOLVE_DAYS = String(days);
  const script = path.join(AGENT_DIR, 'scripts', 'run_evolve.py');
  try {
    // windowsHide:true → 별도 콘솔(검은 창) 안 뜸.
    evProc = spawn(btPython(), [script], { cwd: AGENT_DIR, env, windowsHide: true, stdio: 'ignore' });
    evProc.on('exit', () => { evProc = null; });
    return { ok: true, pid: evProc.pid };
  } catch (e) {
    evProc = null;
    return { ok: false, error: e.message };
  }
}

function kstDateStr() {
  // 서버 TZ와 무관하게 KST(UTC+9) 기준 YYYYMMDD
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

// ════════════════════════════════════════════════════════════════════════
//  ai-agent ↔ traidair 통합 레이어 (/api/agent/*)
//  원칙: KIS API는 traidair만 호출. ai-agent는 X-Agent-Key 헤더로 HTTP만 호출.
//  구현: 검증된 기존 /api/kis/* · /api/market-data 라우트를 내부 루프백으로 래핑하고,
//        traidair가 보관한 KIS 키를 주입한다(에이전트는 키를 모름).
// ════════════════════════════════════════════════════════════════════════
const AGENT_KEY = process.env.AGENT_KEY || _localCfg.agentKey || 'traidair-agent-dev';
function agentAuthOk(req) {
  const k = req.headers['x-agent-key'];
  return !AGENT_KEY || k === AGENT_KEY;
}
function agentDeny(res) {
  res.writeHead(401, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify({ ok: false, error: 'unauthorized — X-Agent-Key 헤더 필요' }));
}
// traidair가 보관한 KIS 키/계좌(에이전트에 노출하지 않음).
function kisKeys() {
  return { appKey: runtimeConfig.kisAppKey, appSecret: runtimeConfig.kisAppSecret, mode: runtimeConfig.kisMode || 'real' };
}
function kisAccount() { return runtimeConfig.kisAccount || ''; }

// 내부 루프백 — 같은 서버의 기존 라우트를 HTTP로 호출(기존 로직 재사용, 무수정).
function callSelf(routePath, { method = 'GET', body = null } = {}) {
  return new Promise((resolve) => {
    const data = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const opts = {
      hostname: '127.0.0.1', port: PORT, path: routePath, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    };
    const r = http.request(opts, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ ok: false, error: 'loopback parse 실패' }); } });
    });
    r.on('error', e => resolve({ ok: false, error: e.message }));
    r.setTimeout(9000, () => { r.destroy(); resolve({ ok: false, error: 'loopback timeout' }); });
    if (data) r.write(data);
    r.end();
  });
}

// ── 보조지표 계산(신호분석 에이전트용) ──
function _sma(a, p) { const o = Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= p) s -= a[i - p]; if (i >= p - 1) o[i] = s / p; } return o; }
function _ema(a, p) { const o = Array(a.length).fill(null); const k = 2 / (p + 1); let e = null; for (let i = 0; i < a.length; i++) { e = (e == null) ? a[i] : a[i] * k + e * (1 - k); if (i >= p - 1) o[i] = e; } return o; }
function _rsiArr(a, p) { const o = Array(a.length).fill(null); let ag = 0, al = 0; for (let i = 1; i < a.length; i++) { const ch = a[i] - a[i - 1], g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0; if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } } else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } } return o; }
function _lastNN(a) { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; }
function computeIndicators(candles) {
  const c = candles.map(x => x.c), v = candles.map(x => x.v || 0);
  if (!c.length) return { lastClose: null, ma5: null, ma20: null, ma60: null, rsi: null, macd: { macd: null, signal: null, hist: null }, volumeRatio: null };
  const m5 = _sma(c, 5), m20 = _sma(c, 20), m60 = _sma(c, 60), rsi = _rsiArr(c, 14);
  const e12 = _ema(c, 12), e26 = _ema(c, 26);
  const macd = c.map((_, i) => (e12[i] != null && e26[i] != null) ? e12[i] - e26[i] : null);
  const sig = _ema(macd.map(x => x == null ? 0 : x), 9).map((x, i) => macd[i] == null ? null : x);
  const hist = macd.map((x, i) => (x != null && sig[i] != null) ? x - sig[i] : null);
  const last = c.length - 1;
  const recentVol = v.slice(Math.max(0, last - 20), last);
  const avgVol = recentVol.length ? recentVol.reduce((a, b) => a + b, 0) / recentVol.length : 0;
  return {
    lastClose: c[last], ma5: _lastNN(m5), ma20: _lastNN(m20), ma60: _lastNN(m60),
    rsi: _lastNN(rsi), macd: { macd: _lastNN(macd), signal: _lastNN(sig), hist: _lastNN(hist) },
    volumeRatio: avgVol > 0 ? Number((v[last] / avgVol).toFixed(3)) : null,
  };
}

// ── WebSocket(/ws/market) — 의존성 없이 RFC6455 텍스트 프레임 직접 구현 ──
const wsClients = new Set();
let wsTimer = null;
function wsFrame(str) {
  const payload = Buffer.from(str, 'utf8'), len = payload.length;
  let header;
  if (len < 126) { header = Buffer.from([0x81, len]); }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  return Buffer.concat([header, payload]);
}
async function wsMarketSnapshot() {
  try { return await callSelf('/api/market-data?mode=realtime', { method: 'GET' }); }
  catch (e) { return { ok: false, error: e.message }; }
}
function wsBroadcastStart() {
  if (wsTimer) return;
  wsTimer = setInterval(async () => {
    if (!wsClients.size) return;
    const data = await wsMarketSnapshot();
    const frame = wsFrame(JSON.stringify({ type: 'market', ts: new Date().toISOString(), data }));
    for (const s of wsClients) { try { s.write(frame); } catch (e) { wsClients.delete(s); } }
  }, 3000);
  if (wsTimer.unref) wsTimer.unref();
}

function readAgentMode() {
  try {
    const t = fs.readFileSync(path.join(AGENT_DIR, 'config', 'mode.yaml'), 'utf8');
    const m = t.match(/current_mode:\s*([A-Za-z]+)/);
    return m ? m[1] : 'unknown';
  } catch (e) { return 'unknown'; }
}

function summarizeRecord(topic, p) {
  try {
    switch (topic) {
      case 'screening.candidates': return `${p.code || ''} ${p.name || ''} (${(p.score != null ? Number(p.score).toFixed(0) : '?')}점)`;
      case 'signal.entry': return `${p.symbol} ${p.signal} ${p.score_count || ''}/5`;
      case 'signal.exit': return `${p.symbol} ${p.kind} ${p.pnl_pct != null ? (p.pnl_pct * 100).toFixed(2) + '%' : ''}`;
      case 'risk.decision.approved': return `APPROVE ${p.symbol} qty=${p.qty} @${p.price}`;
      case 'risk.decision.rejected': { const v = (p.violations && p.violations[0]) || {}; return `REJECT ${p.symbol} ${v.rule_id || ''}`; }
      case 'order.event': return `${(p.side || '').toUpperCase()} ${p.symbol} qty=${p.qty} @${p.price}`;
      case 'order.failed': return `FAIL ${p.symbol} ${(p.error || '').slice(0, 40)}`;
      case 'market.state': return `${p.grade} (${p.reason || ''})`;
      case 'meta.observation': { const pf = p.performance || {}; return `trades=${pf.trades || 0} win=${pf.win_rate != null ? (pf.win_rate * 100).toFixed(0) + '%' : '?'}`; }
      case 'learning.proposal': return `${p.kind || 'proposal'} ${p.proposal_id || ''} ${(p.rationale || '').slice(0, 50)}`;
      default: return '';
    }
  } catch (e) { return ''; }
}

function buildAgentStatus() {
  const today = kstDateStr();
  const status = {
    ok: true,
    agentDir: AGENT_DIR,
    date: today,
    mode: readAgentMode(),
    killed: fs.existsSync(path.join(AGENT_DIR, 'state', 'KILL_SWITCH')),
    online: false,            // 오늘 journal 기록이 있으면 true로 간주
    market: null,
    counts: {},
    trades: 0, wins: 0, losses: 0, winRate: 0, totalPnlPct: 0,
    openPositions: [],
    proposals: [],
    observation: null,
    recent: [],
    updatedAt: new Date().toISOString(),
  };

  const jpath = path.join(AGENT_DIR, 'data', 'journal', `${today}.jsonl`);
  let records = [];
  try {
    const raw = fs.readFileSync(jpath, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch (e) {}
    }
  } catch (e) { /* 오늘 기록 없음 */ }

  status.online = records.length > 0;

  const counts = {};
  const netQty = {};        // 심볼별 매수-매도 추정
  const exits = [];
  let lastMarket = null, lastObs = null;
  const proposals = {};

  for (const rec of records) {
    const topic = rec.topic || '';
    const p = (rec.payload && typeof rec.payload === 'object') ? rec.payload : {};
    counts[topic] = (counts[topic] || 0) + 1;
    if (topic === 'order.event') {
      const q = Number(p.qty) || 0;
      const sign = (p.side === 'sell') ? -1 : 1;
      netQty[p.symbol] = (netQty[p.symbol] || 0) + sign * q;
    } else if (topic === 'signal.exit') {
      exits.push(Number(p.pnl_pct) || 0);
    } else if (topic === 'market.state') {
      lastMarket = { grade: p.grade, reason: p.reason, ts: rec.ts };
    } else if (topic === 'meta.observation') {
      lastObs = p;
    } else if (topic === 'learning.proposal' && p.proposal_id) {
      proposals[p.proposal_id] = { id: p.proposal_id, kind: p.kind, rationale: p.rationale, ts: rec.ts };
    }
  }

  status.counts = counts;
  status.market = lastMarket;
  status.observation = lastObs ? {
    performance: lastObs.performance || null,
    tokenCalls: (lastObs.tokens && lastObs.tokens.total_calls) || 0,
    wasteFindings: (lastObs.tokens && lastObs.tokens.waste_findings) ? lastObs.tokens.waste_findings.length : 0,
  } : null;
  status.proposals = Object.values(proposals);

  status.trades = exits.length;
  status.wins = exits.filter(x => x > 0).length;
  status.losses = exits.filter(x => x < 0).length;
  status.winRate = status.trades ? status.wins / status.trades : 0;
  status.totalPnlPct = exits.reduce((a, b) => a + b, 0);

  status.openPositions = Object.entries(netQty)
    .filter(([, q]) => q > 0)
    .map(([code, qty]) => ({ code, qty }));

  status.recent = records.slice(-40).reverse().map(rec => ({
    ts: rec.ts,
    topic: rec.topic,
    summary: summarizeRecord(rec.topic, (rec.payload && typeof rec.payload === 'object') ? rec.payload : {}),
  }));

  // 신용 원장 (있으면)
  try {
    status.creditLedger = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'state', 'credit_ledger.json'), 'utf8'));
  } catch (e) { status.creditLedger = null; }

  return status;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS); res.end(); return;
  }

  const url = req.url.split('?')[0];
  const query = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');

  // ── 설정 저장 (/api/save-config)
  if (url === '/api/save-config' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const cfg = JSON.parse(body);
        if (cfg.claudeKey && cfg.claudeKey.startsWith('sk-ant-')) runtimeConfig.claudeKey = cfg.claudeKey;
        if (cfg.kisAppKey)    runtimeConfig.kisAppKey = cfg.kisAppKey;
        if (cfg.kisAppSecret) runtimeConfig.kisAppSecret = cfg.kisAppSecret;
        if (cfg.kisAccount)   runtimeConfig.kisAccount = cfg.kisAccount;
        if (cfg.kisMode)      runtimeConfig.kisMode = cfg.kisMode;
        if (cfg.dartKey)      runtimeConfig.dartKey = cfg.dartKey;
        if (cfg.notionToken)   runtimeConfig.notionToken = cfg.notionToken;
        if (cfg.notionPageId)  runtimeConfig.notionPageId = cfg.notionPageId;
        saveToFile(runtimeConfig);
        console.log('✅ 설정 저장:', Object.keys(cfg).join(', '));
        // GitHub에 영구 저장 (재배포 후에도 유지)
        saveConfigToGitHub(runtimeConfig).then(ok => {
          if(ok) console.log('✅ GitHub 영구 저장 완료');
        }).catch(()=>{});
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true, saved: Object.keys(cfg), github: true }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── 설정 조회 (/api/get-config)
  if (url === '/api/get-config') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({
      ok: true,
      claudeKeyFull: runtimeConfig.claudeKey || '',
      claudeKey: runtimeConfig.claudeKey ? runtimeConfig.claudeKey.slice(0,10)+'...' : '',
      kisAppKey:    runtimeConfig.kisAppKey || '',
      kisAppSecret: runtimeConfig.kisAppSecret || '',
      kisAccount:   runtimeConfig.kisAccount || '',
      kisMode:      runtimeConfig.kisMode || 'mock',
      dartKey:      runtimeConfig.dartKey || '',
      notionToken:  runtimeConfig.notionToken ? runtimeConfig.notionToken.slice(0,10)+'...' : '',
      notionTokenSet: !!runtimeConfig.notionToken,
      notionPageId: runtimeConfig.notionPageId || '',
    }));
    return;
  }

  // ── Claude 키 세션 설정 (/api/set-claude-key)
  if (url === '/api/set-claude-key' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { key } = JSON.parse(body);
        if (key && key.startsWith('sk-ant-')) runtimeConfig.claudeKey = key;
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  // ── Claude API 프록시
  if (url === '/api/claude' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const apiKey = runtimeConfig.claudeKey || '';
      if (!apiKey) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'Claude API 키 없음. 설정창에서 키를 입력하세요.' }));
        return;
      }
      // 시스템 프롬프트 자동 주입 + prompt caching 적용 (input 토큰 ~90% 절감)
      // 1024 토큰 이상이어야 cache 적용됨. MENTOR_SYSTEM은 약 1100자/약 800토큰
      // → ephemeral 5분 캐시. 같은 system 반복 호출 시 input 비용 1/10
      let bodyToSend = body;
      try{
        const parsed = JSON.parse(body);
        // ★ user message에 들어있는 강의 컨텍스트를 자동으로 system으로 분리 (캐시 적용)
        // 강의 컨텍스트는 '【강의 원칙' 또는 '강의 매매 원칙'으로 시작
        let extractedLecture = '';
        if(Array.isArray(parsed.messages) && parsed.messages.length){
          const lastUser = parsed.messages.find(m => m.role === 'user');
          if(lastUser && typeof lastUser.content === 'string'){
            const m = lastUser.content.match(/【강의 원칙[^】]*】[\s\S]*?(?=\n【|\n\d|$)/);
            if(m && m[0].length > 200){
              extractedLecture = m[0];
              lastUser.content = lastUser.content.replace(m[0], '').trim();
            }
          }
        }
        // system 처리 — string이면 cache 가능한 배열로 변환
        let baseSys = parsed.system;
        if(typeof baseSys === 'string' && baseSys) baseSys = [{ type:'text', text: baseSys }];
        if(!baseSys) baseSys = [{ type:'text', text: MENTOR_SYSTEM }];
        // 강의 컨텍스트를 system 끝에 추가 (별도 cache breakpoint)
        const sysArr = baseSys.map((b, i) => ({ ...b, cache_control: { type:'ephemeral' } }));
        if(extractedLecture){
          sysArr.push({ type:'text', text: extractedLecture, cache_control: { type:'ephemeral' } });
        }
        parsed.system = sysArr;
        // 자동 모델 다운그레이드: sonnet + max_tokens<=300 → haiku
        if(parsed.model === 'claude-sonnet-4-5' && (parsed.max_tokens||0) <= 300){
          parsed.model = 'claude-haiku-4-5';
        }
        bodyToSend = JSON.stringify(parsed);
      }catch(e){ /* 파싱 실패 시 원본 그대로 전달 */ }
      const opts = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(bodyToSend),
        },
      };
      const pr = https.request(opts, proxyRes => {
        let d = '';
        proxyRes.on('data', c => d += c);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json', ...CORS });
          res.end(d);
        });
      });
      pr.on('error', e => { res.writeHead(500, CORS); res.end(JSON.stringify({ error: e.message })); });
      pr.write(bodyToSend); pr.end();
    });
    return;
  }

  // ── Claude 스트리밍 (/api/claude/stream) — SSE 그대로 중계 (상담 말풍선 잘림 해결, 요구 1) ──
  // /api/claude 와 동일한 system 캐싱 처리 후 stream:true 로 Anthropic 응답을 클라이언트에
  // text/event-stream 으로 흘려보낸다. 클라이언트는 델타를 누적해 말풍선을 점진 렌더한다.
  if (url === '/api/claude/stream' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const apiKey = runtimeConfig.claudeKey || '';
      const sseErr = (msg) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...CORS });
        res.write('event: error\ndata: ' + JSON.stringify({ error: msg }) + '\n\n');
        res.end();
      };
      if (!apiKey) { sseErr('Claude API 키 없음. 설정창에서 키를 입력하세요.'); return; }
      let bodyToSend = body;
      try {
        const parsed = JSON.parse(body);
        let extractedLecture = '';
        if (Array.isArray(parsed.messages) && parsed.messages.length) {
          const lastUser = parsed.messages.find(m => m.role === 'user');
          if (lastUser && typeof lastUser.content === 'string') {
            const m = lastUser.content.match(/【강의 원칙[^】]*】[\s\S]*?(?=\n【|\n\d|$)/);
            if (m && m[0].length > 200) { extractedLecture = m[0]; lastUser.content = lastUser.content.replace(m[0], '').trim(); }
          }
        }
        let baseSys = parsed.system;
        if (typeof baseSys === 'string' && baseSys) baseSys = [{ type: 'text', text: baseSys }];
        if (!baseSys) baseSys = [{ type: 'text', text: MENTOR_SYSTEM }];
        const sysArr = baseSys.map(b => ({ ...b, cache_control: { type: 'ephemeral' } }));
        if (extractedLecture) sysArr.push({ type: 'text', text: extractedLecture, cache_control: { type: 'ephemeral' } });
        parsed.system = sysArr;
        parsed.stream = true;                      // ★ 스트리밍 강제
        bodyToSend = JSON.stringify(parsed);
      } catch (e) { /* 파싱 실패 시 원본 그대로 + stream 보장 못함 → 그냥 전달 */ }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...CORS });
      const opts = {
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'x-api-key': apiKey,
          'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(bodyToSend),
        },
      };
      const pr = https.request(opts, proxyRes => {
        proxyRes.on('data', c => { try { res.write(c); } catch (e) {} });
        proxyRes.on('end', () => { try { res.end(); } catch (e) {} });
      });
      pr.on('error', e => { try { res.write('event: error\ndata: ' + JSON.stringify({ error: e.message }) + '\n\n'); res.end(); } catch (_) {} });
      pr.write(bodyToSend); pr.end();
    });
    return;
  }

  // ── KIS 토큰 (/api/kis/token)
  if (url === '/api/kis/token' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode } = JSON.parse(body);
        const ak = appKey || runtimeConfig.kisAppKey;
        const as = appSecret || runtimeConfig.kisAppSecret;
        const md = mode || runtimeConfig.kisMode || 'real';
        if (!ak || !as) throw new Error('appKey/appSecret 필요');
        console.log('[KIS 토큰 요청]', 'mode:', md, 'host:', kisHost(md), 'keyLen:', ak.length);
        const token = await getKisToken(ak, as, md);
        if (!token) throw new Error('토큰 발급 실패');
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true, token: token.slice(0, 10) + '...' }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 분봉 차트 (/api/kis/chart)
  // 모의투자용: 해당 날짜 특정 종목의 실제 분봉 데이터
  if (url === '/api/kis/chart' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode, code, date, tf } = JSON.parse(body);
        if (!appKey || !appSecret) throw new Error('appKey/appSecret 필요');
        const token = await getKisToken(appKey, appSecret, mode || 'real');
        if (!token) throw new Error('토큰 발급 실패');

        const interval = tf === '1' ? '1' : tf === '3' ? '3' : tf === '15' ? '15' : tf === '60' ? '60' : '5';

        // 당일 + 전일 분봉을 합쳐서 연속 차트 구성
        // KIS FHKST03010200: 특정일 분봉 조회
        const targetDate = (date || new Date().toISOString().slice(0,10)).replace(/-/g,'');

        // 전일 날짜 계산 (주말 건너뜀)
        const getPrevBusinessDay = (dateStr) => {
          const d = new Date(dateStr.slice(0,4)+'-'+dateStr.slice(4,6)+'-'+dateStr.slice(6,8));
          do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
          return d.toISOString().slice(0,10).replace(/-/g,'');
        };
        const prevDate = getPrevBusinessDay(targetDate);

        const fetchDayCandles = async (dayStr) => {
          // KIS 일별 분봉 차트 — fid_input_date_1로 과거 일자 지정 (미래 데이터 사용 절대 금지)
          const result = await kisRequest({
            hostname: kisHost('real'),
            port: kisPort('real'),
            path: `/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice?fid_etc_cls_code=&fid_cond_mrkt_div_code=J&fid_input_iscd=${code}&fid_input_hour_1=${interval}&fid_input_date_1=${dayStr}&fid_pw_data_inqu_yn=Y`,
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'authorization': `Bearer ${token}`,
              'appkey': appKey, 'appsecret': appSecret,
              'tr_id': 'FHKST03010230',
              'custtype': 'P',
            },
          });
          const output2 = result.data.output2 || [];
          const filtered = output2
            .filter(r => r.stck_bsop_date === dayStr) // ★ 요청 날짜만 — 미래 데이터 차단
            .map(r => ({
              t: `${r.stck_cntg_hour.slice(0,2)}:${r.stck_cntg_hour.slice(2,4)}`,
              date: r.stck_bsop_date,
              o: parseInt(r.stck_oprc || r.stck_prpr),
              h: parseInt(r.stck_hgpr || r.stck_prpr),
              l: parseInt(r.stck_lwpr || r.stck_prpr),
              c: parseInt(r.stck_prpr),
              v: parseInt(r.cntg_vol || 0),
            }))
            .filter(c => c.c > 0)
            .sort((a, b) => a.t.localeCompare(b.t));
          return filtered;
        };

        // 전일 + 당일 병렬 조회
        const [prevCandles, todayCandles] = await Promise.all([
          fetchDayCandles(prevDate).catch(() => []),
          fetchDayCandles(targetDate).catch(() => []),
        ]);

        // 전일 분봉에 날짜 태그 추가 (차트 구분용)
        const allCandles = [
          ...prevCandles.map(c => ({ ...c, isPrev: true })),
          ...todayCandles,
        ];

        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({
          ok: true, code, date: targetDate, prevDate, tf: interval,
          candles: allCandles,
          prevCount: prevCandles.length,
          todayCount: todayCandles.length,
        }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 호가창 (/api/kis/orderbook)
  if (url === '/api/kis/orderbook' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode, code } = JSON.parse(body);
        if (!appKey || !appSecret) throw new Error('appKey/appSecret 필요');
        const token = await getKisToken(appKey, appSecret, mode || 'real');
        if (!token) throw new Error('토큰 발급 실패');

        const result = await kisRequest({
          hostname: kisHost('real'),
          port: kisPort('real'),
          path: `/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn?fid_cond_mrkt_div_code=J&fid_input_iscd=${code}`,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': appKey, 'appsecret': appSecret,
            'tr_id': 'FHKST01010200', 'custtype': 'P',
          },
        });

        const out = result.data.output1 || {};
        const asks = [], bids = [];
        for (let i = 1; i <= 10; i++) {
          asks.push({ price: parseInt(out[`askp${i}`]||0), qty: parseInt(out[`askp_rsqn${i}`]||0) });
          bids.push({ price: parseInt(out[`bidp${i}`]||0), qty: parseInt(out[`bidp_rsqn${i}`]||0) });
        }
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true, asks, bids,
          totalAsk: parseInt(out.total_askp_rsqn||0), totalBid: parseInt(out.total_bidp_rsqn||0),
          strength: parseFloat(out.seln_rsqn_rate||100),
        }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 현재가 (/api/kis/price)
  if (url === '/api/kis/price' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode, code } = JSON.parse(body);
        const token = await getKisToken(appKey, appSecret, mode || 'mock');
        if (!token) throw new Error('토큰 없음');
        const result = await kisRequest({
          hostname: kisHost(mode || 'mock'),
          port: kisPort(mode || 'mock'),
          path: `/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${code}`,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': appKey, 'appsecret': appSecret, 'tr_id': 'FHKST01010100',
          },
        });
        const out = result.data.output || {};
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({
          ok: true, code,
          price: parseInt(out.stck_prpr || 0), open: parseInt(out.stck_oprc || 0),
          high: parseInt(out.stck_hgpr || 0), low: parseInt(out.stck_lwpr || 0),
          volume: parseInt(out.acml_vol || 0), change: parseInt(out.prdy_vrss || 0),
          changePct: out.prdy_ctrt || '0.00', name: out.hts_kor_isnm || code,
        }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 주문 (/api/kis/order)
  if (url === '/api/kis/order' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode, account, side, code, qty, price, orderType } = JSON.parse(body);
        if (!appKey || !appSecret || !account) throw new Error('필수 정보 누락');
        const token = await getKisToken(appKey, appSecret, mode || 'mock');
        if (!token) throw new Error('토큰 없음');
        const isMock = (mode || 'mock') === 'mock';
        const trId = side === 'buy' ? (isMock ? 'VTTC0802U' : 'TTTC0802U') : (isMock ? 'VTTC0801U' : 'TTTC0801U');
        const ordDvsn = orderType === 'market' ? '01' : '00';
        const [acntPfx, acntSfx] = account.includes('-') ? account.split('-') : [account.slice(0,8), account.slice(8)];
        const orderBody = { CANO: acntPfx, ACNT_PRDT_CD: acntSfx || '01', PDNO: code, ORD_DVSN: ordDvsn, ORD_QTY: String(qty), ORD_UNPR: ordDvsn === '01' ? '0' : String(price) };
        const bodyStr = JSON.stringify(orderBody);
        const result = await kisRequest({
          hostname: kisHost(mode || 'mock'),
          port: kisPort(mode || 'mock'), path: '/uapi/domestic-stock/v1/trading/order-cash', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), 'authorization': `Bearer ${token}`, 'appkey': appKey, 'appsecret': appSecret, 'tr_id': trId, 'custtype': 'P', 'hashkey': '' },
        }, bodyStr);
        const d = result.data;
        if (d.rt_cd === '0') {
          res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({ ok: true, ordNo: d.output?.odno, msg: d.msg1 || '주문 완료' }));
        } else throw new Error(d.msg1 || `주문 실패 (rt_cd: ${d.rt_cd})`);
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 잔고 (/api/kis/balance)
  if (url === '/api/kis/balance' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode, account } = JSON.parse(body);
        const token = await getKisToken(appKey, appSecret, mode || 'mock');
        if (!token) throw new Error('토큰 없음');
        const [acntPfx, acntSfx] = account.includes('-') ? account.split('-') : [account.slice(0,8), account.slice(8)];
        const isMock = (mode || 'mock') === 'mock';
        const result = await kisRequest({
          hostname: kisHost(mode || 'mock'),
          port: kisPort(mode || 'mock'),
          path: `/uapi/domestic-stock/v1/trading/inquire-balance?CANO=${acntPfx}&ACNT_PRDT_CD=${acntSfx||'01'}&AFHR_FLPR_YN=N&OFL_YN=&INQR_DVSN=02&UNPR_DVSN=01&FUND_STTL_ICLD_YN=N&FNCG_AMT_AUTO_RDPT_YN=N&PRCS_DVSN=01&CTX_AREA_FK100=&CTX_AREA_NK100=`,
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${token}`, 'appkey': appKey, 'appsecret': appSecret, 'tr_id': isMock ? 'VTTC8434R' : 'TTTC8434R' },
        });
        const d = result.data;
        const output2 = d.output2?.[0] || {};
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({
          ok: true,
          cash: parseInt(output2.dnca_tot_amt || 0),
          totalEval: parseInt(output2.tot_evlu_amt || 0),
          totalPnl: parseInt(output2.evlu_pfls_smtl_amt || 0),
          positions: (d.output1 || []).map(p => ({
            code: p.pdno, name: p.prdt_name, qty: parseInt(p.hldg_qty || 0),
            avgPrice: parseInt(p.pchs_avg_pric || 0), currentPrice: parseInt(p.prpr || 0),
            evalAmt: parseInt(p.evlu_amt || 0), pnl: parseInt(p.evlu_pfls_amt || 0), pnlPct: p.evlu_pfls_rt || '0.00',
            loanDt: p.loan_dt || '', crdtType: p.crdt_type || '',
          })),
        }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 신용주문 (/api/kis/order-credit) — 실전 전용
  // body: { appKey, appSecret, mode, account, side:"buy|sell", code, qty, price, orderType:"limit|market", crdtType?, loanDate? }
  // 신용유형(CRDT_TYPE) 기본값: buy="21"(자기융자신규), sell="25"(자기융자상환). 매도 시 loanDate(YYYYMMDD) 필수.
  if (url === '/api/kis/order-credit' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode, account, side, code, qty, price, orderType, crdtType, loanDate } = JSON.parse(body);
        if (!appKey || !appSecret || !account) throw new Error('필수 정보 누락');
        if ((mode || 'real') !== 'real') throw new Error('신용주문은 실전(real) 모드 전용');
        if (side === 'sell' && !loanDate) throw new Error('신용 매도 시 loanDate(YYYYMMDD) 필수');
        const token = await getKisToken(appKey, appSecret, 'real');
        if (!token) throw new Error('토큰 없음');
        const trId = side === 'buy' ? 'TTTC0852U' : 'TTTC0851U';
        const ordDvsn = orderType === 'market' ? '01' : '00';
        const [acntPfx, acntSfx] = account.includes('-') ? account.split('-') : [account.slice(0,8), account.slice(8)];
        const orderBody = {
          CANO: acntPfx,
          ACNT_PRDT_CD: acntSfx || '01',
          PDNO: code,
          CRDT_TYPE: crdtType || (side === 'buy' ? '21' : '25'),
          LOAN_DT: loanDate || '',
          ORD_DVSN: ordDvsn,
          ORD_QTY: String(qty),
          ORD_UNPR: ordDvsn === '01' ? '0' : String(price),
        };
        const bodyStr = JSON.stringify(orderBody);
        const result = await kisRequest({
          hostname: kisHost('real'),
          port: kisPort('real'),
          path: '/uapi/domestic-stock/v1/trading/order-credit',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            'authorization': `Bearer ${token}`,
            'appkey': appKey, 'appsecret': appSecret,
            'tr_id': trId, 'custtype': 'P', 'hashkey': '',
          },
        }, bodyStr);
        const d = result.data;
        if (d.rt_cd === '0') {
          res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({
            ok: true,
            ordNo: d.output?.ODNO || d.output?.odno,
            krxFwdgOrgno: d.output?.KRX_FWDG_ORD_ORGNO || d.output?.krx_fwdg_ord_orgno,
            ordTime: d.output?.ORD_TMD || d.output?.ord_tmd,
            msg: d.msg1 || '신용주문 완료',
          }));
        } else throw new Error(d.msg1 || `신용주문 실패 (rt_cd: ${d.rt_cd})`);
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 주문 정정/취소 (/api/kis/order-cancel)
  // body: { appKey, appSecret, mode, account, orgOrdNo, krxFwdgOrgno, code?, action:"cancel|modify", qty, price, orderType, qtyAllOrd?:"Y|N" }
  // action='cancel' → RVSE_CNCL_DVSN_CD='02', 'modify' → '01'
  if (url === '/api/kis/order-cancel' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode, account, orgOrdNo, krxFwdgOrgno, action, qty, price, orderType, qtyAllOrd } = JSON.parse(body);
        if (!appKey || !appSecret || !account || !orgOrdNo) throw new Error('필수 정보 누락 (orgOrdNo 포함)');
        const token = await getKisToken(appKey, appSecret, mode || 'mock');
        if (!token) throw new Error('토큰 없음');
        const isMock = (mode || 'mock') === 'mock';
        const trId = isMock ? 'VTTC0803U' : 'TTTC0803U';
        const ordDvsn = orderType === 'market' ? '01' : '00';
        const rvseCnclCd = action === 'cancel' ? '02' : '01';
        const [acntPfx, acntSfx] = account.includes('-') ? account.split('-') : [account.slice(0,8), account.slice(8)];
        const orderBody = {
          CANO: acntPfx,
          ACNT_PRDT_CD: acntSfx || '01',
          KRX_FWDG_ORD_ORGNO: krxFwdgOrgno || '',
          ORGN_ODNO: String(orgOrdNo),
          ORD_DVSN: ordDvsn,
          RVSE_CNCL_DVSN_CD: rvseCnclCd,
          ORD_QTY: String(qty || 0),
          ORD_UNPR: action === 'cancel' ? '0' : String(price || 0),
          QTY_ALL_ORD_YN: qtyAllOrd || 'Y',
        };
        const bodyStr = JSON.stringify(orderBody);
        const result = await kisRequest({
          hostname: kisHost(mode || 'mock'),
          port: kisPort(mode || 'mock'),
          path: '/uapi/domestic-stock/v1/trading/order-rvsecncl',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            'authorization': `Bearer ${token}`,
            'appkey': appKey, 'appsecret': appSecret,
            'tr_id': trId, 'custtype': 'P', 'hashkey': '',
          },
        }, bodyStr);
        const d = result.data;
        if (d.rt_cd === '0') {
          res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({
            ok: true,
            ordNo: d.output?.ODNO || d.output?.odno,
            krxFwdgOrgno: d.output?.KRX_FWDG_ORD_ORGNO || d.output?.krx_fwdg_ord_orgno,
            ordTime: d.output?.ORD_TMD || d.output?.ord_tmd,
            action,
            msg: d.msg1 || (action === 'cancel' ? '취소 완료' : '정정 완료'),
          }));
        } else throw new Error(d.msg1 || `${action} 실패 (rt_cd: ${d.rt_cd})`);
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 미체결 조회 (/api/kis/unfilled)
  // body: { appKey, appSecret, mode, account }
  // 정정/취소 가능한 미체결 주문 목록. 결과의 ordNo/krxFwdgOrgno는 /api/kis/order-cancel 입력으로 사용.
  if (url === '/api/kis/unfilled' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode, account } = JSON.parse(body);
        if (!appKey || !appSecret || !account) throw new Error('필수 정보 누락');
        const token = await getKisToken(appKey, appSecret, mode || 'mock');
        if (!token) throw new Error('토큰 없음');
        const isMock = (mode || 'mock') === 'mock';
        const [acntPfx, acntSfx] = account.includes('-') ? account.split('-') : [account.slice(0,8), account.slice(8)];
        const result = await kisRequest({
          hostname: kisHost(mode || 'mock'),
          port: kisPort(mode || 'mock'),
          path: `/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl?CANO=${acntPfx}&ACNT_PRDT_CD=${acntSfx||'01'}&CTX_AREA_FK100=&CTX_AREA_NK100=&INQR_DVSN_1=0&INQR_DVSN_2=0`,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': appKey, 'appsecret': appSecret,
            'tr_id': isMock ? 'VTTC8036R' : 'TTTC8036R',
          },
        });
        const d = result.data;
        const orders = (d.output || []).map(o => ({
          ordNo: o.odno,
          orgOrdNo: o.orgn_odno || '',
          krxFwdgOrgno: o.ord_gno_brno || '',
          code: o.pdno,
          name: o.prdt_name,
          side: o.sll_buy_dvsn_cd === '02' ? 'buy' : 'sell',
          ordQty: parseInt(o.ord_qty || 0),
          filledQty: parseInt(o.tot_ccld_qty || 0),
          unfilledQty: parseInt(o.rmn_qty || (parseInt(o.ord_qty||0) - parseInt(o.tot_ccld_qty||0))),
          ordPrice: parseInt(o.ord_unpr || 0),
          avgFilledPrice: parseInt(o.avg_prvs || 0),
          ordTime: o.ord_tmd,
          ordDvsn: o.ord_dvsn_cd,
          ordDvsnName: o.ord_dvsn_name,
          rvseCnclName: o.rvse_cncl_dvsn_name,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true, count: orders.length, orders }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 매수가능금액·신용 가용액 (/api/kis/inquire-psbl-order)
  // body: { appKey, appSecret, mode, account, code?, price?, orderType?:"limit|market" }
  // 종목/단가 없이도 조회 가능 (계좌 전체 가용액).
  if (url === '/api/kis/inquire-psbl-order' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode, account, code, price, orderType } = JSON.parse(body);
        if (!appKey || !appSecret || !account) throw new Error('필수 정보 누락');
        const token = await getKisToken(appKey, appSecret, mode || 'mock');
        if (!token) throw new Error('토큰 없음');
        const isMock = (mode || 'mock') === 'mock';
        const [acntPfx, acntSfx] = account.includes('-') ? account.split('-') : [account.slice(0,8), account.slice(8)];
        const ordDvsn = orderType === 'market' ? '01' : '00';
        const path = `/uapi/domestic-stock/v1/trading/inquire-psbl-order?CANO=${acntPfx}&ACNT_PRDT_CD=${acntSfx||'01'}&PDNO=${code||''}&ORD_UNPR=${price||0}&ORD_DVSN=${ordDvsn}&CMA_EVLU_AMT_ICLD_YN=N&OVRS_ICLD_YN=N`;
        const result = await kisRequest({
          hostname: kisHost(mode || 'mock'),
          port: kisPort(mode || 'mock'),
          path,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': appKey, 'appsecret': appSecret,
            'tr_id': isMock ? 'VTTC8908R' : 'TTTC8908R',
          },
        });
        const o = result.data.output || {};
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({
          ok: true,
          orderCashable: parseInt(o.ord_psbl_cash || 0),         // 주문가능현금
          orderSubst: parseInt(o.ord_psbl_sbst || 0),            // 주문가능대용금
          reusableAmt: parseInt(o.ruse_psbl_amt || 0),           // 재사용가능금액
          fundRcvableAmt: parseInt(o.fund_rcvable_amt || 0),     // 펀드환매대금
          maxBuyAmt: parseInt(o.max_buy_amt || 0),               // 최대매수금액(현금+신용)
          maxBuyQty: parseInt(o.max_buy_qty || 0),               // 최대매수수량
          cmaEvluAmt: parseInt(o.cma_evlu_amt || 0),             // CMA 평가금액
          ovrsRusePsblAmt: parseInt(o.ovrs_re_use_amt_wcrc || 0),
          raw: o,
        }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 거래대금/거래량 상위 (/api/kis/volume-rank)
  // body: { appKey, appSecret, mode, market?:"0000|0001|1001", rankBy?:"0|1|2|3|4", minPrice?, maxPrice?, topN? }
  //   market: 0000=전체, 0001=코스피, 1001=코스닥
  //   rankBy: 0=평균거래량, 1=거래증가율, 2=평균거래회전율, 3=거래금액순(기본), 4=평균거래금액회전율
  if (url === '/api/kis/volume-rank' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, market, rankBy, minPrice, maxPrice, topN } = JSON.parse(body);
        if (!appKey || !appSecret) throw new Error('appKey/appSecret 필요');
        const token = await getKisToken(appKey, appSecret, 'real');
        if (!token) throw new Error('토큰 없음');
        const mk = market || '0000';
        const blng = String(rankBy != null ? rankBy : '3');
        const path = `/uapi/domestic-stock/v1/quotations/volume-rank?FID_COND_MRKT_DIV_CODE=J&FID_COND_SCR_DIV_CODE=20171&FID_INPUT_ISCD=${mk}&FID_DIV_CLS_CODE=0&FID_BLNG_CLS_CODE=${blng}&FID_TRGT_CLS_CODE=111111111&FID_TRGT_EXLS_CLS_CODE=000000&FID_INPUT_PRICE_1=${minPrice||0}&FID_INPUT_PRICE_2=${maxPrice||0}&FID_VOL_CNT=0&FID_INPUT_DATE_1=`;
        const result = await kisRequest({
          hostname: kisHost('real'),
          port: kisPort('real'),
          path,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': appKey, 'appsecret': appSecret,
            'tr_id': 'FHPST01710000', 'custtype': 'P',
          },
        });
        const out = result.data.output || [];
        const limit = topN || 30;
        const items = out.slice(0, limit).map(r => ({
          rank: parseInt(r.data_rank || 0),
          code: r.mksc_shrn_iscd,
          name: r.hts_kor_isnm,
          price: parseInt(r.stck_prpr || 0),
          change: parseInt(r.prdy_vrss || 0),
          changePct: parseFloat(r.prdy_ctrt || 0),
          volume: parseInt(r.acml_vol || 0),
          turnover: parseInt(r.acml_tr_pbmn || 0),    // 거래대금(원)
          volSurgePct: parseFloat(r.vol_inrt || 0),   // 거래량 증가율
          volTurnoverPct: parseFloat(r.vol_tnrt || 0),// 거래회전율
          listedShares: parseInt(r.lstn_stcn || 0),
          avgTurnoverPct: parseFloat(r.avrg_tr_pbmn || 0),
        }));
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true, market: mk, rankBy: blng, count: items.length, items }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 종목별 투자자 수급 (/api/kis/investor)
  // body: { appKey, appSecret, mode, code }
  // 최근 30영업일 외인/기관/개인 순매수 (수량 + 금액 천원).
  if (url === '/api/kis/investor' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, code } = JSON.parse(body);
        if (!appKey || !appSecret || !code) throw new Error('필수 정보 누락 (code 포함)');
        const token = await getKisToken(appKey, appSecret, 'real');
        if (!token) throw new Error('토큰 없음');
        const result = await kisRequest({
          hostname: kisHost('real'),
          port: kisPort('real'),
          path: `/uapi/domestic-stock/v1/quotations/inquire-investor?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': appKey, 'appsecret': appSecret,
            'tr_id': 'FHKST01010900', 'custtype': 'P',
          },
        });
        const out = result.data.output || [];
        const series = out.map(r => ({
          date: r.stck_bsop_date,
          close: parseInt(r.stck_clpr || 0),
          change: parseInt(r.prdy_vrss || 0),
          changeSign: r.prdy_vrss_sign,
          foreignerQty: parseInt(r.frgn_ntby_qty || 0),
          institutionQty: parseInt(r.orgn_ntby_qty || 0),
          individualQty: parseInt(r.prsn_ntby_qty || 0),
          foreignerAmt: parseInt(r.frgn_ntby_tr_pbmn || 0),       // 천원 단위
          institutionAmt: parseInt(r.orgn_ntby_tr_pbmn || 0),
          individualAmt: parseInt(r.prsn_ntby_tr_pbmn || 0),
        }));
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true, code, count: series.length, series }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── DART 공시 (/api/dart/list)
  if (url === '/api/dart/list') {
    const dartKey = runtimeConfig.dartKey;
    if (!dartKey) {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ status: 'no_key', list: [] }));
      return;
    }
    try {
      const corpCode = query.get('corp_code') || '';
      const days = parseInt(query.get('days') || '1');
      const today = new Date();
      const from = new Date(today - days * 86400000);
      const fmt = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      const dartUrl = corpCode
        ? `https://opendart.fss.or.kr/api/list.json?crtfc_key=${dartKey}&corp_code=${corpCode}&bgn_de=${fmt(from)}&end_de=${fmt(today)}&sort=date&sort_mth=desc&page_count=20`
        : `https://opendart.fss.or.kr/api/list.json?crtfc_key=${dartKey}&bgn_de=${fmt(from)}&end_de=${fmt(today)}&sort=date&sort_mth=desc&page_count=30`;
      const data = await httpsGet(dartUrl);
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ status: 'ok', list: data.list || [], total: data.total_count || 0 }));
    } catch(e) {
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ status: 'error', error: e.message, list: [] }));
    }
    return;
  }

  // ── 노션 기능목록 DB 조회 (/api/notion-features GET)
  if (url === '/api/notion-features' && req.method === 'GET') {
    const notionKey = runtimeConfig.notionToken || process.env.NOTION_TOKEN || '';
    if (!notionKey) {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ ok: false, error: '노션 토큰 없음' }));
      return;
    }
    const dbId = 'b3969a236c064476ac82d296b03184de';
    const body = JSON.stringify({ page_size: 100 });
    const nr = https.request({
      hostname: 'api.notion.com', path: `/v1/databases/${dbId}/query`, method: 'POST',
      headers: { 'Authorization': `Bearer ${notionKey}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, nRes => {
      let d = ''; nRes.on('data', c => d += c);
      nRes.on('end', () => {
        try {
          const j = JSON.parse(d);
          const items = (j.results || []).map(p => {
            const pr = p.properties || {};
            return {
              id: p.id,
              name: pr['기능명']?.title?.[0]?.plain_text || '',
              category: pr['카테고리']?.select?.name || '',
              status: pr['작동상태']?.select?.name || '📋 미확인',
              priority: pr['우선순위']?.select?.name || '',
              desc: pr['설명']?.rich_text?.[0]?.plain_text || '',
              memo: pr['메모']?.rich_text?.[0]?.plain_text || '',
            };
          });
          res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({ ok: true, items }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    });
    nr.on('error', e => { res.writeHead(500, CORS); res.end(JSON.stringify({ ok: false, error: e.message })); });
    nr.write(body); nr.end();
    return;
  }

  // ── 사용자 데이터 저장 (/api/user-data POST)
  if (url === '/api/user-data' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const ok = saveUserData(data);
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── 사용자 데이터 조회 (/api/user-data GET)
  if (url === '/api/user-data' && req.method === 'GET') {
    const data = loadUserData();
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: true, data }));
    return;
  }

  // ── 특정 키만 저장 (/api/user-data/key POST)
  if (url.startsWith('/api/user-data/') && req.method === 'POST') {
    const key = url.replace('/api/user-data/', '').replace(/[^a-zA-Z0-9_-]/g, '');
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { value } = JSON.parse(body);
        const ok = saveUserData({ [key]: value });
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok, key }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── DART 고유번호 (/api/dart/corpcode)
  if (url === '/api/dart/corpcode') {
    const nm = query.get('nm') || '';
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ corp_code: CORP_CODE_MAP[nm] || null }));
    return;
  }

  // ── DART 상태 (/api/dart/status)
  if (url === '/api/dart/status') {
    const dartKey = runtimeConfig.dartKey;
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ has_key: !!dartKey, key_hint: dartKey ? dartKey.slice(0,4)+'****' : null }));
    return;
  }

  // ── 시장 데이터 통합 API (/api/market-data)
  // 실시간: ?mode=realtime
  // 모의투자 특정 시각: ?mode=sim&date=YYYY-MM-DD&time=HH:MM&tf=5
  if (url.startsWith('/api/market-data')) {
    const qStr = req.url.includes('?') ? req.url.split('?')[1] : '';
    const params = new URLSearchParams(qStr);
    const mode = params.get('mode') || 'realtime';
    const simDate = params.get('date');   // YYYY-MM-DD
    const simTime = params.get('time');   // HH:MM (모의투자 현재 시각)
    const tf = parseInt(params.get('tf') || '5'); // 분봉 단위

    const https = require('https');

    // Yahoo Finance 5분봉 데이터 fetcher
    const fetchYahoo = (symbol, period1, period2, interval='5m') => new Promise((resolve, reject) => {
      const path2 = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${period1}&period2=${period2}`;
      const opts = {
        hostname: 'query1.finance.yahoo.com',
        path: path2,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept': 'application/json' },
        timeout: 8000,
      };
      const r = https.get(opts, res2 => {
        let d = '';
        res2.on('data', c => d += c);
        res2.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (!j.chart?.result?.[0]) { reject(new Error('no result')); return; }
            const result = j.chart.result[0];
            const meta = result.meta;
            const timestamps = result.timestamp || [];
            const quotes = result.indicators?.quote?.[0] || {};
            const closes = quotes.close || [];
            // 타임스탬프별 데이터 매핑
            const bars = [];
            for (let i = 0; i < timestamps.length; i++) {
              if (closes[i] != null) {
                bars.push({
                  ts: timestamps[i],          // unix timestamp (초)
                  o: quotes.open?.[i],
                  h: quotes.high?.[i],
                  l: quotes.low?.[i],
                  c: closes[i],
                  v: quotes.volume?.[i] || 0,
                });
              }
            }
            resolve({
              symbol,
              price: meta.regularMarketPrice,
              prev: meta.previousClose || meta.chartPreviousClose,
              currency: meta.currency,
              bars,
              meta,
            });
          } catch(e) { reject(e); }
        });
      });
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    });

    // KST 기준으로 period 계산
    const KST_OFFSET = 9 * 3600;
    let period1, period2, cutoffTs;
    // 전일 영업일 계산 (주말 건너뜀)
    const getPrevBusinessDay = (yr, mo, dy) => {
      const d = new Date(Date.UTC(yr, mo-1, dy));
      do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
      return d;
    };

    if (mode === 'sim' && simDate && simTime) {
      const [yr, mo, dy] = simDate.split('-').map(Number);
      const [hh, mm] = simTime.split(':').map(Number);
      const prevDay = getPrevBusinessDay(yr, mo, dy);
      const prevYr = prevDay.getUTCFullYear(), prevMo = prevDay.getUTCMonth()+1, prevDy = prevDay.getUTCDate();

      // ── 국내 지수 (코스피/코스닥): 해당일 장 시작(9:00 KST) ~ simTime ──
      // ── 미국 지수 (나스닥/S&P): 전날 미국 장 시작(22:30 KST) ~ 익일 5:00 KST ──
      // 전날 00:00 KST부터 당일 종료까지 충분히 포함
      period1 = Math.floor(new Date(Date.UTC(prevYr, prevMo-1, prevDy, 0, 0, 0)).getTime() / 1000);
      period2 = Math.floor(new Date(Date.UTC(yr, mo-1, dy, 15, 30, 0)).getTime() / 1000); // 당일 장 마감 KST
      // simTime 기준 cutoff (미래 차단)
      cutoffTs = Math.floor(new Date(Date.UTC(yr, mo-1, dy, hh-9, mm, 0)).getTime() / 1000) + tf * 60;
    } else {
      // 실시간 모드
      const now = Math.floor(Date.now() / 1000);
      period1 = now - 2 * 24 * 3600;
      period2 = now;
      cutoffTs = now;
    }

    // 캐시 키
    const cacheKey = `${mode}_${simDate}_${simTime}_${tf}`;
    if (!global._mktCache) global._mktCache = {};
    const cached = global._mktCache[cacheKey];
    const CACHE_TTL = mode === 'realtime' ? 3 * 60 * 1000 : 30 * 60 * 1000; // 실시간 3분, 모의 30분
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify(cached.data));
      return;
    }

    try {
      // 병렬로 모든 지수 데이터 가져오기
      const SYMBOLS = {
        kospi:  '^KS11',
        kosdq:  '^KQ11',
        nasdaq: '^IXIC',
        sp500:  '^GSPC',
        dow:    '^DJI',
        usdkrw: 'KRW=X',
        vix:    '^VIX',
        nikkei: '^N225',
        kospi200: '^KS200',
      };

      // 과거 날짜(60일 이상)는 5분봉 없음 → 1d 인터벌 사용
    const isHistorical = (() => {
      if (mode !== 'sim' || !simDate) return false;
      const simMs = new Date(simDate).getTime();
      const nowMs = Date.now();
      return (nowMs - simMs) > 55 * 24 * 3600 * 1000; // 55일 이상 과거
    })();
    const interval = isHistorical ? '1d' : tf <= 5 ? '5m' : tf <= 60 ? '60m' : '1d';
      const fetchAll = Object.entries(SYMBOLS).map(([key, sym]) =>
        fetchYahoo(sym, period1, period2, interval)
          .then(r => ({ key, ...r }))
          .catch(e => ({ key, symbol: sym, error: e.message, bars: [], price: null }))
      );
      const raw = await Promise.all(fetchAll);

      // 결과 정리: 지수별로 올바른 기준 시간 적용
      const result = {};
      for (const item of raw) {
        // 지수별 cutoff 조정:
        // 국내(코스피/코스닥): cutoffTs 그대로 (KST 기준)
        // 미국(나스닥/S&P/다우/VIX): 해당일 미국 장 마감 기준 (전날 KST 6:00 = 전날 미국 21:00 EST)
        // 환율(USD/KRW): 실시간에 가까운 값 사용
        let useCutoff = cutoffTs;
        const isKorean = ['kospi','kosdq','kospi200'].includes(item.key);
        const isUS = ['nasdaq','sp500','dow','vix'].includes(item.key);
        if (mode === 'sim' && simDate) {
          if (isUS) {
            // 미국 장: 전날 KST 06:00 마감 (당일 KST 기준 전날 미국 마감)
            const [yr, mo, dy] = simDate.split('-').map(Number);
            useCutoff = Math.floor(new Date(Date.UTC(yr, mo-1, dy, 6-9, 0, 0)).getTime() / 1000);
            // 음수 방지: 전날 21:00 UTC
            if (useCutoff < 0) useCutoff = Math.floor(new Date(Date.UTC(yr, mo-1, dy-1, 21, 0, 0)).getTime() / 1000);
          }
        }

        const filteredBars = item.bars.filter(b => b.ts < useCutoff);
        const lastBar = filteredBars[filteredBars.length - 1];
        // 전일 종가: 국내는 전일 15:30, 미국은 전전일 마감
        const prevBars = isKorean && mode === 'sim' && simDate
          ? item.bars.filter(b => {
              const [yr, mo, dy] = simDate.split('-').map(Number);
              const dayStart = Math.floor(new Date(Date.UTC(yr, mo-1, dy, 0, 0, 0)).getTime() / 1000);
              return b.ts < dayStart;
            })
          : filteredBars.slice(0, -1);
        const prevBar = prevBars[prevBars.length - 1];

        const currentPrice = lastBar?.c ?? null;
        const prevClose = prevBar?.c ?? item.prev ?? null;
        const chgPct = (currentPrice && prevClose) ? ((currentPrice - prevClose) / prevClose * 100) : null;
        const lastTs = lastBar?.ts ?? null;

        result[item.key] = {
          price: currentPrice ? Math.round(currentPrice * 100) / 100 : null,
          prev: prevClose ? Math.round(prevClose * 100) / 100 : null,
          chgPct: chgPct != null ? Math.round(chgPct * 100) / 100 : null,
          lastUpdated: lastTs ? new Date(lastTs * 1000).toISOString() : null,
          lastUpdatedKST: lastTs ? new Date((lastTs + KST_OFFSET) * 1000).toISOString().replace('T', ' ').substring(0, 19) + ' KST' : null,
          barsCount: filteredBars.length,
          bars: mode === 'sim' ? filteredBars.map(b => ({ ts: b.ts, c: b.c, o: b.o, h: b.h, l: b.l })) : [],
        };
      }

      // 야간선물: KIS API 없이는 실제 데이터 불가 — 표시 안 함
      // (나스닥 기반 추정값은 가짜 데이터이므로 제거)

      const responseData = {
        mode,
        simDate,
        simTime,
        cutoffKST: new Date((cutoffTs + KST_OFFSET) * 1000).toISOString().replace('T',' ').substring(0,19) + ' KST',
        fetchedAt: new Date().toISOString(),
        indices: result,
      };

      // 캐시 저장
      global._mktCache[cacheKey] = { ts: Date.now(), data: responseData };

      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify(responseData));
    } catch(e) {
      console.error('market-data error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── 레거시 호환 (/api/market-index)
  if (url === '/api/market-index') {
    res.writeHead(302, { Location: '/api/market-data?mode=realtime' });
    res.end();
    return;
  }

  // ── 노션 강의 페이지 조회 (/api/notion-lecture)
  // 환경변수: NOTION_TOKEN (Internal integration secret), NOTION_LECTURE_PAGE_ID
  if (url === '/api/notion-lecture') {
    (async () => {
      const token = runtimeConfig.notionToken || process.env.NOTION_TOKEN || '';
      let pageId = (require('url').parse(req.url, true).query.pageId) || runtimeConfig.notionPageId || process.env.NOTION_LECTURE_PAGE_ID || '';
      if (!token) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        return res.end(JSON.stringify({ ok:false, error:'NOTION_TOKEN 미설정 (Railway env)' }));
      }
      if (!pageId) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        return res.end(JSON.stringify({ ok:false, error:'pageId 쿼리 또는 NOTION_LECTURE_PAGE_ID env 필요' }));
      }
      pageId = pageId.replace(/-/g, '');
      // 32자 ID → UUID 형식으로 변환
      const uuid = pageId.length===32 ? `${pageId.slice(0,8)}-${pageId.slice(8,12)}-${pageId.slice(12,16)}-${pageId.slice(16,20)}-${pageId.slice(20,32)}` : pageId;
      try {
        const fetchBlocks = async (parentId) => {
          const out = [];
          let cursor = null;
          do {
            const path = `/v1/blocks/${parentId}/children?page_size=100${cursor?`&start_cursor=${cursor}`:''}`;
            const result = await new Promise((resolve, reject) => {
              const opts = { hostname:'api.notion.com', port:443, path, method:'GET',
                headers:{ 'Authorization':`Bearer ${token}`, 'Notion-Version':'2022-06-28' } };
              const r = https.request(opts, resp => {
                let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} });
              });
              r.on('error', reject); r.end();
            });
            if (result.results) out.push(...result.results);
            cursor = result.next_cursor;
          } while (cursor);
          return out;
        };
        const blockToText = (b) => {
          if (!b) return '';
          const t = b.type;
          const rich = (b[t] && b[t].rich_text) || [];
          const text = rich.map(r => r.plain_text || '').join('');
          if (t === 'heading_1') return '\n# ' + text;
          if (t === 'heading_2') return '\n## ' + text;
          if (t === 'heading_3') return '\n### ' + text;
          if (t === 'bulleted_list_item') return '\n• ' + text;
          if (t === 'numbered_list_item') return '\n1. ' + text;
          if (t === 'to_do') return '\n[ ] ' + text;
          if (t === 'toggle') return '\n▸ ' + text;
          if (t === 'quote') return '\n> ' + text;
          if (t === 'callout') return '\n💡 ' + text;
          if (t === 'code') return '\n```\n' + text + '\n```';
          if (t === 'paragraph') return '\n' + text;
          return '';
        };
        const collectAll = async (parentId, depth=0) => {
          if (depth > 4) return ''; // 깊이 제한
          const blocks = await fetchBlocks(parentId);
          let out = '';
          for (const b of blocks) {
            out += blockToText(b);
            if (b.has_children) {
              out += await collectAll(b.id, depth+1);
            }
          }
          return out;
        };
        const content = await collectAll(uuid);
        const trimmed = content.trim();
        res.writeHead(200, { 'Content-Type':'application/json','Cache-Control':'public, max-age=600', ...CORS });
        res.end(JSON.stringify({ ok:true, pageId:uuid, length:trimmed.length, content:trimmed }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type':'application/json', ...CORS });
        res.end(JSON.stringify({ ok:false, error:e.message }));
      }
    })();
    return;
  }

  // 버전 확인 엔드포인트 — 클라이언트가 buildTs 비교용으로 폴링
  if(url==="/api/version"){
    res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-cache, no-store, must-revalidate",...CORS});
    let buildTs = 0;
    try{ buildTs = JSON.parse(require("fs").readFileSync(require("path").join(__dirname,"buildinfo.json"),"utf8")).buildTs || 0; }catch(e){}
    const _hp=require("path").join(__dirname,"trading-hts.html");
    const _hs=require("fs").statSync(_hp,{throwIfNoEntry:false});
    // buildinfo.json이 없으면 HTML 파일의 mtime을 buildTs 폴백으로 사용 (직접 편집해도 감지)
    if(!buildTs && _hs && _hs.mtimeMs) buildTs = String(Math.round(_hs.mtimeMs));
    res.end(JSON.stringify({version:"1.0.3", buildTs:String(buildTs), htmlSize:_hs?_hs.size:0, ts:Date.now()}));
    return;
  }
  // ── ai-agent 실시간 현황 (/api/agent/status) ──
  // 같은 머신의 ai-agent(C:\ai-team) journal/state 파일을 읽어 요약 반환.
  // 데이터 소스 경로는 AI_AGENT_DIR 환경변수로 변경 가능.
  if (url === '/api/agent/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-store, must-revalidate', ...CORS });
    res.end(JSON.stringify(buildAgentStatus()));
    return;
  }

  // ════════════════ ai-agent 통합 API (/api/agent/*) — X-Agent-Key 인증 ════════════════

  // [스크리닝] 거래대금 상위 후보 — GET /api/agent/screen/candidates?market=kospi&limit=30
  if (url === '/api/agent/screen/candidates' && req.method === 'GET') {
    if (!agentAuthOk(req)) return agentDeny(res);
    const market = ({ all: '0000', kospi: '0001', kosdaq: '1001' })[query.get('market') || 'kospi'] || '0001';
    const limit = parseInt(query.get('limit') || '30');
    const r = await callSelf('/api/kis/volume-rank', { method: 'POST', body: { ...kisKeys(), market, rankBy: 3, topN: limit } });
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({
      ok: r.ok !== false, market, count: (r.items || []).length,
      candidates: (r.items || []).map(it => ({
        code: it.code, name: it.name, price: it.price, changePct: it.changePct,
        volume: it.volume, turnover: it.turnover, volSurgePct: it.volSurgePct,
      })),
      error: r.error,
    }));
    return;
  }

  // [시장상황] 매크로 지수 스냅샷 — GET /api/agent/market/snapshot
  if (url === '/api/agent/market/snapshot' && req.method === 'GET') {
    if (!agentAuthOk(req)) return agentDeny(res);
    const data = await callSelf('/api/market-data?mode=realtime', { method: 'GET' });
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: data && data.ok !== false, data, updatedAt: new Date().toISOString() }));
    return;
  }

  // [신호분석] 종목 보조지표 — GET /api/agent/quote/:code/indicators?tf=1&date=YYYY-MM-DD
  if (url.startsWith('/api/agent/quote/') && url.endsWith('/indicators') && req.method === 'GET') {
    if (!agentAuthOk(req)) return agentDeny(res);
    const code = url.split('/')[4];
    const tf = query.get('tf') || '1';
    const date = query.get('date') || undefined;
    const r = await callSelf('/api/kis/chart', { method: 'POST', body: { ...kisKeys(), code, tf, date } });
    const candles = (r.candles || []).filter(c => !c.isPrev);
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({
      ok: r.ok !== false, code, tf, candleCount: candles.length,
      indicators: computeIndicators(candles), candles, error: r.error,
    }));
    return;
  }

  // [리스크] 주문 전 게이트 데이터 — GET /api/agent/risk/check?code=&price=&qty=&orderType=
  if (url === '/api/agent/risk/check' && req.method === 'GET') {
    if (!agentAuthOk(req)) return agentDeny(res);
    const code = query.get('code') || '';
    const price = query.get('price') || 0;
    const orderType = query.get('orderType') || 'limit';
    const account = query.get('account') || kisAccount();
    const [psbl, ob, bal] = await Promise.all([
      callSelf('/api/kis/inquire-psbl-order', { method: 'POST', body: { ...kisKeys(), account, code, price, orderType } }),
      code ? callSelf('/api/kis/orderbook', { method: 'POST', body: { ...kisKeys(), code } }) : Promise.resolve(null),
      callSelf('/api/kis/balance', { method: 'POST', body: { ...kisKeys(), account } }),
    ]);
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({
      ok: true, code,
      buyable: { orderCashable: psbl.orderCashable, maxBuyAmt: psbl.maxBuyAmt, maxBuyQty: psbl.maxBuyQty, reusableAmt: psbl.reusableAmt },
      orderbook: (ob && ob.ok !== false) ? ob : null,
      positionsCount: (bal.positions || []).filter(p => p.qty > 0).length,
      positions: bal.positions || [],
    }));
    return;
  }

  // [리스크] 보유/잔고 — GET /api/agent/positions
  if (url === '/api/agent/positions' && req.method === 'GET') {
    if (!agentAuthOk(req)) return agentDeny(res);
    const account = query.get('account') || kisAccount();
    const r = await callSelf('/api/kis/balance', { method: 'POST', body: { ...kisKeys(), account } });
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify(r));
    return;
  }

  // [주문실행] 현금/신용 주문 — POST /api/agent/order
  // body: { side:"buy|sell", code, qty, price, orderType?, credit?, crdtType?, loanDate?, account? }
  if (url === '/api/agent/order' && req.method === 'POST') {
    if (!agentAuthOk(req)) return agentDeny(res);
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      let o = {}; try { o = JSON.parse(body || '{}'); } catch (e) {}
      const account = o.account || kisAccount();
      const route = o.credit ? '/api/kis/order-credit' : '/api/kis/order';
      const r = await callSelf(route, { method: 'POST', body: {
        ...kisKeys(), account, side: o.side, code: o.code, qty: o.qty, price: o.price,
        orderType: o.orderType || 'limit', crdtType: o.crdtType, loanDate: o.loanDate,
      } });
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify(r));
    });
    return;
  }

  // [학습부] 저널 기록 — POST /api/agent/journal  (body = 임의 이벤트, 서버가 ts 스탬프)
  if (url === '/api/agent/journal' && req.method === 'POST') {
    if (!agentAuthOk(req)) return agentDeny(res);
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      let entry = {}; try { entry = JSON.parse(body || '{}'); } catch (e) {}
      const today = kstDateStr();
      const jdir = path.join(AGENT_DIR, 'data', 'journal');
      const jpath = path.join(jdir, `${today}.jsonl`);
      const rec = { ts: new Date().toISOString(), ...entry };
      try {
        fs.mkdirSync(jdir, { recursive: true });
        fs.appendFileSync(jpath, JSON.stringify(rec) + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true, date: today }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // [학습부] 오늘 저널 조회 — GET /api/agent/journal/today?limit=200
  if (url === '/api/agent/journal/today' && req.method === 'GET') {
    if (!agentAuthOk(req)) return agentDeny(res);
    const today = kstDateStr();
    const jpath = path.join(AGENT_DIR, 'data', 'journal', `${today}.jsonl`);
    const limit = parseInt(query.get('limit') || '200');
    const entries = [];
    try {
      const raw = fs.readFileSync(jpath, 'utf8');
      for (const line of raw.split('\n')) { if (!line.trim()) continue; try { entries.push(JSON.parse(line)); } catch (e) {} }
    } catch (e) { /* 오늘 기록 없음 */ }
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: true, date: today, count: entries.length, entries: entries.slice(-limit) }));
    return;
  }

  // [백테스트] 실행 — POST /api/agent/backtest/run  (body: { days?, start?, end? })
  if (url === '/api/agent/backtest/run' && req.method === 'POST') {
    if (!agentAuthOk(req)) return agentDeny(res);
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      let o = {}; try { o = JSON.parse(body || '{}'); } catch (e) {}
      const extra = {};
      if (o.days) extra.BACKTEST_DAYS = String(o.days);
      if (o.start) extra.BACKTEST_START = o.start;
      if (o.end) extra.BACKTEST_END = o.end;
      const r = startBacktest(extra);
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify(r));
    });
    return;
  }

  // ── 백테스트 실시간 현황 (/api/backtest/state) ──
  // ai-agent(run_backtest.py)가 state/backtest_live.json 을 250ms 간격으로 기록한다.
  // 그 파일을 그대로 서빙하되, 파일 신선도(mtime)로 running 여부를 보정한다.
  if (url === '/api/backtest/state') {
    const bp = btStateFile();
    fs.readFile(bp, 'utf8', (err, raw) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-store, must-revalidate', ...CORS });
      if (err) { res.end(JSON.stringify({ ok: false, running: false, paused: false, error: '백테스트 미실행' })); return; }
      let data;
      try { data = JSON.parse(raw); } catch (e) { res.end(JSON.stringify({ ok: false, running: false, paused: false, error: 'state 파싱 실패' })); return; }
      // 2초 이상 갱신이 없으면 엔진이 죽은 것으로 간주(일시정지 중에도 250ms마다 갱신됨).
      try {
        const ageMs = Date.now() - fs.statSync(bp).mtimeMs;
        if (ageMs > 2000) { data.running = false; data.paused = false; }
        data.staleMs = Math.round(ageMs);
      } catch (e) {}
      res.end(JSON.stringify(data));
    });
    return;
  }

  // ── 백테스트 토글(시작/일시정지/이어서) + 리셋 — 버튼 하나로 제어(요구 1) ──
  if (url === '/api/backtest/toggle' && req.method === 'POST') {
    const r = toggleBacktest();
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify(r));
    return;
  }
  if (url === '/api/backtest/reset' && req.method === 'POST') {
    stopBacktest();
    try { fs.unlinkSync(btStateFile()); } catch (e) {}        // 잔고 100만원으로 초기화(요구 3)
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: true, state: 'reset', msg: '리셋 완료' }));
    return;
  }
  // 하위호환 별칭(레거시 HTS 툴바 🚀/■ 버튼) — 내부적으로 시작/정지에 매핑.
  if (url === '/api/backtest/start' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      const r = startBacktest();
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify(r));
    });
    return;
  }
  if (url === '/api/backtest/stop' && req.method === 'POST') {
    const r = stopBacktest();
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify(r));
    return;
  }

  // ── 메타 진화 실행/결과 (HTS 🧬 진화+ 버튼) ──
  if (url === '/api/backtest/evolve' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let opt = {};
      try { opt = JSON.parse(body || '{}'); } catch (e) {}
      const r = startEvolve(opt);
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify(r));
    });
    return;
  }
  if (url === '/api/backtest/evolve-result') {
    const ep = path.join(AGENT_DIR, 'state', 'evolve_result.json');
    fs.readFile(ep, 'utf8', (err, raw) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-store, must-revalidate', ...CORS });
      if (err) { res.end(JSON.stringify({ ok: false, running: false, error: '진화 결과 없음 (아직 실행 안 함)' })); return; }
      let data;
      try { data = JSON.parse(raw); } catch (e) { res.end(JSON.stringify({ ok: false, running: false, error: 'evolve 결과 파싱 실패' })); return; }
      // 자식 프로세스가 살아있으면 running 보정.
      if (evProc && !evProc.killed) data.running = true;
      res.end(JSON.stringify(data));
    });
    return;
  }

  // ── 에이전트 상담 컨텍스트 (💬 상담 탭, 동일 출처 UI — 인증 불필요) ──
  // 모드 + 수정 가능한 전략 파라미터 현재값 + 오늘 저널 토픽 요약을 한 번에 돌려준다.
  if (url === '/api/agent/consult/context') {
    const out = { ok: true, mode: 'paper', tunable: {}, journal: null };
    // mode.yaml
    try {
      const mraw = fs.readFileSync(path.join(AGENT_DIR, 'config', 'mode.yaml'), 'utf8');
      const mm = mraw.match(/^current_mode:\s*([a-zA-Z]+)/m);
      if (mm) out.mode = mm[1].trim();
    } catch (e) {}
    // strategy_params.yaml — 화이트리스트 4개 키만 추출(간단 라인 파서, 외부 의존 없음)
    try {
      const sraw = fs.readFileSync(path.join(AGENT_DIR, 'config', 'strategy_params.yaml'), 'utf8');
      const pick = (section, key) => {
        // "section:" 블록 안에서 "  key: value" 찾기
        const re = new RegExp('^' + section + ':[\\s\\S]*?^\\s{2,}' + key + ':\\s*([0-9.+-]+)', 'm');
        const m = sraw.match(re);
        return m ? Number(m[1]) : null;
      };
      const t = {};
      const thr = sraw.match(/^screening:\s*[\s\S]*?^\s{2,}threshold:\s*([0-9.+-]+)/m);
      if (thr) t['screening.threshold'] = Number(thr[1]);
      const vsm = sraw.match(/^signal:\s*[\s\S]*?^\s{2,}volume_surge_multiplier:\s*([0-9.+-]+)/m);
      if (vsm) t['signal.volume_surge_multiplier'] = Number(vsm[1]);
      const em = sraw.match(/^time_stop:\s*[\s\S]*?^\s{2,}evaluation_minutes:\s*([0-9.+-]+)/m);
      if (em) t['time_stop.evaluation_minutes'] = Number(em[1]);
      const fb = sraw.match(/^time_stop:\s*[\s\S]*?^\s{2,}flat_box_pct:\s*([0-9.+-]+)/m);
      if (fb) t['time_stop.flat_box_pct'] = Number(fb[1]);
      out.tunable = t;
    } catch (e) {}
    // 오늘 저널 토픽 요약
    try {
      const today = kstDateStr();
      const jpath = path.join(AGENT_DIR, 'data', 'journal', `${today}.jsonl`);
      const raw = fs.readFileSync(jpath, 'utf8');
      const byTopic = {}; let total = 0;
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
        const tp = ev.topic || (ev.payload && ev.payload.topic) || '기타';
        byTopic[tp] = (byTopic[tp] || 0) + 1; total++;
      }
      if (total) out.journal = { total, byTopic };
    } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS });
    res.end(JSON.stringify(out));
    return;
  }

  // ── 상담 중 파라미터 직접 적용 + 검수 + 자동커밋 (💬 상담 ✅ 적용 버튼, paper 전용) ──
  // scripts/consult_apply.py <key> <value> → yaml 수정 → 재읽기 검증 → git 커밋 → JSON.
  if (url === '/api/agent/consult/apply-param' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let key = '', value = '';
      try { const o = JSON.parse(body || '{}'); key = String(o.key || '').trim(); value = String(o.value != null ? o.value : '').trim(); } catch (e) {}
      const reply = (obj) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS });
        res.end(JSON.stringify(obj));
      };
      if (!key || value === '') { reply({ ok: false, reason: '키 또는 값이 비었어요.' }); return; }
      const script = path.join(AGENT_DIR, 'scripts', 'consult_apply.py');
      let out = '', err = '', child;
      try {
        child = spawn(btPython(), [script, key, value], { cwd: AGENT_DIR, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
      } catch (e) { reply({ ok: false, reason: '적용기 실행 실패: ' + e.message }); return; }
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', e => reply({ ok: false, reason: '적용기 오류: ' + e.message }));
      child.on('close', () => {
        const line = out.trim().split('\n').filter(s => s.trim().startsWith('{')).pop();
        let data = null; if (line) { try { data = JSON.parse(line); } catch (e) {} }
        if (!data) { reply({ ok: false, reason: '적용 결과 파싱 실패: ' + (err.trim().slice(-200) || out.trim().slice(-200) || '출력 없음') }); return; }
        reply(data);
      });
    });
    return;
  }

  // ── 전체 팀 회의 기록 조회 (💬 상담 → 다음 상담 시작 시 지난 회의 참고, 인증 불필요) ──
  // data/memory/team_meeting_log.json 의 최근 N건을 그대로 돌려준다.
  if (url.split('?')[0] === '/api/agent/consult/meeting/log' && req.method === 'GET') {
    const reply = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS });
      res.end(JSON.stringify(obj));
    };
    let limit = 5;
    try { const m = url.match(/[?&]limit=(\d+)/); if (m) limit = Math.max(1, Math.min(50, +m[1])); } catch (e) {}
    let log = [];
    try {
      const raw = fs.readFileSync(path.join(AGENT_DIR, 'data', 'memory', 'team_meeting_log.json'), 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) log = arr;
    } catch (e) {}
    reply({ ok: true, total: log.length, meetings: log.slice(-limit) });
    return;
  }

  // ── 전체 팀 회의 결과 저장 + 자동커밋 (💬 상담 회의 종료 시, 요구 2) ──
  // scripts/save_meeting.py 가 team_meeting_log.json append + git commit → 결과 JSON.
  if (url === '/api/agent/consult/meeting/save' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const reply = (obj) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS });
        res.end(JSON.stringify(obj));
      };
      const rec = (body || '').trim();
      if (!rec) { reply({ ok: false, reason: '회의 레코드가 비었어요.' }); return; }
      const script = path.join(AGENT_DIR, 'scripts', 'save_meeting.py');
      let out = '', err = '', child;
      try {
        child = spawn(btPython(), [script], { cwd: AGENT_DIR, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
      } catch (e) { reply({ ok: false, reason: '저장기 실행 실패: ' + e.message }); return; }
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', e => reply({ ok: false, reason: '저장기 오류: ' + e.message }));
      child.on('close', () => {
        const line = out.trim().split('\n').filter(s => s.trim().startsWith('{')).pop();
        let data = null; if (line) { try { data = JSON.parse(line); } catch (e) {} }
        if (!data) { reply({ ok: false, reason: '저장 결과 파싱 실패: ' + (err.trim().slice(-200) || out.trim().slice(-200) || '출력 없음') }); return; }
        reply(data);
      });
      // 레코드를 stdin 으로 전달(긴 한글 JSON 도 인자 길이 제한 없이 안전).
      try { child.stdin.write(rec); child.stdin.end(); } catch (e) {}
    });
    return;
  }

  // ── 단일 제안 적용 + 검수 + 자동커밋 (제안 카드 ✅ 적용 버튼, §2.7/§3.3) ──
  // scripts/apply_proposal.py가 strategy_params.yaml 수정 → 재읽기 검증 → git 커밋하고
  // 결과 JSON을 stdout으로 돌려준다. paper 모드에서만 적용(아니면 locked).
  if (url === '/api/backtest/apply-proposal' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let pid = '';
      try { pid = String((JSON.parse(body || '{}').id) || '').trim(); } catch (e) {}
      const reply = (obj) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS });
        res.end(JSON.stringify(obj));
      };
      if (!pid) { reply({ ok: false, reason: 'proposal id가 없어요.' }); return; }
      const script = path.join(AGENT_DIR, 'scripts', 'apply_proposal.py');
      let out = '', err = '';
      let child;
      try {
        child = spawn(btPython(), [script, pid], { cwd: AGENT_DIR, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
      } catch (e) { reply({ ok: false, reason: '적용기 실행 실패: ' + e.message }); return; }
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', e => reply({ ok: false, reason: '적용기 오류: ' + e.message }));
      child.on('close', () => {
        let data = null;
        // stdout 마지막 JSON 라인만 취한다(로그 라인 섞임 방지).
        const line = out.trim().split('\n').filter(s => s.trim().startsWith('{')).pop();
        if (line) { try { data = JSON.parse(line); } catch (e) {} }
        if (!data) { reply({ ok: false, reason: '적용 결과 파싱 실패: ' + (err.trim().slice(-200) || out.trim().slice(-200) || '출력 없음') }); return; }
        reply(data);
      });
    });
    return;
  }

  // ── 노션 학습 현황 (💬 상담 탭 "노션 학습 현황") — GET ──
  // 학습부가 저장한 data/memory/notion_knowledge.json + notion_updates.log 를 그대로 요약 서빙.
  if ((url === '/api/agent/notion/status' || url === '/api/agent/notion-status') && req.method === 'GET') {
    const reply = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS });
      res.end(JSON.stringify(obj));
    };
    let data = null, updates = [];
    try { data = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'data', 'memory', 'notion_knowledge.json'), 'utf8')); } catch (e) {}
    try { updates = fs.readFileSync(path.join(AGENT_DIR, 'data', 'memory', 'notion_updates.log'), 'utf8').trim().split('\n').filter(Boolean).slice(-20); } catch (e) {}
    if (!data) { reply({ ok: true, synced: false, message: '아직 노션을 동기화하지 않았어요. 🔄 지금 업데이트를 눌러주세요.', agents: {}, updates }); return; }
    const cats = data.categories || {};
    const agents = {};
    for (const [k, c] of Object.entries(cats)) {
      agents[k] = {
        label: c.label || '', agent: c.agent || '', count: c.count || 0,
        headings: (c.headings || []).slice(0, 6),
        sample_rules: (c.rules || []).slice(0, 5).map(r => r.text || ''),
      };
    }
    reply({
      ok: true, synced: true, title: data.title || '', page_id: data.source_page_id || '',
      last_update: data.fetched_at || '', last_checked: data.last_checked || data.fetched_at || '',
      total_rules: (data.stats || {}).total_rules || 0, agents, updates,
    });
    return;
  }

  // ── 노션 수동 동기화 (💬 상담 탭 "🔄 지금 업데이트" 버튼) — POST ──
  // scripts/sync_notion.py --force --json 을 실행해 페이지를 다시 읽고 분류·저장한다.
  // 토큰은 ai-agent config/kis_api.yaml(notion.token) 우선, 없으면 traidair runtimeConfig 폴백.
  if (url === '/api/agent/notion/sync' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let force = true;
      try { if (JSON.parse(body || '{}').force === false) force = false; } catch (e) {}
      const reply = (obj) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS });
        res.end(JSON.stringify(obj));
      };
      const script = path.join(AGENT_DIR, 'scripts', 'sync_notion.py');
      const args = [script, '--json'];
      if (force) args.push('--force');
      const env = {
        ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
        // ai-agent kis_api.yaml 의 notion.token 이 placeholder 면 이 env 로 폴백한다.
        NOTION_TOKEN: runtimeConfig.notionToken || process.env.NOTION_TOKEN || '',
        NOTION_PAGE_ID: runtimeConfig.notionPageId || process.env.NOTION_PAGE_ID || '',
      };
      let out = '', err = '', child;
      try {
        child = spawn(btPython(), args, { cwd: AGENT_DIR, env, windowsHide: true });
      } catch (e) { reply({ ok: false, reason: '동기화 실행 실패: ' + e.message }); return; }
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', e => reply({ ok: false, reason: '동기화 오류: ' + e.message }));
      child.on('close', () => {
        const line = out.trim().split('\n').filter(s => s.trim().startsWith('{')).pop();
        let data = null; if (line) { try { data = JSON.parse(line); } catch (e) {} }
        if (!data) { reply({ ok: false, reason: '동기화 결과 파싱 실패: ' + (err.trim().slice(-200) || out.trim().slice(-200) || '출력 없음') }); return; }
        reply(data);
      });
    });
    return;
  }

  // ── HTS 화면 (/hts) — start.bat 자동 오픈 대상 ──
  if (url === '/hts' || url === '/hts/') {
    fs.readFile(path.join(__dirname, 'trading-hts.html'), (err, data) => {
      if (err) { res.writeHead(404, CORS); res.end('trading-hts.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate', ...CORS });
      res.end(data);
    });
    return;
  }

  // ── ai-agent 대시보드 페이지 (/agent) ──
  if (url === '/agent' || url === '/agent/') {
    fs.readFile(path.join(__dirname, 'agent-dashboard.html'), (err, data) => {
      if (err) { res.writeHead(404, CORS); res.end('agent-dashboard.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate', ...CORS });
      res.end(data);
    });
    return;
  }

  // ── API 경로 가드: 매칭되지 않은 /api/* 요청은 절대 HTML(trading-hts.html)로
  //     폴백하지 않고 항상 JSON 404 를 반환한다. (클라이언트 "Unexpected token '<'" 방지)
  if (url.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS });
    res.end(JSON.stringify({ ok: false, error: 'not_found', route: url }));
    return;
  }

  // 정적 파일
  let filePath = req.url === '/' ? '/trading-hts.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(__dirname, 'trading-hts.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control':'no-cache, no-store, must-revalidate', 'Pragma':'no-cache', 'Expires':'0' });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(filePath);
    const mimeType = MIME[ext] || 'text/plain; charset=utf-8';
    const cacheHeader = ext === '.html' ? {'Cache-Control':'no-cache, no-store, must-revalidate','Pragma':'no-cache','Expires':'0'} : {};
    res.writeHead(200, { 'Content-Type': mimeType, ...CORS, ...cacheHeader });
    res.end(data);
  });
});

// ── WebSocket /ws/market — 시장상황 에이전트 실시간 구독 (X-Agent-Key 또는 ?key=) ──
server.on('upgrade', (req, socket) => {
  const u = req.url.split('?')[0];
  if (u !== '/ws/market') { socket.destroy(); return; }
  const q = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');
  const key = req.headers['x-agent-key'] || q.get('key');
  if (AGENT_KEY && key !== AGENT_KEY) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  const wsKey = req.headers['sec-websocket-key'];
  if (!wsKey) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  wsClients.add(socket);
  socket.on('data', buf => { if (buf.length && (buf[0] & 0x0f) === 0x8) { try { socket.end(); } catch (e) {} } });
  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => wsClients.delete(socket));
  // 접속 즉시 1회 스냅샷 푸시
  wsMarketSnapshot().then(data => { try { socket.write(wsFrame(JSON.stringify({ type: 'market', ts: new Date().toISOString(), data }))); } catch (e) {} });
  wsBroadcastStart();
});

server.listen(PORT, () => {
  console.log(`TraidAIr running on port ${PORT}`);
  console.log(`Claude API: ${runtimeConfig.claudeKey ? '✅' : '❌ 없음 — Railway Variables에 ANTHROPIC_API_KEY 설정'}`);
  console.log(`KIS API: ${runtimeConfig.kisAppKey ? '✅' : '❌ 없음'}`);
  console.log(`DART API: ${runtimeConfig.dartKey ? '✅' : '❌ 없음'}`);
});

// ── GitHub 기반 영구 설정 저장/로드 ──
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = '123idon/traidair';
const CONFIG_FILE = 'user.config.json';

async function loadConfigFromGitHub() {
  if (!GITHUB_TOKEN) return;
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/${CONFIG_FILE}`,
      method: 'GET',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'traidair-server',
        'Accept': 'application/vnd.github.v3+json',
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const file = JSON.parse(d);
            const content = Buffer.from(file.content, 'base64').toString('utf-8');
            const cfg = JSON.parse(content);
            if (cfg.kisAppKey)    runtimeConfig.kisAppKey = cfg.kisAppKey;
            if (cfg.kisAppSecret) runtimeConfig.kisAppSecret = cfg.kisAppSecret;
            if (cfg.kisAccount)   runtimeConfig.kisAccount = cfg.kisAccount;
            if (cfg.kisMode)      runtimeConfig.kisMode = cfg.kisMode;
            if (cfg.dartKey)      runtimeConfig.dartKey = cfg.dartKey;
            if (cfg.claudeKey)    runtimeConfig.claudeKey = cfg.claudeKey;
            console.log('✅ GitHub에서 설정 로드됨:', {
              kis: cfg.kisAppKey ? '✅' : '❌',
              account: cfg.kisAccount || '없음',
              claude: cfg.claudeKey ? '✅' : '❌',
            });
          }
        } catch(e) { console.log('GitHub 설정 파싱 실패:', e.message); }
        resolve();
      });
    });
    req.on('error', () => resolve());
    req.setTimeout(5000, () => { req.destroy(); resolve(); });
    req.end();
  });
}

let _githubFileSha = null;
async function saveConfigToGitHub(cfg) {
  if (!GITHUB_TOKEN) return false;
  const content = Buffer.from(JSON.stringify({...runtimeConfig, ...cfg, savedAt: new Date().toISOString()}, null, 2)).toString('base64');
  
  // 현재 SHA 가져오기 (업데이트에 필요)
  if (!_githubFileSha) {
    await new Promise(resolve => {
      const req = https.request({
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_REPO}/contents/${CONFIG_FILE}`,
        method: 'GET',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'traidair-server', 'Accept': 'application/vnd.github.v3+json' },
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { if (res.statusCode === 200) _githubFileSha = JSON.parse(d).sha; } catch(e) {}
          resolve();
        });
      });
      req.on('error', () => resolve());
      req.end();
    });
  }

  const body = JSON.stringify({
    message: 'Update user config',
    content,
    ...(_githubFileSha ? { sha: _githubFileSha } : {}),
  });

  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/${CONFIG_FILE}`,
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'traidair-server',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const result = JSON.parse(d);
          if (result.content?.sha) { _githubFileSha = result.content.sha; }
          console.log('✅ GitHub 설정 저장됨 (영구)');
          resolve(true);
        } catch(e) { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.write(body); req.end();
  });
}

// 서버 시작 시 GitHub에서 설정 로드
loadConfigFromGitHub().then(() => {
  console.log('설정 최종 상태:', {
    claude: runtimeConfig.claudeKey ? '✅' : '❌',
    kis: runtimeConfig.kisAppKey ? '✅' : '❌',
    account: runtimeConfig.kisAccount || '없음',
  });
});

// ── 사용자 데이터 영구 저장 (모의투자 계좌, 매매일지, 통계 등) ──
const USER_DATA_PATH = '/tmp/traidair_userdata.json';

function loadUserData() {
  try {
    if (fs.existsSync(USER_DATA_PATH)) {
      return JSON.parse(fs.readFileSync(USER_DATA_PATH, 'utf8'));
    }
  } catch(e) {}
  return {};
}

function saveUserData(data) {
  try {
    const current = loadUserData();
    const merged = { ...current, ...data, _savedAt: new Date().toISOString() };
    fs.writeFileSync(USER_DATA_PATH, JSON.stringify(merged), 'utf8');
    // GitHub에도 백업
    saveUserDataToGitHub(merged).catch(() => {});
    return true;
  } catch(e) {
    console.error('userdata 저장 실패:', e.message);
    return false;
  }
}

// GitHub 백업
async function saveUserDataToGitHub(data) {
  if (!GITHUB_TOKEN) return;
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const body = JSON.stringify({
    message: 'Update user data',
    content,
    ...(_userDataSha ? { sha: _userDataSha } : {}),
  });
  let _userDataSha_new = null;
  await new Promise(resolve => {
    // 먼저 현재 SHA 확인
    const getReq = https.request({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/userdata.json`,
      method: 'GET',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'traidair-server', 'Accept': 'application/vnd.github.v3+json' },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { _userDataSha = JSON.parse(d).sha || null; } catch(e) {}
        resolve();
      });
    });
    getReq.on('error', () => resolve());
    getReq.end();
  });

  const bodyWithSha = JSON.stringify({
    message: 'Update user data',
    content,
    ...(_userDataSha ? { sha: _userDataSha } : {}),
  });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/userdata.json`,
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'traidair-server',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyWithSha),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { _userDataSha = JSON.parse(d).content?.sha || _userDataSha; } catch(e) {}
        resolve();
      });
    });
    req.on('error', () => resolve());
    req.write(bodyWithSha); req.end();
  });
}
let _userDataSha = null;

// GitHub에서 userdata 로드
async function loadUserDataFromGitHub() {
  if (!GITHUB_TOKEN) return null;
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/userdata.json`,
      method: 'GET',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'traidair-server', 'Accept': 'application/vnd.github.v3+json' },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const file = JSON.parse(d);
          _userDataSha = file.sha;
          const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
          // /tmp에도 저장
          fs.writeFileSync(USER_DATA_PATH, JSON.stringify(data, null, 2));
          console.log('✅ GitHub userdata 로드됨');
          resolve(data);
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// 서버 시작 시 GitHub에서 userdata 로드
loadUserDataFromGitHub().catch(() => {});
// v1779288584
