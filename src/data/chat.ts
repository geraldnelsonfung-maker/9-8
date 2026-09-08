/** mock: chat —— 模拟语音/文字对话意图处理（deep=true 时为深度思考伙伴模式） */
export default function chat(data?: { message?: string; action?: string; deep?: boolean }) {
  const msg = (data?.message || '').trim();
  console.info('[mock:chat] message:', msg, 'deep:', data?.deep);

  if (data?.deep) {
    return {
      reply: [
        `🧠 我们把「${msg.slice(0, 20)}」拆开看：`,
        '1. 目标：你最想先解决的是什么？把它说成一句可执行的话；',
        '2. 约束：时间、精力、依赖的人，哪一个卡得最紧？',
        '3. 下一步：挑一个今天 30 分钟内能完成的最小动作，我先帮你排进待办。',
        '告诉我你的答案，我陪你把思路收敛成计划。'
      ].join('\n'),
      action: 'chat'
    };
  }

  let reply = '好的，已收到你的指令。';
  if (/改|挪|推迟/.test(msg)) reply = '已把「产品评审会」改期到明天 14:00，并在晨报中更新。';
  else if (/完成|办完|搞定了/.test(msg)) reply = '太棒了，「回复客户邮件」已标记完成。';
  else if (/今天|日程|安排/.test(msg)) reply = '你今天有 1 个日程：10:00 产品评审会（3 号会议室）；2 个待办，最早 9:00 前更新演示文稿。';
  else if (/取消|算了/.test(msg)) reply = '已取消该操作。';
  return { reply, action: 'none' };
}
