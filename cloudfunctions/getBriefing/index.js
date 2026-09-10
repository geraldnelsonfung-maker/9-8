const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('sv-SE');
}

function greetingByHour(hour) {
  if (hour < 6) return '夜深了，先看看明天的安排';
  if (hour < 11) return '早上好，新的一天从晨报开始';
  if (hour < 14) return '中午好，下午的日程在这';
  if (hour < 18) return '下午好，别忘了待办清单';
  return '晚上好，为明天做好准备';
}

/**
 * 订阅用户追加「今日情报」（webSearch 云函数：天气+偏好RSS+LLM摘要，订阅专属）。
 * 懒加载策略：不在定时触发器里调 LLM（逐用户串行会超 cron 时长），而是用户首次
 * 打开晨报时补充并落库，之后直接随缓存晨报返回；任何失败降级为 null，不阻塞晨报。
 */
async function attachIntel(openid) {
  try {
    const userRes = await db.collection('users').where({ openid }).limit(1).get();
    const user = userRes.data[0];
    const subscribed = !!(user && user.subscribed && user.expiredAt && new Date(user.expiredAt) > new Date());
    if (!subscribed) return null;
    const res = await cloud.callFunction({ name: 'webSearch', data: { action: 'briefing', openid } });
    const payload = res && res.result;
    if (payload && payload.code === 0 && payload.data) return payload.data;
    console.warn('[getBriefing] attachIntel bad payload:', payload && payload.message);
    return null;
  } catch (err) {
    console.warn('[getBriefing] attachIntel failed:', err && (err.errMsg || err.message));
    return null;
  }
}

/** 聚合某用户的晨报数据 */
async function aggregate(openid) {
  const eventsRes = await db
    .collection('events')
    .where({ openid, status: 'confirmed', startTime: _.gte(todayStr()) })
    .orderBy('startTime', 'asc')
    .limit(20)
    .get();
  const todosRes = await db
    .collection('todos')
    .where({ openid, status: 'confirmed' })
    .orderBy('dueDate', 'asc')
    .limit(20)
    .get();
  const itemsRes = await db
    .collection('items')
    .where({ openid, createTime: _.gte(new Date(Date.now() - 86400000).toISOString()) })
    .orderBy('createTime', 'desc')
    .limit(5)
    .get();

  const hour = new Date().getHours();
  const adaptive = computeAdaptive(eventsRes.data, todosRes.data);

  // 自适应开场（F21）：爆满日强调日程前置；有高优待办先点名
  let greeting = greetingByHour(hour);
  if (adaptive.busyDay) greeting = '今天日程很满，先看日程再逐项推进';
  else if (adaptive.focusTodo) greeting = `先办「${adaptive.focusTodo}」，其他从容推进`;

  return {
    date: todayStr(),
    greeting,
    events: eventsRes.data,
    todos: todosRes.data,
    digest: itemsRes.data.map((it) => `《${it.title}》：${it.summary}`),
    read: false,
    adaptive
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const today = todayStr();

  // 已有今日晨报直接返回
  const existing = await db
    .collection('briefings')
    .where({ openid: OPENID, date: today })
    .limit(1)
    .get();
  if (existing.data.length > 0) {
    const doc = existing.data[0];
    // 晨报已有但缺今日情报（如由定时器生成）：首次打开时懒加载补充
    if (!doc.intel) {
      const intel = await attachIntel(OPENID, doc.adaptive && doc.adaptive.tripCity);
      if (intel) {
        doc.intel = intel;
        await db.collection('briefings').doc(doc._id).update({ data: { intel } }).catch(() => {});
      }
    }
    return doc;
  }

  const briefing = await aggregate(OPENID);
  const intel = await attachIntel(OPENID, briefing.adaptive && briefing.adaptive.tripCity);
  if (intel) briefing.intel = intel;
  await db.collection('briefings').add({ data: { openid: OPENID, ...briefing } });
  return briefing;
};

/**
 * 定时触发器入口（云开发控制台配置触发器，cron: 0 30 7 * * * *）：
 * config.json 已声明 triggers，为每个用户生成晨报并发送订阅消息。
 * 订阅消息模板 ID 通过环境变量 SUBSCRIBE_TEMPLATE_ID 注入。
 */
exports.scheduled = async () => {
  const templateId = process.env.SUBSCRIBE_TEMPLATE_ID;
  const usersRes = await db.collection('users').limit(1000).get();
  for (const user of usersRes.data) {
    try {
      const briefing = await aggregate(user.openid);
      const dup = await db
        .collection('briefings')
        .where({ openid: user.openid, date: todayStr() })
        .limit(1)
        .get();
      if (dup.data.length === 0) {
        await db.collection('briefings').add({ data: { openid: user.openid, ...briefing } });
      }
      if (templateId && user.subscribeAccepted) {
        await cloud.openapi.subscribeMessage.send({
          touser: user.openid,
          templateId,
          page: 'pages/briefing/index',
          data: {
            thing1: { value: `你有 ${briefing.events.length} 个日程、${briefing.todos.length} 项待办` },
            time2: { value: user.briefingTime || '07:30' }
          }
        });
      }
    } catch (err) {
      console.error('[getBriefing.scheduled] user failed:', user.openid, err && err.errMsg);
    }
  }
};
