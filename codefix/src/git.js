// Git 辅助：worktree 隔离、提交、回滚。所有改动只发生在 worktree，绝不碰主工作区。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_GIT } from './config.js';

function gitPath() {
  return existsSync(DEFAULT_GIT) ? DEFAULT_GIT : 'git';
}

export function runGit(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(gitPath(), args, { cwd, env: process.env });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
    child.on('error', (e) => resolve({ code: -1, stdout: out, stderr: String(e) }));
  });
}

export async function isGitRepo(dir) {
  const r = await runGit(['rev-parse', '--is-inside-work-tree'], dir);
  return r.code === 0 && r.stdout.trim() === 'true';
}

export async function hasUncommittedChanges(dir) {
  const r = await runGit(['status', '--porcelain'], dir);
  return r.stdout.trim().length > 0;
}

export async function currentBranch(dir) {
  const r = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
  return r.stdout.trim();
}

function spawnWait(bin, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd });
    child.on('close', resolve);
    child.on('error', resolve);
  });
}

// 把 node_modules 加入 worktree 的 info/exclude，防止被 git add -A 卷入
async function excludeNodeModules(worktreePath) {
  try {
    const r = await runGit(['rev-parse', '--git-dir'], worktreePath);
    if (r.code !== 0) return;
    const excludeFile = path.join(path.resolve(worktreePath, r.stdout.trim()), 'info', 'exclude');
    await mkdir(path.dirname(excludeFile), { recursive: true });
    let cur = '';
    try {
      cur = await readFile(excludeFile, 'utf8');
    } catch {
      /* 文件可能不存在 */
    }
    if (!cur.split('\n').includes('node_modules/')) {
      await writeFile(excludeFile, cur + (cur.endsWith('\n') || cur === '' ? '' : '\n') + 'node_modules/\n', 'utf8');
    }
  } catch {
    /* 非关键路径 */
  }
}

// 创建 detached worktree，返回其绝对路径
export async function createWorktree(repoDir, worktreePath) {
  if (existsSync(worktreePath)) {
    await rm(worktreePath, { recursive: true, force: true });
  }
  const r = await runGit(['worktree', 'add', '--detach', worktreePath, 'HEAD'], repoDir);
  if (r.code !== 0) {
    throw new Error('创建 worktree 失败: ' + (r.stderr || r.stdout));
  }
  // node_modules 不入库，worktree 里没有；链接主仓库的，保证验证命令可跑
  const srcNm = path.join(repoDir, 'node_modules');
  const dstNm = path.join(worktreePath, 'node_modules');
  if (existsSync(srcNm) && !existsSync(dstNm)) {
    const args =
      process.platform === 'win32'
        ? ['/c', 'mklink', '/J', dstNm, srcNm]
        : ['-c', 'ln', '-s', srcNm, dstNm];
    const bin = process.platform === 'win32' ? 'cmd' : 'sh';
    await spawnWait(bin, args, repoDir);
  }
  await excludeNodeModules(worktreePath);
  return worktreePath;
}

// 安全断开 node_modules 链接：只删链接本身，绝不递归进真实 node_modules
export async function unlinkNodeModules(worktreePath) {
  const dstNm = path.join(worktreePath, 'node_modules');
  if (!existsSync(dstNm)) return;
  try {
    if (process.platform === 'win32') {
      await spawnWait('cmd', ['/c', 'rmdir', dstNm], worktreePath);
    } else {
      await rm(dstNm, { force: true }); // 非递归：对符号链接只删链接
    }
  } catch {
    /* 链接可能已被 git worktree remove 处理 */
  }
}

export async function removeWorktree(repoDir, worktreePath) {
  await unlinkNodeModules(worktreePath);
  await runGit(['worktree', 'remove', '--force', worktreePath], repoDir);
  if (existsSync(worktreePath)) {
    await rm(worktreePath, { recursive: true, force: true });
  }
  await runGit(['worktree', 'prune'], repoDir);
}

// 在 worktree 内提交全部改动到一个新分支，返回分支名
export async function commitWorktree(worktreePath, branchName, message) {
  await runGit(['checkout', '-B', branchName], worktreePath);
  await runGit(['add', '-A'], worktreePath);
  const r = await runGit(['commit', '-m', message], worktreePath);
  return { committed: r.code === 0, stdout: r.stdout, stderr: r.stderr };
}
