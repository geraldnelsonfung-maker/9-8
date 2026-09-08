const cloud = require('wx-server-sdk');
const { callLLM } = require('./llm');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const SYSTEM_PROMPT = `你是私人晨报助理的提取引擎。分析用户转发的微信消息/文章，输出 JSON（不要输出任何其他文本）：
{
  "events": [{ "title": string, "startTime": "YYYY-MM-DD HH:mm", "endTime": string|null, "location": string|null, "source": string }],
  "todos": [{ "title": string, "dueDate": "YYYY-MM-DD HH:mm"|null, "source": string }],
  "collection": { "title": string, "summary": string(80字内), "tags": string[], "url": string|null, "sourceType": "article"|"message"|"link" } | null,
  "note": string|null
}
规则：
1. 相对时间基于"当前时间"推算绝对时间；
2. 只有明确的会议/约会/行程才算 event，需要去做的事算 todo；
3. 长文本（>120字）且像文章/链接内容才输出 collection；消息原文较短时 collection 为 null；
4. 无法归类的内容放进 note；
5. 全部字段使用简体中文。`;

/** 内容安全：过微信 msgSecCheck，命中则拒绝 */
async function securityCheck(content, openid) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      version: 2,
      openid,
      scene: 1,
      content: content.slice(0, 2500)
    });
    if (res && res.result && res.result.suggest && res.result.suggest !== 'pass') {
      return false;
    }
    return true;
  } catch (err) {
    // 内容安全接口异常时不阻断主流程，仅记录
    console.warn('[extract] msgSecCheck skipped:', err && err.errMsg);
    return true;
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        /* fallthrough */
      }
    }
    return null;
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const content = (event && event.content ? String(event.content) : '').trim();
  if (!content) throw new Error('content is required');
  if (content.length > 5000) throw new Error('content too long (max 5000)');

  const safe = await securityCheck(content, OPENID);
  if (!safe) {
    throw new Error('content failed security check');
  }

  const now = new Date();
  const nowStr = `${now.toLocaleDateString('sv-SE')} ${now.toTimeString().slice(0, 5)}`;
  const raw = await callLLM(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `当前时间：${nowStr}\n用户转发内容：\n${content}` }
    ],
    true
  );
  const parsed = safeParse(raw);
  if (!parsed) {
    console.error('[extract] bad LLM output:', raw);
    throw new Error('extract failed: invalid LLM output');
  }

  return {
    events: Array.isArray(parsed.events) ? parsed.events.slice(0, 10) : [],
    todos: Array.isArray(parsed.todos) ? parsed.todos.slice(0, 10) : [],
    collection: parsed.collection || undefined,
    note: parsed.note || undefined
  };
};
