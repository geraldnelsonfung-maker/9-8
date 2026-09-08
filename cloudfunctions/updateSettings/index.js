const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const payload = event || {};
  const update = {};

  if (typeof payload.nickname === 'string' && payload.nickname.trim()) {
    update.nickname = payload.nickname.trim().slice(0, 12);
  }
  if (typeof payload.briefingTime === 'string' && /^\d{2}:\d{2}$/.test(payload.briefingTime)) {
    update.briefingTime = payload.briefingTime;
  }
  if (Array.isArray(payload.preferences)) {
    update.preferences = payload.preferences.slice(0, 10).map(String);
  }
  if (Object.keys(update).length === 0) {
    throw new Error('no valid fields to update');
  }
  update.updatedAt = new Date().toISOString();

  try {
    await db.collection('users').where({ openid: OPENID }).update({ data: update });
  } catch (err) {
    console.error('[updateSettings] failed:', err);
    throw err;
  }

  const res = await db.collection('users').where({ openid: OPENID }).limit(1).get();
  return res.data[0];
};
