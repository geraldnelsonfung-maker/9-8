import { create } from 'zustand';
import Taro from '@tarojs/taro';
import { apiLogin, apiGetUsage, apiUpdateSettings } from '../services/api';
import type { UserProfile, Usage } from '../types';

interface UserState {
  profile: UserProfile | null;
  usage: Usage | null;
  loading: boolean;
  init: () => Promise<void>;
  refreshUsage: () => Promise<void>;
  saveSettings: (payload: Partial<Pick<UserProfile, 'nickname' | 'briefingTime' | 'preferences'>>) => Promise<void>;
}

export const useUserStore = create<UserState>((set, get) => ({
  profile: null,
  usage: null,
  loading: false,

  init: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const [profile, usage] = await Promise.all([apiLogin(), apiGetUsage()]);
      set({ profile, usage });
      console.info('[UserStore] init done', { nickname: profile.nickname });
    } catch (err) {
      console.error('[UserStore] init failed:', err);
      Taro.showToast({ title: '初始化失败，请下拉重试', icon: 'none' });
    } finally {
      set({ loading: false });
    }
  },

  refreshUsage: async () => {
    try {
      const usage = await apiGetUsage();
      set({ usage });
    } catch (err) {
      console.error('[UserStore] refreshUsage failed:', err);
    }
  },

  saveSettings: async (payload) => {
    try {
      const profile = await apiUpdateSettings(payload);
      set({ profile });
      Taro.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      console.error('[UserStore] saveSettings failed:', err);
      Taro.showToast({ title: '保存失败', icon: 'none' });
    }
  }
}));
