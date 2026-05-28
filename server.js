const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

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

// ── KIS 토큰 캐시
const kisTokenCache = {};

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

  if (!result.data.access_token) {
    console.error('[KIS 토큰 실패]', 'mode:', mode, 'host:', kisHost(mode), 'port:', kisPort(mode), 'status:', result.status, 'response:', JSON.stringify(result.data).slice(0, 300));
  }
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
