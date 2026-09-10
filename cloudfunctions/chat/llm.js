/**
 * LLM 调用封装 —— 与 extract/llm.js 相同约定
 * 密钥通过云函数环境变量注入，严禁写入代码
 */
const https = require('https');
const { URL } = require('url');

function request(base, model, apiKey, body) {
  const endpoint = new URL('/chat/completions', base);
  const payload = JSON.stringify(body);
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
        let resp = '';
        res.on('data', (chunk) => (resp += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(resp);
            if (res.statusCode !== 200) {
              return reject(new Error(`LLM ${res.statusCode}: ${resp.slice(0, 200)}`));
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

/** 通用对话：默认 DeepSeek（主链路） */
function callLLM(messages, jsonMode) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error('LLM_API_KEY not configured');
  }
  const base = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.LLM_MODEL || 'deepseek-chat';
  return request(base, model, apiKey, {
    model,
    messages,
    temperature: 0.3,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
  });
}

/**
 * 联网实时检索（用于购物比价等需要实时信息的场景）：
 * 走独立配置，默认通义 DashScope 兼容接口 + enable_search，真机查实时价格与来源。
 * 需配置 LLM_WEB_API_KEY；未配置时调用会 reject，调用方自行回退。
 *   LLM_WEB_API_KEY   必填（通义百炼 DashScope Key 或兼容接口 Key）
 *   LLM_WEB_BASE_URL  选填，默认 https://dashscope.aliyuncs.com/compatible-mode/v1
 *   LLM_WEB_MODEL     选填，默认 qwen-plus（已开通联网服务）
 */
function callLLMWebSearch(messages, jsonMode) {
  const apiKey = process.env.LLM_WEB_API_KEY;
  if (!apiKey) {
    throw new Error('LLM_WEB_API_KEY not configured');
  }
  const base = process.env.LLM_WEB_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = process.env.LLM_WEB_MODEL || 'qwen-plus';
  return request(base, model, apiKey, {
    model,
    messages,
    temperature: 0.4,
    enable_search: true, // 通义 Qwen OpenAI 兼容模式开启联网检索
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
  });
}

module.exports = { callLLM, callLLMWebSearch };
