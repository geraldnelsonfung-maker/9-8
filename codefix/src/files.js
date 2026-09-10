// 仓库文件读取：递归收集文本文件（跳过 node_modules/.git/dist 等），供 LLM 上下文使用。
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '.codefix', 'coverage']);
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.vue', '.scss', '.css', '.html', '.md', '.yml', '.yaml', '.txt']);

export async function collectTextFiles(dir, root = dir, limit = 2000) {
  const out = [];
  async function walk(cur) {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(abs);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!TEXT_EXT.has(ext) && !['package.json', 'tsconfig.json'].includes(e.name)) continue;
        const s = await stat(abs);
        if (s.size > 512 * 1024) continue;
        try {
          const content = await readFile(abs, 'utf8');
          out.push({ path: path.relative(root, abs).replace(/\\/g, '/'), content });
        } catch {
          /* 二进制或读取失败，跳过 */
        }
      }
    }
  }
  await walk(dir);
  return out;
}
