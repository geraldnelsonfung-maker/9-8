// 加载 <repoDir>/.env.local（KEY=VALUE 格式），已存在的环境变量优先。
// 用途：把 API key 放在项目本地文件里，不进 git、不出机器。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadEnvLocal(repoDir) {
  const file = path.join(repoDir, '.env.local');
  if (!existsSync(file)) return;
  const text = await readFile(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // 去掉成对引号
    if (val.length > 1 && /^(".*"|'.*')$/.test(val)) val = val.slice(1, -1);
    if (val && process.env[key] === undefined) process.env[key] = val;
  }
}
