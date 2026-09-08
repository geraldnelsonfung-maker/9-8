import type { UserProfile } from '../types';

/** mock: login —— 返回默认用户档案 */
export default function login(): UserProfile {
  return {
    openid: 'mock-openid-001',
    nickname: '晨友',
    briefingTime: '07:30',
    preferences: ['科技', '效率工具'],
    subscribed: false,
    expiredAt: null,
    isEarlyBird: false
  };
}
