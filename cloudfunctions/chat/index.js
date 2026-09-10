const cloud = require('wx-server-sdk');
const { callLLM, callLLMWebSearch } = require('./llm');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const FREE_VOICE_QUOTA = 20;

/** 工作助手模式提示词（mode=work 时按 workAction 选择；修复 workAction 此前未传给 LLM 导致真机退化为普通聊天的问题） */
const WORK_SYSTEM_PROMPTS = {
  summary:
    '你是用户的工作助手。对用户提供的内容做总结：先一句结论，再分点列出核心内容，最后一行给一个行动建议。输出 JSON：{"reply": "总结(500字内，可分行)", "action": "chat", "targetId": null, "newTime": null}。',
  points:
    '你是用户的工作助手。从用户提供的内容中提取 3-6 条关键要点，每条一行、尽量短；末尾附一行「关键数据」（没有就写「无明显数据」）。输出 JSON：{"reply": "要点(500字内，可分行)", "action": "chat", "targetId": null, "newTime": null}。',
  advice:
    '你是用户的工作助手。基于用户提供的内容给出 3 条具体可执行的建议，每条说明「做什么、为什么」，不空洞打气。输出 JSON：{"reply": "建议(500字内，可分行)", "action": "chat", "targetId": null, "newTime": null}。'
};

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

/** 购物清单操作：读 / 添加 / 标记已买 / 记比价（真机 AI 也认领购物清单） */
async function handleShoppingList(openid, message) {
  const col = db.collection('shopping');
  const list = () => col.where({ openid }).orderBy('createdAt', 'desc').limit(100).get();

  // 1) 添加：「把 XX 加进/加入/添加到 购物清单」或「购物清单加 XX」
  const addMatch = message.match(/把?([\u4e00-\u9fa5A-Za-z0-9（）()]{1,16}?)(?:加(?:入|进)|添加到|加到|记入)购物清单/);
  if (addMatch) {
    const name = addMatch[1].trim();
    await col.add({ data: { openid, name, bought: false, createdAt: new Date().toISOString(), prices: [] } });
    return { reply: `✅ 已把「${name}」加进购物清单。说「帮我看下购物清单」就能展示，或去「我的 → 购物清单」记比价。`, action: 'shopping' };
  }

  const res = await list();
  const items = res.data;

  // 2) 标记已买：「把 XX 标记已买」
  const doneMatch = message.match(/(?:把)?\s*([\u4e00-\u9fa5A-Za-z0-9（）()]{2,16})\s*(?:标记)?(?:为)?已买/);
  if (doneMatch) {
    const name = doneMatch[1];
    const hit = items.find((it) => !it.bought && it.name.includes(name));
    if (hit) {
      await col.doc(hit._id).update({ data: { bought: true } });
      return { reply: `🎉 已把「${hit.name}」标记为已买，为你记账。`, action: 'shopping' };
    }
    return { reply: `清单里没找到「${name}」。可以说「把${name}加进购物清单」添加。`, action: 'shopping' };
  }

  // 3) 读取清单
  if (/购物清单|清单/.test(message)) {
    const notBought = items.filter((it) => !it.bought);
    if (notBought.length === 0) {
      return {
        reply: items.length === 0
          ? '🛒 购物清单还是空的。说「把XX加进购物清单」就能添加想买的东西。'
          : `🛒 你清单里 ${items.filter((it) => it.bought).length} 件都已买了，没有待购的。要加新的就说「把XX加进购物清单」。`,
        action: 'shopping'
      };
    }
    const lines = [`🛒 你购物清单里还有 ${notBought.length} 件待购：`];
    notBought.forEach((it, i) => {
      const tag = it.prices && it.prices.length
        ? `（已比价，最低￥${Math.min(...it.prices.map((p) => p.price))}）`
        : it.targetPrice
          ? `（目标 ￥${it.targetPrice}，未比价）`
          : '（未比价）';
      lines.push(`${i + 1}. ${it.name} ${tag}`);
    });
    lines.push('\n需要的话我可以帮其中某件做比价分析，或说「把XX标记已买」。');
    return { reply: lines.join('\n'), action: 'shopping' };
  }

  return null;
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
  const deep = !!(event && event.deep);
  const mode = event && event.mode;
  const workAction = event && event.workAction;
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

  // 购物清单指令优先于通用对话（读 / 加 / 勾买都直接落库）
  if (
    /购物清单|清单/.test(message) &&
    (/(有|看|展示|列|查|显示|还剩|还有什么)/.test(message) ||
      /(把|将|加|加入|添加|记下)/.test(message) ||
      /买|已买|入手|搞定/.test(message))
  ) {
    const shop = await handleShoppingList(OPENID, message);
    if (shop) return shop;
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
    const systemContent =
      mode === 'work'
        ? WORK_SYSTEM_PROMPTS[workAction] || WORK_SYSTEM_PROMPTS.summary
        : deep
          ? '你是用户的深度思考伙伴。用户抛出纠结或问题时，帮其拆解：1) 关键矛盾是什么 2) 各选项的利弊 3) 给出一个可执行的下一步。语气克制友好，不空洞打气。输出 JSON：{"reply": "给用户的中文回复(500字内，可分行)", "action": "chat", "targetId": null, "newTime": null}。'
          : '你是私人晨报助理。基于用户当前日程数据及对话执行指令。输出 JSON：{"reply": "给用户的中文回复(120字内)", "action": "reschedule|done|query|schedule|batch|shopping|chat", "targetId": "事件或待办id或null", "newTime": "YYYY-MM-DD HH:mm或null", "newEvents": null}。改期指令且能定位目标时 action=reschedule；完成指令且能定位时 action=done；询问安排时 action=query；闲聊 action=chat。排班（如「帮我安排周五下午开会」）：对照已有日程找空闲时段，给 1 个建议时段和理由，action=schedule 且 newTime=建议时段，不要写库，等用户回复「确认」后再 reschedule。批量/周期排班（如「把周会固定到每周二上午」「下周一站会、周三下午评审、周五复盘」）时 action=batch：newEvents=[{"title":"会议名","startTime":"YYYY-MM-DD HH:mm"}]，周期会议给未来 4 次具体日期，单次批量最多 5 条，直接排入无需确认；reply 里逐条列出排入时间。当识别到购物意图（买、对比、哪个划算、值不值、求推荐商品、想买东西、预算内选什么）时，action=shopping：输出一份选购分析——拆解需求与预算、列出 2-4 个主流平台/方案的关键差异（价格、售后、物流、口碑要点）、给出明确结论和下一步。若你需要联网实时查价但无搜索工具，就基于常识给相对对比并明确标注"价格为参考，以平台实时为准"，绝不谎称是实时联网数据。';
    const raw = await callLLM(
      [
        { role: 'system', content: systemContent },
        { role: 'user', content: `我的数据：${context}\n我的指令：${message}` }
      ],
      true
    );
    result = safeParse(raw);
  } catch (err) {
    console.warn('[chat] LLM failed, fallback to rules:', err && err.message);
  }

  if (!result || !result.reply) {
    if (mode === 'work') {
      return { reply: 'AI 服务暂时不可用，请稍后再试，或把内容拆短一些重试。', action: 'chat' };
    }
    const fallback = await ruleFallback(OPENID, message);
    return fallback;
  }

  // 购物意图：走联网检索补实时价格与来源（callLLMWebSearch；未配置 LLM_WEB_API_KEY 或
  // 检索失败时保留主模型回答，不阻塞对话）
  if (result.action === 'shopping') {
    try {
      const webReply = await callLLMWebSearch(
        [
          {
            role: 'system',
            content:
              '你是购物比价助手。基于联网检索结果，输出该商品的实时比价：每个平台一行（平台名、价格、关键点与来源链接），最后给出最低价结论与一步建议。必须标注数据来源；检索不到可靠信息时明确写「未能获取实时价格，以下为参考建议」，禁止编造精确价格。'
          },
          { role: 'user', content: message }
        ],
        false
      );
      if (webReply) result.reply = webReply;
    } catch (err) {
      console.warn('[chat] web search failed, keep main-model reply:', err && err.message);
    }
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
  } else if (result.action === 'batch' && Array.isArray(result.newEvents) && result.newEvents.length > 0) {
    // F24 批量/周期排班：LLM 解析出的多条日程一次落库（服务端 add 支持数组批量写入）
    const docs = result.newEvents
      .slice(0, 5)
      .map((e) => ({
        openid: OPENID,
        title: String((e && e.title) || '日程').slice(0, 30),
        startTime: String((e && e.startTime) || ''),
        status: 'confirmed',
        source: 'AI 批量排班',
        createdAt: new Date().toISOString()
      }))
      .filter((d) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(d.startTime));
    if (docs.length > 0) {
      try {
        await db.collection('events').add({ data: docs });
      } catch (err) {
        console.warn('[chat] batch schedule failed:', err && err.errMsg);
      }
    }
  }

  // 工作助手/深思/联网比价/批量排班回复较长，放宽截断；普通对话维持 120 字
  const maxLen = deep || mode === 'work' || result.action === 'shopping' || result.action === 'batch' ? 500 : 120;
  return { reply: String(result.reply).slice(0, maxLen), action: result.action || 'chat' };
};
