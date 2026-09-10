// 配置加载：读取目标仓库的 codefix.config.js（可选），否则用默认推断。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const DEFAULT_GIT =
  process.env.CODEFIX_GIT ||
  'C:\\Users\\geral\\.local\\bin\\mingit\\cmd\\git.exe';

// 从目标仓库 package.json 的 scripts 推断验证命令。
function inferCommands(pkg) {
  const cmds = [];
  const s = (pkg.scripts || {});
  if (s.typecheck || s['type-check']) cmds.push('npm run typecheck');
  if (s.tsc) cmds.push('npm run tsc');
  if (s.lint) cmds.push('npm run lint');
  if (s.test) cmds.push('npm test');
  if (s.build) cmds.push('npm run build');
  return cmds;
}

export async function loadConfig(repoDir) {
  const userConfigPath = path.join(repoDir, 'codefix.config.js');
  let user = {};
  if (existsSync(userConfigPath)) {
    user = (await import(pathToFileURL(userConfigPath).href)).default || {};
  }

  let inferred = [];
  const pkgPath = path.join(repoDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath));
      inferred = inferCommands(pkg);
    } catch {
      /* 忽略解析失败 */
    }
  }

  return {
    // 验证命令数组；每条都在 worktree 内执行，全部退出码 0 视为通过
    verifyCommands: user.verifyCommands || inferred,
    // 单轮喂给 LLM 的文件字节上限（控制 token）
    maxFileBytes: user.maxFileBytes || 24 * 1024,
    // 自动修复最大轮数
    maxRounds: user.maxRounds || 3,
    // 单条验证命令超时（毫秒）
    commandTimeoutMs: user.commandTimeoutMs || 10 * 60 * 1000,
    // 哪些文件允许被修改（glob 简化版：前缀匹配）；为空表示不限制
    allowPaths: user.allowPaths || [],
    // 报告输出目录
    reportDir: user.reportDir || '.codefix',
  };
}
