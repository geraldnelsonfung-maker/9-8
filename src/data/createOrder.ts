import type { PayOrder } from '../types';

/** mock: createOrder —— 模拟创建订阅订单（开发环境不下真实支付） */
export default function createOrder(data?: { planId?: PayOrder['planId'] }): PayOrder {
  const planId = data?.planId || 'earlybird_monthly';
  const priceMap: Record<PayOrder['planId'], number> = {
    earlybird_monthly: 6.9,
    monthly: 9.9,
    yearly: 88
  };
  console.info('[mock:createOrder] plan:', planId);
  return {
    orderId: `mock-${Date.now()}`,
    planId,
    price: priceMap[planId],
    status: 'created'
  };
}
