// Railway 빌드 시 실행 — config.js 생성
const fs = require('fs');
const cfg = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  KIS_APP_KEY: process.env.KIS_APP_KEY || '',
  KIS_APP_SECRET: process.env.KIS_APP_SECRET || '',
  KIS_ACCOUNT: process.env.KIS_ACCOUNT || '',
  KIS_MODE: process.env.KIS_MODE || 'real',
};
fs.writeFileSync('./config.js', `module.exports = ${JSON.stringify(cfg, null, 2)};`);
console.log('✅ config.js 생성됨');
