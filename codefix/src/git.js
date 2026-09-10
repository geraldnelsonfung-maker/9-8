// Git 辅助：worktree 隔离、提交、回滚。所有改动只发生在 worktree，绝不碰主工作区。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_GIT } from './config.js';

function gitPath() {
  return existsSync(DEFAULT_GIT) ? DEFAULT_GIT : 'git';
}

function runGit(args, cwd) {
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

// 创建 detached worktree，返回其绝对路径
export async function createWorktree(repoDir, worktreePath) {
  if (existsSync(worktreePath)) {
    await rm(worktreePath, { recursive: true, force: true });
  }
  const r = await runGit(['worktree', 'add', '--detach', worktreePath, 'HEAD'], repoDir);
  if (r.code !== 0) {
    throw new Error('创建 worktree 失败: ' + (r.stderr || r.stdout));
  }
  return worktreePath;
}

export async function removeWorktree(repoDir, worktreePath) {
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

export { runGit };
