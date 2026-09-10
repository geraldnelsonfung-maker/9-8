import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Input, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import EmptyState from '@/components/EmptyState';
import { brandVars, useThemeStore } from '@/store/theme';
import { useT } from '@/store/language';
import {
  apiShoppingList,
  apiShoppingAdd,
  apiShoppingToggleBought,
  apiShoppingRemove,
  apiShoppingAddPrice,
  type ShoppingItem
} from '@/services/api';
import styles from './index.module.scss';

function ShoppingPage() {
  const t = useT();
  const { theme } = useThemeStore();
  const [list, setList] = useState<ShoppingItem[]>([]);
  const [name, setName] = useState('');
  const [targetPrice, setTargetPrice] = useState('');

  // 真机走云函数（云端按 openid），H5 走本地 mock storage，保证两端读到的是同一份清单
  const load = useCallback(async () => {
    try {
      const data = await apiShoppingList();
      setList(data || []);
    } catch (err) {
      console.error('[ShoppingPage] load failed:', err);
    }
  }, []);

  // 加载清单：首次挂载 + 每次切回本页（useDidShow 首次也会触发）时刷新，
  // 保证 AI 往清单加过商品后回来能看到最新数据
  useDidShow(() => {
    load();
  });

  const addItem = async () => {
    const n = name.trim();
    if (!n) return;
    const p = Number(targetPrice.replace(/[^\d.]/g, ''));
    const added = await apiShoppingAdd({
      name: n,
      targetPrice: Number.isFinite(p) && p > 0 ? p : undefined
    });
    if (added) {
      setList((prev) => [added, ...prev]);
      setName('');
      setTargetPrice('');
      Taro.showToast({ title: '已加入购物清单', icon: 'success' });
    }
  };

  const toggleBought = async (id: string) => {
    const res = await apiShoppingToggleBought(id);
    if (res) {
      setList((prev) => prev.map((it) => (it.id === id ? { ...it, bought: res.bought } : it)));
    }
  };

  const removeItem = (id: string) => {
    Taro.showModal({
      title: '删除',
      content: '确定删除这件商品吗？',
      confirmColor: '#ee5a29',
      success: async (res) => {
        if (res.confirm) {
          const done = await apiShoppingRemove(id);
          if (done) setList((prev) => prev.filter((it) => it.id !== id));
        }
      }
    });
  };

  /** 记多平台价格（手动比价记录，对应 PRD F23 兜底形态） */
  const addPrice = (id: string) => {
    const item = list.find((it) => it.id === id);
    if (!item) return;
    Taro.showModal({
      title: `给「${item.name}」记价格`,
      editable: true,
      placeholderText: '例：京东 2599',
      success: async (res) => {
        if (!res.content) return;
        const m = res.content.match(/([\u4e00-\u9fa5A-Za-z]+)\s*([\d.,]+)/);
        if (!m) {
          Taro.showToast({ title: '格式：平台 价格', icon: 'none' });
          return;
        }
        const price = Number(m[2].replace(/,/g, ''));
        if (!Number.isFinite(price)) return;
        const done = await apiShoppingAddPrice(id, m[1], price);
        if (done) {
          setList((prev) => prev.map((it) => (it.id === id ? { ...it, prices: done.prices } : it)));
          Taro.showToast({ title: '已记录比价', icon: 'success' });
        }
      }
    });
  };

  const summary = useMemo(() => {
    const total = list.length;
    const bought = list.filter((it) => it.bought).length;
    return { total, bought };
  }, [list]);

  const bestPrice = (prices: { price: number }[]) =>
    prices.length ? `￥${Math.min(...prices.map((p) => p.price)).toLocaleString()}` : null;

  return (
    <View className={styles.page} style={brandVars(theme)}>
      <View className={styles.addBar}>
        <Input
          className={styles.nameInput}
          value={name}
          placeholder={t('shopping.addPlaceholder')}
          onInput={(e) => setName(e.detail.value)}
          confirmType='done'
          onConfirm={addItem}
        />
        <Input
          className={styles.priceInput}
          value={targetPrice}
          placeholder={t('shopping.targetPlaceholder')}
          type='digit'
          onInput={(e) => setTargetPrice(e.detail.value)}
        />
        <View className={styles.addBtn} onClick={addItem}>
          {t('shopping.add')}
        </View>
      </View>

      <View className={styles.summaryBar}>
        <Text className={styles.summaryText}>
          共 {summary.total} 件 · 已买 {summary.bought} 件
        </Text>
        <Text className={styles.summaryHint}>{t('shopping.summaryHint')}</Text>
      </View>

      <ScrollView scrollY className={styles.list}>
        {list.length === 0 ? (
          <EmptyState icon='🛒' title='购物清单还是空的' hint='在上方输入想买的东西，我帮你记着并跟进比价' />
        ) : (
          list.map((item) => {
            const cheapest = bestPrice(item.prices);
            return (
              <View key={item.id} className={styles.card}>
                <View className={styles.cardMain} onClick={() => addPrice(item.id)}>
                  <View className={styles.head}>
                    <Text className={item.bought ? styles.nameDone : styles.name}>{item.name}</Text>
                    {item.prices.length > 0 && cheapest ? (
                      <Text className={styles.cheapest}>最低 {cheapest}</Text>
                    ) : null}
                  </View>
                  {item.targetPrice ? (
                    <Text className={styles.target}>目标预算 · ￥{item.targetPrice.toLocaleString()}</Text>
                  ) : null}
                  {item.prices.length > 0 ? (
                    <View className={styles.priceRow}>
                      {item.prices.map((p, i) => (
                        <Text key={i} className={styles.priceTag}>
                          {p.platform} ￥{p.price}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  <Text className={styles.hint}>{t('shopping.hint')}</Text>
                </View>
                <View className={styles.actions}>
                  <View className={styles.actionBtn} onClick={() => toggleBought(item.id)}>
                    {item.bought ? t('shopping.unbought') : t('shopping.bought')}
                  </View>
                  <View className={styles.removeBtn} onClick={() => removeItem(item.id)}>
                    删
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

export default ShoppingPage;