import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Input, Picker, Button, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import classnames from 'classnames';
import { useUserStore } from '@/store/user';
import { brandVars, useThemeStore, THEME_PRESETS } from '@/store/theme';
import { apiCreateOrder } from '@/services/api';
import type { PayOrder } from '@/types';
import styles from './index.module.scss';

const PLAN_LIST: Array<{ id: PayOrder['planId']; label: string }> = [
  { id: 'earlybird_monthly', label: '早鸟月付' },
  { id: 'monthly', label: '月付' },
  { id: 'yearly', label: '年付' }
];

const isWeapp = process.env.TARO_ENV === 'weapp';
const AVATAR_KEY = 'user-avatar';
/** H5 预览端可选的预设头像 */
const AVATAR_PRESETS = ['🌅', '🌞', '🌱', '🐳', '🦊', '🐼'];
/** TODO：上线前在小程序后台绑定企业微信客服后替换 */
const SERVICE_CORP_ID = 'TODO_CORP_ID';

function MinePage() {
  const { profile, usage, init, saveSettings } = useUserStore();
  const { theme, setTheme } = useThemeStore();
  const [nickname, setNickname] = useState('');
  const [planId, setPlanId] = useState<PayOrder['planId']>('earlybird_monthly');
  const [paying, setPaying] = useState(false);
  const [avatar, setAvatar] = useState('');

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    if (profile) setNickname(profile.nickname);
  }, [profile]);

  // 恢复本地头像（微信端为本地/临时图片路径，H5 端为 emoji）
  useEffect(() => {
    try {
      const saved = Taro.getStorageSync(AVATAR_KEY) as string;
      if (saved) setAvatar(saved);
    } catch (err) {
      console.warn('[MinePage] restore avatar failed:', err);
    }
  }, []);

  const handleChangeAvatar = () => {
    if (isWeapp) {
      Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
        success: (res) => {
          const path = res.tempFiles?.[0]?.tempFilePath;
          if (!path) return;
          // TODO：正式版将图片上传到云存储（Taro.cloud.uploadFile）后使用 fileID
          setAvatar(path);
          Taro.setStorageSync(AVATAR_KEY, path);
          Taro.showToast({ title: '头像已更新', icon: 'success' });
        },
        fail: (err) => console.info('[MinePage] chooseMedia cancelled:', err && err.errMsg)
      });
    } else {
      Taro.showActionSheet({ itemList: AVATAR_PRESETS })
        .then((res) => {
          const next = AVATAR_PRESETS[res.tapIndex];
          if (!next) return;
          setAvatar(next);
          Taro.setStorageSync(AVATAR_KEY, next);
          Taro.showToast({ title: '头像已更新', icon: 'success' });
        })
        .catch(() => {});
    }
  };

  const handleContactService = () => {
    const fallback = () => {
      Taro.showModal({
        title: '联系客服',
        content: '工作时间 9:00-21:00\n微信搜索公众号「私人晨报助理」留言\n或发邮件至 support@morningbrief.cn',
        confirmText: '知道了',
        showCancel: false
      });
    };
    if (isWeapp) {
      // openCustomerServiceChat 需要企业微信客服绑定（TODO_CORP_ID 上线前替换）
      const openChat = (Taro as unknown as { openCustomerServiceChat?: (opt: Record<string, unknown>) => void })
        .openCustomerServiceChat;
      if (typeof openChat === 'function') {
        try {
          openChat({ corpId: SERVICE_CORP_ID, extInfo: { url: '' }, fail: fallback });
        } catch (err) {
          console.warn('[MinePage] openCustomerServiceChat failed:', err);
          fallback();
        }
      } else {
        fallback();
      }
    } else {
      fallback();
    }
  };

  const isEmojiAvatar = (val: string) => val.length <= 4;

  const voicePercent = useMemo(() => {
    if (!usage) return 0;
    if (usage.voiceQuota < 0) return 0;
    return Math.min(100, Math.round((usage.voiceUsed / usage.voiceQuota) * 100));
  }, [usage]);

  const collectionPercent = useMemo(() => {
    if (!usage) return 0;
    if (usage.collectionQuota < 0) return 0;
    return Math.min(100, Math.round((usage.collectionCount / usage.collectionQuota) * 100));
  }, [usage]);

  const handleChangeTime = (e) => {
    const value = e.detail.value as string;
    saveSettings({ briefingTime: value });
  };

  const handleBlurNickname = () => {
    const name = nickname.trim();
    if (!profile || !name || name === profile.nickname) return;
    saveSettings({ nickname: name });
  };

  const handleSubscribe = async () => {
    if (paying) return;
    setPaying(true);
    try {
      const order = await apiCreateOrder(planId);
      console.info('[MinePage] order created:', order.orderId);
      // TODO：微信支付需要主体资质与商户号，接入后替换为 Taro.requestPayment(order.payment)
      Taro.showModal({
        title: '开发环境提示',
        content: `已创建模拟订单：${PLAN_LIST.find((p) => p.id === planId)?.label} ¥${order.price}。微信支付将在主体资质就绪后接入。`,
        showCancel: false
      });
    } catch (err) {
      console.error('[MinePage] createOrder failed:', err);
      Taro.showToast({ title: '下单失败，请稍后再试', icon: 'none' });
    } finally {
      setPaying(false);
    }
  };

  return (
    <View className={styles.page} style={brandVars(theme)}>
      <View className={styles.userCard}>
        <Button className={styles.avatarBtn} onClick={handleChangeAvatar}>
          <View className={styles.avatar}>
            {avatar ? (
              isEmojiAvatar(avatar) ? (
                <Text className={styles.avatarText}>{avatar}</Text>
              ) : (
                <Image className={styles.avatarImg} src={avatar} mode='aspectFill' />
              )
            ) : (
              <Text className={styles.avatarText}>🌅</Text>
            )}
          </View>
          <Text className={styles.avatarEdit}>改头像</Text>
        </Button>
        <View className={styles.userBody}>
          <Text className={styles.nickname}>{profile?.nickname || '晨友'}</Text>
          <Text className={styles.userMeta}>
            {profile?.subscribed && profile?.expiredAt
              ? `订阅至 ${profile.expiredAt.slice(0, 10)}`
              : '免费版用户'}
          </Text>
        </View>
        {profile?.subscribed ? (
          <View className={styles.subBadge}>
            <Text className={styles.subBadgeText}>
              {profile.isEarlyBird ? '早鸟会员' : '订阅会员'}
            </Text>
          </View>
        ) : null}
      </View>

      <View className={styles.subCard}>
        <Text className={styles.subTitle}>订阅私人晨报助理</Text>
        <Text className={styles.subDesc}>
          语音晨报不限次畅聊 · 收藏无限量 · 习惯记忆主动调整晨报 · 新功能优先体验
        </Text>
        <View className={styles.subActions}>
          <Picker
            mode='selector'
            range={PLAN_LIST.map((p) => p.label)}
            value={PLAN_LIST.findIndex((p) => p.id === planId)}
            onChange={(e) => setPlanId(PLAN_LIST[Number(e.detail.value)].id)}
          >
            <View className={styles.priceTag}>
              <Text>
                <Text className={styles.price}>¥6.9</Text>
                <Text className={styles.priceNote}>
                  /月 起 · 前 500 名锁价（当前：{PLAN_LIST.find((p) => p.id === planId)?.label}）
                </Text>
              </Text>
            </View>
          </Picker>
          <Button className={styles.subButton} onClick={handleSubscribe}>
            {paying ? '下单中…' : '立即订阅'}
          </Button>
        </View>
      </View>

      <View className={styles.quotaCard}>
        <Text className={styles.quotaTitle}>本月额度</Text>
        <View className={styles.quotaRow}>
          <View className={styles.quotaHead}>
            <Text className={styles.quotaLabel}>🎙 语音对话</Text>
            <Text className={styles.quotaValue}>
              {usage ? (usage.voiceQuota < 0 ? '不限量' : `${usage.voiceUsed}/${usage.voiceQuota} 条`) : '…'}
            </Text>
          </View>
          <View className={styles.bar}>
            <View
              className={voicePercent >= 90 ? styles.barFillWarning : styles.barFill}
              style={{ width: `${voicePercent}%` }}
            />
          </View>
        </View>
        <View className={styles.quotaRow}>
          <View className={styles.quotaHead}>
            <Text className={styles.quotaLabel}>🔖 收藏空间</Text>
            <Text className={styles.quotaValue}>
              {usage
                ? usage.collectionQuota < 0
                  ? '不限量'
                  : `${usage.collectionCount}/${usage.collectionQuota} 条`
                : '…'}
            </Text>
          </View>
          <View className={styles.bar}>
            <View
              className={collectionPercent >= 90 ? styles.barFillWarning : styles.barFill}
              style={{ width: `${collectionPercent}%` }}
            />
          </View>
        </View>
      </View>

      <View className={styles.settingCard}>
        <View className={styles.settingRow}>
          <Text className={styles.settingLabel}>称呼</Text>
          <Input
            className={styles.settingInput}
            value={nickname}
            maxlength={12}
            onInput={(e) => setNickname(e.detail.value)}
            onBlur={handleBlurNickname}
          />
        </View>
        <Picker mode='time' value={profile?.briefingTime || '07:30'} onChange={handleChangeTime}>
          <View className={styles.settingRow}>
            <Text className={styles.settingLabel}>晨报推送时间</Text>
            <View className={styles.settingValue}>
              <Text>{profile?.briefingTime || '07:30'}</Text>
              <Text className={styles.arrow}>›</Text>
            </View>
          </View>
        </Picker>
      </View>

      <View className={styles.settingCard}>
        <View className={styles.settingRow}>
          <Text className={styles.settingLabel}>界面颜色</Text>
          <View className={styles.swatchList}>
            {THEME_PRESETS.map((t) => (
              <View
                key={t.id}
                className={classnames(styles.swatch, theme.id === t.id && styles.swatchActive)}
                style={{ background: t.color }}
                onClick={() => setTheme(t.id)}
              >
                {theme.id === t.id ? <Text className={styles.swatchCheck}>✓</Text> : null}
              </View>
            ))}
          </View>
        </View>
        <View className={styles.settingRow} onClick={handleContactService}>
          <Text className={styles.settingLabel}>联系客服</Text>
          <View className={styles.settingValue}>
            <Text>在线反馈与帮助</Text>
            <Text className={styles.arrow}>›</Text>
          </View>
        </View>
      </View>

      <View className={styles.privacyCard}>
        <Text className={styles.privacyText}>
          隐私说明：转发的内容仅用于生成你的日程、待办与摘要，存储于境内服务器；上线后将提供完整《小程序隐私保护指引》与一键删除全部数据入口。
        </Text>
      </View>
    </View>
  );
}

export default MinePage;
