import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import TagChip from '@/components/TagChip';
import EmptyState from '@/components/EmptyState';
import { apiGetLibrary } from '@/services/api';
import { useUserStore } from '@/store/user';
import { fromNow } from '@/utils/date';
import type { CollectionItem } from '@/types';
import styles from './index.module.scss';

const TYPE_ICONS: Record<CollectionItem['sourceType'], string> = {
  article: '📄',
  message: '💬',
  link: '🔗'
};

function LibraryPage() {
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [activeTag, setActiveTag] = useState('全部');
  const [loading, setLoading] = useState(true);
  const { refreshUsage } = useUserStore();

  useEffect(() => {
    apiGetLibrary()
      .then((data) => {
        setItems(data);
        refreshUsage();
      })
      .catch((err) => {
        console.error('[LibraryPage] load failed:', err);
        Taro.showToast({ title: '收藏加载失败', icon: 'none' });
      })
      .finally(() => setLoading(false));
  }, []);

  const tags = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => item.tags.forEach((t) => set.add(t)));
    return ['全部', ...Array.from(set)];
  }, [items]);

  const filtered = useMemo(
    () => (activeTag === '全部' ? items : items.filter((item) => item.tags.includes(activeTag))),
    [items, activeTag]
  );

  const handleCopy = (item: CollectionItem) => {
    Taro.setClipboardData({
      data: `${item.title}\n${item.summary}`,
      success: () => Taro.showToast({ title: '摘要已复制', icon: 'success' })
    }).catch((err) => console.error('[LibraryPage] copy failed:', err));
  };

  return (
    <View className={styles.page}>
      <View className={styles.filterBar}>
        <ScrollView scrollX className={styles.chipScroll}>
          {tags.map((tag) => (
            <TagChip key={tag} label={tag} active={tag === activeTag} onClick={() => setActiveTag(tag)} />
          ))}
        </ScrollView>
      </View>

      <View className={styles.list}>
        {filtered.map((item) => (
          <View key={item.id} className={styles.card} onClick={() => handleCopy(item)}>
            <View className={styles.cardHeader}>
              <Text className={styles.typeIcon}>{TYPE_ICONS[item.sourceType]}</Text>
              <Text className={styles.title}>{item.title}</Text>
              <Text className={styles.time}>{fromNow(item.createTime)}</Text>
            </View>
            <Text className={styles.summary}>{item.summary}</Text>
            <View className={styles.tagRow}>
              {item.tags.map((t) => (
                <TagChip key={t} label={t} />
              ))}
            </View>
          </View>
        ))}
      </View>

      {!loading && filtered.length === 0 ? (
        <EmptyState
          icon='🔖'
          title={activeTag === '全部' ? '还没有收藏' : '这个标签下还没有内容'}
          hint='在收件箱粘贴内容时勾选「收藏」，AI 摘要会存到这里'
        />
      ) : null}
    </View>
  );
}

export default LibraryPage;
