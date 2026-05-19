const fs = require('fs');
// 환경변수가 있으면 cfg.json 생성 (Railway 배포 시)
const cfg = {
  ck: process.env.ANTHROPIC_API_KEY || '',
  ak: process.env.KIS_APP_KEY || '',
  as: process.env.KIS_APP_SECRET || '',
  ac: process.env.KIS_ACCOUNT || '',
  md: process.env.KIS_MODE || 'real',
};
// 기존 cfg.json이 있으면 병합 (값이 있는 것 우선)
let existing = {};
try { existing = JSON.parse(fs.readFileSync('./cfg.json','utf8')); } catch(e) {}
const merged = {};
for(const k of ['ck','ak','as','ac','md','dk']){
  merged[k] = cfg[k] || existing[k] || '';
}
fs.writeFileSync('./cfg.json', JSON.stringify(merged, null, 2));
console.log('✅ cfg.json 생성/업데이트');
