// 购物清单：真机端 CRUD（按 openid 隔离云端清单）。H5 预览走 src/data/shopping.ts 本地 mock。
// 返回统一 { code, message, data }；data 为最终业务数据（与前端 callFunction 解包约定一致）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const col = cloud.database().collection('shopping');

function toItem(d) {
  return {
    id: d._id,
    name: d.name,
    targetPrice: d.targetPrice,
    link: d.link,
    bought: !!d.bought,
    createdAt: d.createdAt,
    prices: d.prices || []
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event && event.action;
  try {
    let data;
    if (action === 'list') {
      const res = await col.where({ openid: OPENID }).orderBy('createdAt', 'desc').get();
      data = res.data.map(toItem);
    } else if (action === 'add') {
      const name = String(event.name || '').trim();
      if (!name) throw new Error('name required');
      const targetPrice = Number(event.targetPrice);
      const item = {
        openid: OPENID,
        name,
        targetPrice: Number.isFinite(targetPrice) && targetPrice > 0 ? targetPrice : undefined,
        link: event.link || '',
        bought: false,
        createdAt: new Date().toISOString(),
        prices: []
      };
      const r = await col.add({ data: item });
      data = toItem({ _id: r._id, ...item });
    } else if (action === 'toggleBought') {
      const r = await col.doc(event.id).get();
      const d = r.data;
      if (!d || d.openid !== OPENID) throw new Error('not found');
      await col.doc(event.id).update({ data: { bought: !d.bought } });
      data = { id: event.id, bought: !d.bought };
    } else if (action === 'remove') {
      const r = await col.doc(event.id).get();
      const d = r.data;
      if (!d || d.openid !== OPENID) throw new Error('not found');
      await col.doc(event.id).remove();
      data = { id: event.id };
    } else if (action === 'addPrice') {
      const r = await col.doc(event.id).get();
      const d = r.data;
      if (!d || d.openid !== OPENID) throw new Error('not found');
      const platform = String(event.platform || '').trim();
      const price = Number(event.price);
      if (!platform || !Number.isFinite(price)) throw new Error('bad price');
      const prices = [...(d.prices || []), { platform, price }];
      await col.doc(event.id).update({ data: { prices } });
      data = { id: event.id, prices };
    } else {
      throw new Error('unknown action: ' + action);
    }
    return { code: 0, message: 'ok', data };
  } catch (err) {
    return { code: -1, message: String((err && err.message) || 'error'), data: null };
  }
};