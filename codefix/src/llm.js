// LLM 客户端：默认 DeepSeek（OpenAI 兼容 + JSON Mode）。
// 设置 CODEFIX_LLM_MOCK=<脚本路径> 可注入本地 mock（测试/离线用）。
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const SYSTEM_PROMPT = `你是一个代码自动修复引擎。你会收到：一个 git worktree 中项目的验证命令（编译/测试/lint）失败输出，以及相关文件的完整内容。

你的任务：针对错误给出最小改动的修复补丁。

只输出 JSON，不要输出其他任何内容，格式如下：
{
  "summary": "一句话说明这批修复做了什么",
  "patches": [
    {
      "file": "相对于仓库根目录的文件路径",
      "reason": "为什么要改这个文件",
      "content": "修改后的完整文件内容（整个文件，不是 diff）"
    }
  ]
}

规则：
- 只修改与错误直接相关的文件，禁止顺手重构。
- content 必须是修改后的完整文件内容。
- 如果你判断无法安全修复，返回 {"summary":"无法修复: <原因>","patches":[]}。
- 禁止修改测试文件来让测试通过，除非错误明确在测试本身。`;

function buildUserPrompt({ verifyText, files, round, goal }) {
  let text = `# 任务目标\n${goal || '让验证命令全部通过'}\n\n# 当前轮次\n第 ${round} 轮\n\n# 验证命令失败输出\n\`\`\`\n${verifyText}\n\`\`\`\n\n# 相关文件内容\n`;
  for (const f of files) {
    text += `\n--- 文件: ${f.path} ---\n\`\`\`\n${f.content}\n\`\`\`\n`;
  }
  return text;
}

// 从 LLM 回复中提取 JSON（容忍 markdown 代码块包裹）
export function parseJsonReply(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('LLM 回复中未找到 JSON');
  return JSON.parse(candidate.slice(start, end + 1));
}

async function callOpenaiCompatible({ baseUrl, apiKey, model, userPrompt, jsonMode }) {
  const payload = {
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  };
  // 部分 OpenAI 兼容服务（或某些模型）不支持 response_format，
  // 用 CODEFIX_LLM_JSON_MODE=false 关闭，靠 prompt + 容错提取 JSON。
  if (jsonMode) payload.response_format = { type: 'json_object' };
  const res = await fetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// 主入口：给定验证输出与候选文件，返回 { summary, patches }
export async function requestFixes({ verifyText, files, round, goal }) {
  const userPrompt = buildUserPrompt({ verifyText, files, round, goal });

  // mock 注入（测试 / 无 key 时演示）
  const mockPath = process.env.CODEFIX_LLM_MOCK;
  if (mockPath) {
    const mod = await import(pathToFileURL(mockPath).href);
    return mod.default({ verifyText, files, round, goal, userPrompt, parseJsonReply });
  }

  const apiKey =
    process.env.CODEFIX_LLM_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.HUNYUAN_API_KEY;
  if (!apiKey) {
    throw new Error(
      '未配置 LLM：请在 .env.local 或环境变量设置 CODEFIX_LLM_API_KEY' +
        '（也兼容 DEEPSEEK_API_KEY / HUNYUAN_API_KEY），' +
        '或用 CODEFIX_LLM_MOCK=<mock脚本路径> 注入本地 mock。'
    );
  }
  const baseUrl =
    process.env.CODEFIX_LLM_BASE_URL || 'https://api.deepseek.com/v1';
  const model = process.env.CODEFIX_LLM_MODEL || 'deepseek-chat';
  const jsonMode = process.env.CODEFIX_LLM_JSON_MODE !== 'false';

  const reply = await callOpenaiCompatible({ baseUrl, apiKey, model, userPrompt, jsonMode });
  return parseJsonReply(reply);
}

// 从验证输出里猜测相关文件（错误信息中出现的仓库相对路径）
export function extractCandidateFiles(verifyText) {
  const set = new Set();
  const re = /(?:^|[\s("])((?:[A-Za-z]:)?[\\/][^\s:()]+|[A-Za-z0-9_@.\-\\/]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|vue|scss|css))((?::\d+(?::\d+)?)?)/g;
  let m;
  while ((m = re.exec(verifyText)) !== null) {
    let p = m[1].replace(/\\/g, '/');
    // 去掉行号后缀、去掉绝对路径前缀的盘符
    p = p.replace(/:\d+(?::\d+)?$/, '');
    if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) {
      // 绝对路径：只保留文件名部分做匹配用
      p = p.split('/').slice(-2).join('/');
    }
    set.add(p);
  }
  return [...set];
}

// 挑选本轮要喂给 LLM 的文件：按候选名匹配仓库文件，受 maxFileBytes 总量约束
export async function selectFiles(repoDir, allFiles, candidates, config) {
  const picked = [];
  let total = 0;
  const norm = candidates.map((c) => c.toLowerCase());
  for (const f of allFiles) {
    const lower = f.path.toLowerCase();
    const hit = norm.some((c) => lower.endsWith(c) || lower.includes(c));
    if (!hit) continue;
    if (total + f.content.length > config.maxFileBytes * 6) break;
    picked.push(f);
    total += f.content.length;
    if (picked.length >= 8) break;
  }
  // 回退：错误信息不含文件路径时（如 tsc TS2688 隐式类型库错误），
  // 提供配置类文件，让 LLM 有机会从 tsconfig/package.json 层面修复。
  if (picked.length === 0) {
    const CONFIG_RE = /(^|\/)(tsconfig[^/]*\.json|jsconfig[^/]*\.json|package\.json|babel\.config\.|\.babelrc)/i;
    for (const f of allFiles) {
      if (!CONFIG_RE.test(f.path)) continue;
      if (total + f.content.length > config.maxFileBytes * 6) break;
      picked.push(f);
      total += f.content.length;
    }
  }
  return picked;
}
