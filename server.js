const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DART_KEY = process.env.DART_API_KEY || '';

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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS); res.end(); return;
  }

  const url = req.url.split('?')[0];
  const query = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');

  // ── Claude API 프록시
  if (url === '/api/claude' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const apiKey = process.env.ANTHROPIC_API_KEY || '';
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
