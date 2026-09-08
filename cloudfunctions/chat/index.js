const cloud = require('wx-server-sdk');
const { callLLM } = require('./llm');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const FREE_VOICE_QUOTA = 20;

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

async function getUsage(openid) {
  const res = await db
    .collection('usage')
    .where({ openid, month: monthStart() })
    .limit(1)
    .get();
  if (res.data.length > 0) return res.data[0];
  const doc = { openid, month: monthStart(), voiceUsed: 0, updatedAt: new Date().toISOString() };
  await db.collection('usage').add({ data: doc });
  return doc;
}

async function getUser(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get();
  return res.data.length > 0 ? res.data[0] : null;
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

/** 规则兜底：LLM 不可用时保证基础指令可用 */
async function ruleFallback(openid, message) {
  if (/完成|办完|搞定了/.test(message)) {
    const todos = await db
      .collection('todos')
      .where({ openid, status: 'confirmed' })
      .orderBy('dueDate', 'asc')
      .limit(1)
      .get();
    if (todos.data.length > 0) {
      await db.collection('todos').doc(todos.data[0]._id).update({ data: { status: 'done' } });
      return { reply: `已把「${todos.data[0].title}」标记完成。`, action: 'todo_done' };
    }
  }
  const todosRes = await db
    .collection('todos')
    .where({ openid, status: 'confirmed' })
    .orderBy('dueDate', 'asc')
    .limit(5)
    .get();
  const eventsRes = await db
    .collection('events')
    .where({ openid, status: 'confirmed' })
    .orderBy('startTime', 'asc')
    .limit(5)
    .get();
  const lines = [];
  if (eventsRes.data.length > 0) {
    lines.push(`你有 ${eventsRes.data.length} 个日程：${eventsRes.data.map((e) => e.title).join('、')}`);
  }
  if (todosRes.data.length > 0) {
    lines.push(`${todosRes.data.length} 项待办：${todosRes.data.map((t) => t.title).join('、')}`);
  }
  return { reply: lines.join('\n') || '你目前没有日程和待办，享受清净吧。', action: 'query' };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const message = (event && event.message ? String(event.message) : '').trim();
  if (!message) throw new Error('message is required');

  // 额度校验：订阅用户不限次
  const user = await getUser(OPENID);
  const isSubscribed = !!(user && user.subscribed && user.expiredAt && new Date(user.expiredAt) > new Date());
  if (!isSubscribed) {
    const usage = await getUsage(OPENID);
    if (usage.voiceUsed >= FREE_VOICE_QUOTA) {
      throw new Error('voice quota exceeded, please subscribe');
    }
    await db.collection('usage').doc(usage._id).update({
      data: { voiceUsed: _.inc(1), updatedAt: new Date().toISOString() }
    });
  }

  // 上下文：近 5 条日程 + 5 条待办
  const [eventsRes, todosRes] = await Promise.all([
    db.collection('events').where({ openid: OPENID, status: 'confirmed' }).orderBy('startTime', 'asc').limit(5).get(),
    db.collection('todos').where({ openid: OPENID, status: 'confirmed' }).orderBy('dueDate', 'asc').limit(5).get()
  ]);
  const context = JSON.stringify({
    now: `${new Date().toLocaleDateString('sv-SE')} ${new Date().toTimeString().slice(0, 5)}`,
    events: eventsRes.data.map((e) => ({ id: e._id, title: e.title, startTime: e.startTime })),
    todos: todosRes.data.map((t) => ({ id: t._id, title: t.title, dueDate: t.dueDate }))
  });

  let result;
  try {
    const raw = await callLLM(
      [
        {
          role: 'system',
          content:
            '你是私人晨报助理。基于用户当前日程数据执行指令，输出 JSON：{"reply": "给用户的中文回复(60字内)", "action": "reschedule|done|query|chat", "targetId": "事件或待办id或null", "newTime": "YYYY-MM-DD HH:mm或null"}。改期指令且能定位目标时 action=reschedule；完成指令且能定位时 action=done；询问安排时 action=query；闲聊 action=chat。'
        },
        { role: 'user', content: `我的数据：${context}\n我的指令：${message}` }
      ],
      true
    );
    result = safeParse(raw);
  } catch (err) {
    console.warn('[chat] LLM failed, fallback to rules:', err && err.message);
  }

  if (!result || !result.reply) {
    const fallback = await ruleFallback(OPENID, message);
    return fallback;
  }

  // 执行动作
  if (result.action === 'reschedule' && result.targetId && result.newTime) {
    try {
      const evt = await db.collection('events').doc(result.targetId).get();
      if (evt.data && evt.data.openid === OPENID) {
        await db.collection('events').doc(result.targetId).update({
          data: { startTime: result.newTime }
        });
      }
    } catch (err) {
      console.warn('[chat] reschedule failed:', err && err.errMsg);
    }
  } else if (result.action === 'done' && result.targetId) {
    try {
      const todo = await db.collection('todos').doc(result.targetId).get();
      if (todo.data && todo.data.openid === OPENID) {
        await db.collection('todos').doc(result.targetId).update({
          data: { status: 'done' }
        });
      }
    } catch (err) {
      console.warn('[chat] done failed:', err && err.errMsg);
    }
  }

  return { reply: String(result.reply).slice(0, deep ? 500 : 120), action: result.action || 'chat' };
};
