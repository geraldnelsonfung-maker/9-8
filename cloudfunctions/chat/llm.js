/**
 * LLM 调用封装 —— 与 extract/llm.js 相同约定
 * 密钥通过云函数环境变量注入，严禁写入代码
 */
const https = require('https');
const { URL } = require('url');

function callLLM(messages, jsonMode) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error('LLM_API_KEY not configured');
  }
  const base = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.LLM_MODEL || 'deepseek-chat';
  const endpoint = new URL('/chat/completions', base);

  const payload = JSON.stringify({
    model,
    messages,
    temperature: 0.3,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 30000
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (res.statusCode !== 200) {
              return reject(new Error(`LLM ${res.statusCode}: ${body.slice(0, 200)}`));
            }
            resolve(data.choices[0].message.content);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('LLM request timeout')));
    req.write(payload);
    req.end();
  });
}

module.exports = { callLLM };
