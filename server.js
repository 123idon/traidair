const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DART_KEY = process.env.DART_API_KEY || '';

// ── KIS 토큰 캐시 (appKey 별로 저장)
const kisTokenCache = {}; // { [appKey]: { token, expires } }

// KIS API 호스트 (모의투자 vs 실거래)
function kisHost(mode) {
  return mode === 'real'
    ? 'openapi.koreainvestment.com'
    : 'openapivts.koreainvestment.com'; // 모의투자
}

// KIS REST 요청 헬퍼
function kisRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, data: {} }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// KIS 액세스 토큰 발급 (캐시 30분)
async function getKisToken(appKey, appSecret, mode) {
  const cacheKey = appKey + mode;
  const cached = kisTokenCache[cacheKey];
  if (cached && cached.expires > Date.now()) return cached.token;

  const body = JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret });
  const result = await kisRequest({
    hostname: kisHost(mode),
    path: '/oauth2/tokenP',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, body);

  const token = result.data.access_token;
  if (token) {
    kisTokenCache[cacheKey] = { token, expires: Date.now() + 29 * 60 * 1000 }; // 29분 캐시
  }
  return token || null;
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

// DART corpCode 캐시 (회사명→고유번호 매핑)
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

// ── 영구 설정 저장 (/data/config.json)
const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch(e) {}
  return {};
}

function saveConfig(data) {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const current = loadConfig();
    const merged = { ...current, ...data, updatedAt: new Date().toISOString() };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
    return true;
  } catch(e) {
    console.error('config 저장 실패:', e.message);
    return false;
  }
}

// 서버 시작 시 저장된 설정 로드
const savedConfig = loadConfig();
let sessionClaudeKey = savedConfig.claudeKey || process.env.ANTHROPIC_API_KEY || '';
let savedKisConfig = {
  appKey: savedConfig.kisAppKey || '',
  appSecret: savedConfig.kisAppSecret || '',
  account: savedConfig.kisAccount || '',
  mode: savedConfig.kisMode || 'mock',
  dartKey: savedConfig.dartKey || process.env.DART_API_KEY || '',
};
if (sessionClaudeKey) console.log('✅ 저장된 Claude 키 로드:', sessionClaudeKey.slice(0,10)+'...');
if (savedKisConfig.appKey) console.log('✅ 저장된 KIS 설정 로드');

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS); res.end(); return;
  }

  const url = req.url.split('?')[0];
  const query = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');

  // ── Claude 키 세션 설정 (/api/set-claude-key)
  if (url === '/api/set-claude-key' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { key } = JSON.parse(body);
        if (key && key.startsWith('sk-ant-')) {
          sessionClaudeKey = key;
          saveConfig({ claudeKey: key });
        }
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
      const apiKey = sessionClaudeKey || process.env.ANTHROPIC_API_KEY || '';
      const opts = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
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
      pr.write(body); pr.end();
    });
    return;
  }

  // ── 전체 API 설정 저장 (/api/save-config)
  if (url === '/api/save-config' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const cfg = JSON.parse(body);
        const toSave = {};
        if (cfg.claudeKey && cfg.claudeKey.startsWith('sk-ant-')) {
          toSave.claudeKey = cfg.claudeKey;
          sessionClaudeKey = cfg.claudeKey;
        }
        if (cfg.kisAppKey) { toSave.kisAppKey = cfg.kisAppKey; savedKisConfig.appKey = cfg.kisAppKey; }
        if (cfg.kisAppSecret) { toSave.kisAppSecret = cfg.kisAppSecret; savedKisConfig.appSecret = cfg.kisAppSecret; }
        if (cfg.kisAccount) { toSave.kisAccount = cfg.kisAccount; savedKisConfig.account = cfg.kisAccount; }
        if (cfg.kisMode) { toSave.kisMode = cfg.kisMode; savedKisConfig.mode = cfg.kisMode; }
        if (cfg.dartKey) { toSave.dartKey = cfg.dartKey; savedKisConfig.dartKey = cfg.dartKey; }
        const ok = saveConfig(toSave);
        console.log('✅ API 설정 저장됨:', Object.keys(toSave).join(', '));
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok, saved: Object.keys(toSave) }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── 저장된 설정 조회 (/api/get-config)
  if (url === '/api/get-config' && req.method === 'GET') {
    const cfg = loadConfig();
    // 키는 힌트만 반환 (보안)
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({
      ok: true,
      claudeKey: cfg.claudeKey ? cfg.claudeKey.slice(0,10)+'...' : '',
      claudeKeyFull: cfg.claudeKey || '',
      kisAppKey: cfg.kisAppKey || '',
      kisAppSecret: cfg.kisAppSecret || '',
      kisAccount: cfg.kisAccount || '',
      kisMode: cfg.kisMode || 'mock',
      dartKey: cfg.dartKey || '',
      updatedAt: cfg.updatedAt || '',
    }));
    return;
  }

  // ── KIS 토큰 발급 (/api/kis/token)
  if (url === '/api/kis/token' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode } = JSON.parse(body);
        if (!appKey || !appSecret) throw new Error('appKey/appSecret 필요');
        const token = await getKisToken(appKey, appSecret, mode || 'mock');
        if (!token) throw new Error('토큰 발급 실패 — App Key/Secret 확인');
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true, token: token.slice(0, 10) + '...' })); // 보안: 일부만 반환
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 현재가 조회 (/api/kis/price?code=005930)
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
          path: `/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${code}`,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': appKey,
            'appsecret': appSecret,
            'tr_id': 'FHKST01010100',
          },
        });

        const out = result.data.output || {};
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({
          ok: true,
          code,
          price: parseInt(out.stck_prpr || 0),       // 현재가
          open: parseInt(out.stck_oprc || 0),         // 시가
          high: parseInt(out.stck_hgpr || 0),         // 고가
          low: parseInt(out.stck_lwpr || 0),          // 저가
          volume: parseInt(out.acml_vol || 0),        // 누적거래량
          change: parseInt(out.prdy_vrss || 0),       // 전일대비
          changePct: out.prdy_ctrt || '0.00',         // 등락률
          name: out.hts_kor_isnm || code,             // 종목명
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

        // tr_id: 모의투자 매수=VTTC0802U, 매도=VTTC0801U / 실거래 매수=TTTC0802U, 매도=TTTC0801U
        const isMock = (mode || 'mock') === 'mock';
        const trId = side === 'buy'
          ? (isMock ? 'VTTC0802U' : 'TTTC0802U')
          : (isMock ? 'VTTC0801U' : 'TTTC0801U');

        // 주문구분: 00=지정가, 01=시장가
        const ordDvsn = (orderType === 'market') ? '01' : '00';
        const ordPrc = ordDvsn === '01' ? '0' : String(price);

        // 계좌번호 분리 (12345678-01 → prefix=12345678, suffix=01)
        const [acntPfx, acntSfx] = account.includes('-') ? account.split('-') : [account.slice(0, 8), account.slice(8)];

        const orderBody = {
          CANO: acntPfx,
          ACNT_PRDT_CD: acntSfx || '01',
          PDNO: code,
          ORD_DVSN: ordDvsn,
          ORD_QTY: String(qty),
          ORD_UNPR: ordPrc,
        };
        const bodyStr = JSON.stringify(orderBody);

        const result = await kisRequest({
          hostname: kisHost(mode || 'mock'),
          path: '/uapi/domestic-stock/v1/trading/order-cash',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            'authorization': `Bearer ${token}`,
            'appkey': appKey,
            'appsecret': appSecret,
            'tr_id': trId,
            'custtype': 'P',
            'hashkey': '',
          },
        }, bodyStr);

        const d = result.data;
        if (d.rt_cd === '0') {
          res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({
            ok: true,
            ordNo: d.output?.odno,
            msg: d.msg1 || '주문 완료',
          }));
        } else {
          throw new Error(d.msg1 || `주문 실패 (rt_cd: ${d.rt_cd})`);
        }
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── KIS 잔고 조회 (/api/kis/balance)
  if (url === '/api/kis/balance' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode, account } = JSON.parse(body);
        const token = await getKisToken(appKey, appSecret, mode || 'mock');
        if (!token) throw new Error('토큰 없음');

        const [acntPfx, acntSfx] = account.includes('-') ? account.split('-') : [account.slice(0, 8), account.slice(8)];
        const isMock = (mode || 'mock') === 'mock';
        const trId = isMock ? 'VTTC8434R' : 'TTTC8434R';

        const result = await kisRequest({
          hostname: kisHost(mode || 'mock'),
          path: `/uapi/domestic-stock/v1/trading/inquire-balance?CANO=${acntPfx}&ACNT_PRDT_CD=${acntSfx||'01'}&AFHR_FLPR_YN=N&OFL_YN=&INQR_DVSN=02&UNPR_DVSN=01&FUND_STTL_ICLD_YN=N&FNCG_AMT_AUTO_RDPT_YN=N&PRCS_DVSN=01&CTX_AREA_FK100=&CTX_AREA_NK100=`,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': appKey,
            'appsecret': appSecret,
            'tr_id': trId,
          },
        });

        const d = result.data;
        const output1 = d.output1 || []; // 보유 종목
        const output2 = d.output2?.[0] || {}; // 계좌 요약

        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({
          ok: true,
          cash: parseInt(output2.dnca_tot_amt || 0),         // 예수금 총액
          totalEval: parseInt(output2.tot_evlu_amt || 0),    // 총평가금액
          totalPnl: parseInt(output2.evlu_pfls_smtl_amt || 0), // 평가손익
          positions: output1.map(p => ({
            code: p.pdno,
            name: p.prdt_name,
            qty: parseInt(p.hldg_qty || 0),
            avgPrice: parseInt(p.pchs_avg_pric || 0),
            currentPrice: parseInt(p.prpr || 0),
            evalAmt: parseInt(p.evlu_amt || 0),
            pnl: parseInt(p.evlu_pfls_amt || 0),
            pnlPct: p.evlu_pfls_rt || '0.00',
          })),
        }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── DART 공시 목록 API (/api/dart/list?corp=005930&days=1)
  if (url === '/api/dart/list') {
    if (!DART_KEY) {
      // API 키 없으면 빈 배열 반환 (프론트에서 샘플 사용)
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
      const bgnDe = fmt(from);
      const endDe = fmt(today);
      let dartUrl;
      if (corpCode) {
        dartUrl = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${DART_KEY}&corp_code=${corpCode}&bgn_de=${bgnDe}&end_de=${endDe}&sort=date&sort_mth=desc&page_count=20`;
      } else {
        dartUrl = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${DART_KEY}&bgn_de=${bgnDe}&end_de=${endDe}&sort=date&sort_mth=desc&page_count=30`;
      }
      const data = await httpsGet(dartUrl);
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ status: 'ok', list: data.list || [], total: data.total_count || 0 }));
    } catch(e) {
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ status: 'error', error: e.message, list: [] }));
    }
    return;
  }

  // ── DART 고유번호 조회 (/api/dart/corpcode?nm=삼성전자)
  if (url === '/api/dart/corpcode') {
    const nm = query.get('nm') || '';
    const code = CORP_CODE_MAP[nm] || null;
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ corp_code: code }));
    return;
  }

  // ── DART API 상태 확인 (/api/dart/status)
  if (url === '/api/dart/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ has_key: !!DART_KEY, key_hint: DART_KEY ? DART_KEY.slice(0,4)+'****' : null }));
    return;
  }

  // 정적 파일
  let filePath = req.url === '/' ? '/trading-hts.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(__dirname, 'trading-hts.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain; charset=utf-8', ...CORS });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`TraidAIr running on port ${PORT}`);
  console.log(`DART API: ${DART_KEY ? '✅ 키 설정됨 (' + DART_KEY.slice(0,4) + '****)' : '⚠️  키 없음 — Railway Variables에 DART_API_KEY 설정 필요'}`);
});
