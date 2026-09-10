import { View, Text } from '@tarojs/components';
import styles from './index.module.scss';

interface EmptyStateProps {
  icon?: string;
  title: string;
  hint?: string;
}

/** 空状态占位组件 */
export default function EmptyState({ icon = '🌅', title, hint }: EmptyStateProps) {
  return (
    <View className={styles.container}>
      <Text className={styles.icon}>{icon}</Text>
      <Text className={styles.title}>{title}</Text>
      {hint ? <Text className={styles.hint}>{hint}</Text> : null}
    </View>
  );
}
