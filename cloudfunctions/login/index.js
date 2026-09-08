const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const users = db.collection('users');

  try {
    const existing = await users.where({ openid: OPENID }).limit(1).get();
    if (existing.data.length > 0) {
      return existing.data[0];
    }
  } catch (err) {
    console.error('[login] query failed:', err);
    throw err;
  }

  const profile = {
    openid: OPENID,
    nickname: '晨友',
    briefingTime: '07:30',
    preferences: [],
    subscribed: false,
    expiredAt: null,
    isEarlyBird: false,
    createdAt: new Date().toISOString()
  };

  try {
    await users.add({ data: profile });
  } catch (err) {
    console.error('[login] create user failed:', err);
    throw err;
  }
  return profile;
};
