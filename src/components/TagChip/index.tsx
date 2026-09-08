import React from 'react';
import { Text } from '@tarojs/components';
import classnames from 'classnames';
import styles from './index.module.scss';

interface TagChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
}

/** 标签胶囊（收藏夹筛选 / 内容标签通用） */
export default function TagChip({ label, active = false, onClick }: TagChipProps) {
  return (
    <Text
      className={classnames(styles.chip, active && styles.active)}
      onClick={onClick}
    >
      {label}
    </Text>
  );
}
