// 사용자 데이터 저장 검증 — DATA_DIR 저장, 손상 파일 덮어쓰기 거부, DATA_DIR 쓰기 불가 시 시작 거부 (node, 의존성 없음)
// 실행:  node test/storage.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✖ FAIL: ' + m); } };

const req = (port, method, p, body, cookie, type) => new Promise((resolve) => {
  const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: Object.assign(
    data ? { 'Content-Type': type || 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    cookie ? { Cookie: cookie } : {}) }, (res) => {
    let s = ''; res.on('data', (c) => s += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: s }));
  });
  r.on('error', () => resolve({ status: 0, body: '' }));
  if (data) r.write(data); r.end();
});

async function startServer(dataDir, port) {
  const env = Object.assign({}, process.env, { PORT: String(port), APP_PASSWORD: 'testpw', DATA_DIR: dataDir });
  delete env.RAILWAY_VOLUME_MOUNT_PATH;
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 50; i++) { const r = await req(port, 'GET', '/api/version'); if (r.status) break; await new Promise((s) => setTimeout(s, 100)); }
  return { child, log: () => log };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traidair-store-'));
  const port = 39000 + Math.floor(Math.random() * 500);
  const srv = await startServer(dir, port);
  try {
    console.log('[A] DATA_DIR 에 저장');
    ok(/데이터 폴더: .*영구 저장/.test(srv.log()), '시작 로그에 영구 저장 폴더 표시');
    const login = await req(port, 'POST', '/login', 'password=testpw', null, 'application/x-www-form-urlencoded');
    const cookie = String((login.headers['set-cookie'] || [])[0] || '').split(';')[0];
    ok(!!cookie, '로그인 쿠키 발급');
    const r1 = await req(port, 'POST', '/api/user-data/htsMock', { value: '{"trades":[1]}' }, cookie);
    const file = path.join(dir, 'userdata.json');
    ok(r1.status === 200 && fs.existsSync(file), 'POST /api/user-data/htsMock → DATA_DIR/userdata.json 생성');
    ok(fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).htsMock === '{"trades":[1]}', '저장 내용 일치');
    await req(port, 'POST', '/api/user-data/htsJournals', { value: 'j' }, cookie);
    const both = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok(both.htsMock && both.htsJournals === 'j', '키를 추가 저장해도 기존 키 유지(병합)');
    ok(fs.existsSync(file + '.bak'), '직전 파일 .bak 보관');
    await req(port, 'POST', '/api/user-data/htsMock', { value: 'new', rev: 200 }, cookie);
    const stale = await req(port, 'POST', '/api/user-data/htsMock', { value: 'old', rev: 100 }, cookie);
    ok(JSON.parse(fs.readFileSync(file, 'utf8')).htsMock === 'new' && /"stale":true/.test(stale.body), '늦게 도착한 옛 rev 는 최신 값을 덮지 않음');
    await req(port, 'POST', '/api/user-data/htsMock', { value: 'tabB', rev: 200 }, cookie);
    ok(JSON.parse(fs.readFileSync(file, 'utf8')).htsMock === 'tabB', '같은 rev(다른 탭 동시 저장)는 버리지 않음');
    const bulk = await req(port, 'POST', '/api/user-data', { htsMock: 'bypass' }, cookie);
    ok(JSON.parse(fs.readFileSync(file, 'utf8')).htsMock === 'tabB' && bulk.status !== 200 || !/"ok":true/.test(bulk.body), 'rev 검사를 우회하던 일괄 저장 경로 제거');
    ok(!fs.readdirSync(dir).some((f) => f.includes('.tmp-')), '임시 파일이 남지 않음(원자적 쓰기)');

    console.log('[B] 손상 파일은 덮어쓰지 않음');
    fs.writeFileSync(file, '{broken json');
    const r2 = await req(port, 'POST', '/api/user-data/htsMock', { value: 'x' }, cookie);
    ok(fs.readFileSync(file, 'utf8') === '{broken json', '손상된 파일을 {} 로 덮어쓰지 않음');
    ok(r2.status === 200 && /"ok":false/.test(r2.body), '저장 실패를 응답으로 알림');
    const g = await req(port, 'GET', '/api/user-data', null, cookie);
    ok(g.status === 503 && /userdata_corrupt/.test(g.body), '손상 파일은 빈 데이터가 아니라 503 userdata_corrupt 로 알림');
    fs.writeFileSync(file, '[1,2]');
    const g2 = await req(port, 'GET', '/api/user-data', null, cookie);
    ok(g2.status === 503, '객체가 아닌 JSON(배열)도 손상으로 처리');
  } finally { srv.child.kill(); }

  console.log('[C] DATA_DIR 를 쓸 수 없으면 시작 거부');
  const badFile = path.join(dir, 'not-a-dir');
  fs.writeFileSync(badFile, 'x');   // 파일을 폴더로 지정 → mkdir 실패
  const r3 = spawnSync(process.execPath, ['server.js'], { cwd: root, env: Object.assign({}, process.env, { PORT: String(port + 1), DATA_DIR: path.join(badFile, 'sub'), APP_PASSWORD: 'testpw' }), timeout: 8000, encoding: 'utf8' });
  ok(r3.status === 1 && /데이터 폴더 쓰기 불가/.test((r3.stderr || '') + (r3.stdout || '')), '쓰기 불가 DATA_DIR → 종료 코드 1');

  console.log('[D] 키·GitHub 저장 코드 없음');
  const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  ok(!/api\.github\.com/.test(src), 'server.js 가 GitHub(공개 저장소)에 읽고 쓰지 않음');
  ok(!/traidair_config\.json/.test(src), 'KIS 키가 든 설정을 디스크에 쓰지 않음');

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
