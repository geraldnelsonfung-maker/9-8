const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const res = await db
    .collection('items')
    .where({ openid: OPENID })
    .orderBy('createTime', 'desc')
    .limit(100)
    .get();
  return res.data;
};
