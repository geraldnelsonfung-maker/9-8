// 测试用 mock LLM：根据 CODEFIX_MOCK_MODE 模拟「能修好」和「修不好」两种行为。
export default async function mock({ verifyText, files, round }) {
  const mode = process.env.CODEFIX_MOCK_MODE || 'fix';

  if (mode === 'broken') {
    // 永远返回一个无效补丁，验证仍失败 → 触发回滚路径
    const target = files.find((f) => f.path.endsWith('app.js'));
    if (!target) return { summary: 'mock: 找不到目标文件', patches: [] };
    return {
      summary: 'mock: 故意给出错误修复',
      patches: [
        {
          file: target.path,
          reason: 'mock',
          content: 'this is ((( not valid javascript',
        },
      ],
    };
  }

  // fix 模式：把 app.js 中的语法错误修好（兼容 CRLF/LF）
  const target = files.find((f) => f.path.endsWith('app.js'));
  if (!target) return { summary: 'mock: 无候选文件', patches: [] };
  const eol = target.content.includes('\r\n') ? '\r\n' : '\n';
  const fixed = target.content
    .replace('console.log(add(1, 2)' + eol, 'console.log(add(1, 2))' + eol + '}' + eol);
  return {
    summary: 'mock: 补全 add 函数的闭合括号',
    patches: [
      { file: target.path, reason: 'node --check 报语法错误', content: fixed },
    ],
  };
}
