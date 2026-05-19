const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ── 환경변수 기반 설정 (Railway Variables에서 영구 유지)
// cfg.json에서 키 로드 (git 제외, Railway에 영구 보존)
let _localCfg = {};
try { _localCfg = JSON.parse(require('fs').readFileSync('./cfg.json','utf8')); } catch(e) {}

let runtimeConfig = {
  claudeKey:    process.env.ANTHROPIC_API_KEY || _localCfg.ck || '',
  kisAppKey:    process.env.KIS_APP_KEY       || _localCfg.ak || '',
  kisAppSecret: process.env.KIS_APP_SECRET    || _localCfg.as || '',
  kisAccount:   process.env.KIS_ACCOUNT       || _localCfg.ac || '',
  kisMode:      process.env.KIS_MODE          || _localCfg.md || 'real',
  dartKey:      process.env.DART_API_KEY      || _localCfg.dk || '',
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
});

// ── KIS 토큰 캐시
const kisTokenCache = {};

function kisHost(mode) {
  return mode === 'real'
    ? 'openapi.koreainvestment.com'
    : 'openapivts.koreainvestment.com';
}

function kisPort(mode) {
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
  const cached = kisTokenCache[cacheKey];
  if (cached && cached.expires > Date.now()) return cached.token;

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
    kisTokenCache[cacheKey] = { token, expires: Date.now() + 29 * 60 * 1000 };
  }
  return token || null;
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

  // ── KIS 토큰 (/api/kis/token)
  if (url === '/api/kis/token' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { appKey, appSecret, mode } = JSON.parse(body);
        if (!appKey || !appSecret) throw new Error('appKey/appSecret 필요');
        const token = await getKisToken(appKey, appSecret, mode || 'mock');
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
        // KIS 분봉 조회 API (FHKST03010200: 국내주식 분봉조회)
        const queryDate = (date || new Date().toISOString().slice(0,10)).replace(/-/g,'');
        const result = await kisRequest({
          hostname: kisHost('real'), // 분봉은 항상 실전서버 (모의서버 미지원)
          path: `/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice?fid_etc_cls_code=&fid_cond_mrkt_div_code=J&fid_input_iscd=${code}&fid_input_hour_1=${interval}&fid_pw_data_inqu_yn=N`,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': appKey, 'appsecret': appSecret,
            'tr_id': 'FHKST03010200',
            'custtype': 'P',
          },
        });

        const output2 = result.data.output2 || [];
        // output2: [{stck_bsop_date, stck_cntg_hour, stck_prpr, stck_oprc, stck_hgpr, stck_lwpr, cntg_vol}]
        const candles = output2
          .filter(r => !date || r.stck_bsop_date === queryDate)
          .map(r => ({
            t: `${r.stck_cntg_hour.slice(0,2)}:${r.stck_cntg_hour.slice(2,4)}`,
            o: parseInt(r.stck_oprc || r.stck_prpr),
            h: parseInt(r.stck_hgpr || r.stck_prpr),
            l: parseInt(r.stck_lwpr || r.stck_prpr),
            c: parseInt(r.stck_prpr),
            v: parseInt(r.cntg_vol || 0),
          }))
          .filter(c => c.c > 0)
          .sort((a, b) => a.t.localeCompare(b.t)); // 시간순 정렬

        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true, code, date, tf: interval, candles }));
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
          })),
        }));
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

    if (mode === 'sim' && simDate && simTime) {
      // 모의투자 모드: 해당 날짜의 데이터 가져오되
      // simTime 이후 데이터는 미래로 처리하여 제거
      const [yr, mo, dy] = simDate.split('-').map(Number);
      const [hh, mm] = simTime.split(':').map(Number);
      // 전날 16시부터 해당일 종료까지 (미국 야간 포함)
      period1 = Math.floor(new Date(Date.UTC(yr, mo-1, dy-1, 7, 0, 0)).getTime() / 1000); // 전날 16:00 KST
      period2 = Math.floor(new Date(Date.UTC(yr, mo-1, dy, 15, 0, 0)).getTime() / 1000);  // 당일 24:00 KST
      // 미래 차단: simTime 이후 데이터 제거
      cutoffTs = Math.floor(new Date(Date.UTC(yr, mo-1, dy, hh-9, mm, 0)).getTime() / 1000) + tf * 60; // simTime + 1봉
    } else {
      // 실시간 모드: 오늘 데이터
      const now = Math.floor(Date.now() / 1000);
      period1 = now - 2 * 24 * 3600; // 2일 전
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

      const interval = tf <= 5 ? '5m' : tf <= 60 ? '60m' : '1d';
      const fetchAll = Object.entries(SYMBOLS).map(([key, sym]) =>
        fetchYahoo(sym, period1, period2, interval)
          .then(r => ({ key, ...r }))
          .catch(e => ({ key, symbol: sym, error: e.message, bars: [], price: null }))
      );
      const raw = await Promise.all(fetchAll);

      // 결과 정리: cutoffTs 이후 데이터 완전 제거 (미래 차단)
      const result = {};
      for (const item of raw) {
        const filteredBars = item.bars.filter(b => b.ts < cutoffTs);
        const lastBar = filteredBars[filteredBars.length - 1];
        const prevBar = filteredBars[filteredBars.length - 2];

        // 현재 시각 기준 최신값
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
          // 모의투자에서 차트 표시용 전체 봉 데이터 (cutoff 이전만)
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
