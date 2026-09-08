import type { UserProfile } from '../types';

/** mock: updateSettings —— 模拟更新用户设置 */
export default function updateSettings(data?: Partial<Pick<UserProfile, 'nickname' | 'briefingTime' | 'preferences'>>): UserProfile {
  console.info('[mock:updateSettings]', data);
  return {
    openid: 'mock-openid-001',
    nickname: data?.nickname ?? '晨友',
    briefingTime: data?.briefingTime ?? '07:30',
    preferences: data?.preferences ?? ['科技', '效率工具'],
    subscribed: false,
    expiredAt: null,
    isEarlyBird: false
  };
}
