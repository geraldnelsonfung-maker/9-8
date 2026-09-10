const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/** 注销账号：删除用户全部数据（F18 合规硬门槛） */
exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) throw new Error('no openid');

  const collections = ['users', 'events', 'todos', 'items', 'briefings', 'usage', 'history'];
  let deleted = 0;
  for (const name of collections) {
    try {
      const res = await db.collection(name).where({ openid: OPENID }).remove();
      deleted += (res.stats && res.stats.removed) || 0;
    } catch (err) {
      // 集合不存在时忽略，继续清理其他集合
      console.warn(`[deleteAccount] collection ${name} remove failed:`, err && err.message);
    }
  }

  console.info(`[deleteAccount] openid=${OPENID} removed=${deleted}`);
  return { code: 0, data: { deleted: true } };
};
