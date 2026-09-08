const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const FREE_VOICE_QUOTA = 20;
const FREE_COLLECTION_QUOTA = 50;

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();

  const [userRes, usageRes, itemsCount] = await Promise.all([
    db.collection('users').where({ openid: OPENID }).limit(1).get(),
    db.collection('usage').where({ openid: OPENID, month: monthStart() }).limit(1).get(),
    db.collection('items').where({ openid: OPENID }).count()
  ]);

  const user = userRes.data[0];
  const isSubscribed = !!(
    user &&
    user.subscribed &&
    user.expiredAt &&
    new Date(user.expiredAt) > new Date()
  );

  return {
    voiceUsed: usageRes.data.length > 0 ? usageRes.data[0].voiceUsed : 0,
    voiceQuota: isSubscribed ? -1 : FREE_VOICE_QUOTA,
    collectionCount: itemsCount.total,
    collectionQuota: isSubscribed ? -1 : FREE_COLLECTION_QUOTA
  };
};
