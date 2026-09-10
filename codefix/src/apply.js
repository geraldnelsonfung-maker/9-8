// 补丁应用与安全校验：把 LLM 返回的整文件内容写入 worktree，并做边界检查。
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// allowPaths 前缀匹配（支持尾部 *）
function matchAllow(relPath, allowPaths) {
  if (!allowPaths || allowPaths.length === 0) return true;
  const p = relPath.toLowerCase();
  return allowPaths.some((a) => {
    const g = a.toLowerCase().replace(/\*\*/g, '*');
    if (g.endsWith('*')) return p.startsWith(g.slice(0, -1));
    return p === g || p.startsWith(g + '/');
  });
}

// 校验单个补丁路径是否安全（防路径穿越、防改 git 内部文件）
function isSafePath(relPath) {
  const p = path.normalize(relPath).replace(/\\/g, '/');
  if (p.startsWith('../') || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
  if (p.startsWith('.git/') || p === '.git') return false;
  if (p.startsWith('.codefix/')) return false;
  return true;
}

// 应用补丁数组，返回 { applied, rejected }
// 支持两种模式：
//   1. oldText/newText：精确替换文件中的代码片段（首选，token 省）
//   2. content：整文件覆盖（兼容旧格式）
export async function applyPatches(worktreeDir, patches, config) {
  const applied = [];
  const rejected = [];
  for (const patch of patches) {
    const rel = String(patch.file || '').replace(/\\/g, '/');
    if (!rel) {
      rejected.push({ file: rel, why: '补丁缺少 file 字段' });
      continue;
    }
    if (!isSafePath(rel)) {
      rejected.push({ file: rel, why: '路径不安全，拒绝写入' });
      continue;
    }
    if (!matchAllow(rel, config.allowPaths)) {
      rejected.push({ file: rel, why: '不在 allowPaths 白名单内' });
      continue;
    }
    const abs = path.join(worktreeDir, rel);
    let before = null;
    try {
      before = await readFile(abs, 'utf8');
    } catch {
      /* 新文件 */
    }

    // 模式 1：oldText/newText 精确替换
    if (typeof patch.oldText === 'string' && typeof patch.newText === 'string') {
      if (before === null) {
        rejected.push({ file: rel, why: 'oldText 模式要求文件已存在' });
        continue;
      }
      if (!before.includes(patch.oldText)) {
        rejected.push({ file: rel, why: 'oldText 在文件中未找到精确匹配' });
        continue;
      }
      const after = before.replace(patch.oldText, patch.newText);
      if (after === before) {
        continue; // 无变化
      }
      await writeFile(abs, after, 'utf8');
      applied.push({ file: rel, reason: patch.reason || '', before, after });
      continue;
    }

    // 模式 2：content 整文件覆盖（兼容旧格式）
    if (typeof patch.content === 'string') {
      if (before === patch.content) continue;
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, patch.content, 'utf8');
      applied.push({ file: rel, reason: patch.reason || '', before, after: patch.content });
      continue;
    }

    rejected.push({ file: rel, why: '补丁缺少 oldText/newText 或 content 字段' });
  }
  return { applied, rejected };
}

// 生成 unified diff 文本（用于报告展示），不依赖外部 diff 库的简易实现：
// 直接返回每个文件的 before/after 行数统计 + 原始 diff 由调用方用 git diff 生成。
export function diffStat(applied) {
  return applied.map((a) => {
    const b = (a.before ?? '').split('\n').length;
    const n = a.after.split('\n').length;
    return `${a.file}: ${b} → ${n} 行`;
  });
}
