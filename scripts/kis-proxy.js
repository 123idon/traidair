/**
 * KIS API 프록시 서버 (네이버 클라우드 한국 서버에서 실행)
 * Railway US → 이 서버 → KIS API (한국)
 *
 * 설치: sudo apt install -y nodejs npm && npm install express && node kis-proxy.js
 */
const http = require('http');
const https = require('https');

const PORT = 3100;
const ALLOWED_ORIGINS = ['*']; // Railway IP로 제한 가능

function kisHost(mode) {
  return mode === 'real'
    ? 'openapi.koreainvestment.com'
    : 'openapivts.koreainvestment.com';
}

function forwardToKis(targetHost, kisPath, method, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyBuf = body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    delete reqHeaders['host'];
    delete reqHeaders['content-length'];
    if (bodyBuf) reqHeaders['content-length'] = bodyBuf.length;

    const opts = {
      hostname: targetHost,
      port: 443,
      path: kisPath,
      method: method || 'GET',
      headers: reqHeaders,
    };

    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, body: raw });
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('KIS 응답 없음 (15초)')));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, appkey, appsecret, tr_id, custtype');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 상태 확인
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, time: new Date().toISOString(), server: 'KIS-Proxy-KR' }));
    return;
  }

  // /real/... → real KIS API
  // /mock/... → mock KIS API
  // /kis/...  → mode는 헤더의 tr_cont나 기본 real
  const urlParts = req.url.match(/^\/(real|mock|kis)(\/.*)/);
  if (!urlParts) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use /real/... or /mock/...' }));
    return;
  }

  const modePrefix = urlParts[1];
  const kisPath = urlParts[2];
  const mode = modePrefix === 'mock' ? 'mock' : 'real';
  const targetHost = kisHost(mode);

  // body 수집
  let bodyStr = '';
  await new Promise(resolve => {
    req.on('data', c => { bodyStr += c; });
    req.on('end', resolve);
  });

  try {
    console.log(`[${new Date().toISOString()}] ${req.method} ${modePrefix}${kisPath} → ${targetHost}`);
    const result = await forwardToKis(targetHost, kisPath, req.method, req.headers, bodyStr || null);

    // KIS 응답 헤더 전달 (tr_id 등)
    const forwardHeaders = { 'Content-Type': 'application/json' };
    if (result.headers['tr_id']) forwardHeaders['tr_id'] = result.headers['tr_id'];
    if (result.headers['gt_uid']) forwardHeaders['gt_uid'] = result.headers['gt_uid'];

    res.writeHead(result.status, forwardHeaders);
    res.end(result.body);
  } catch (err) {
    console.error('[프록시 오류]', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'proxy_error', message: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ KIS 프록시 시작됨: http://0.0.0.0:${PORT}`);
  console.log(`   테스트: curl http://localhost:${PORT}/ping`);
});
