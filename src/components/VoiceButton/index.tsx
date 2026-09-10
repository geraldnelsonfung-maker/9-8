import React, { useEffect, useRef, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import classnames from 'classnames';
import styles from './index.module.scss';

const isWeapp = process.env.TARO_ENV === 'weapp';

export interface VoiceResult {
  /** 录音时长（秒） */
  duration: number;
  /** 录音临时文件路径（仅微信端） */
  tempFilePath?: string;
  /** 用户是否正常松开（false = 滑动取消） */
  confirmed: boolean;
}

interface VoiceButtonProps {
  disabled?: boolean;
  /** 紧凑模式：仅图标方块，用于嵌入单行输入栏 */
  compact?: boolean;
  onResult: (result: VoiceResult) => void;
}

/**
 * 按住说话按钮
 * 微信端使用 RecorderManager 录音，松开后回调录音文件与时长；
 * 其他平台（H5 预览）模拟录音时长，由上层走 mock 对话。
 */
export default function VoiceButton({ disabled = false, compact = false, onResult }: VoiceButtonProps) {
  const [recording, setRecording] = useState(false);
  const [cancelMode, setCancelMode] = useState(false);
  const startAtRef = useRef<number>(0);
  const recorderRef = useRef<Taro.RecorderManager | null>(null);
  // onStop 回调里读取最新 cancelMode，用 ref 保存
  const cancelModeRef = useRef(false);
  useEffect(() => {
    cancelModeRef.current = cancelMode;
  }, [cancelMode]);

  useEffect(() => {
    if (!isWeapp) return;
    try {
      const recorder = Taro.getRecorderManager();
      recorder.onStop((res) => {
        const duration = Math.round((Date.now() - startAtRef.current) / 1000);
        if (res && res.tempFilePath && !cancelModeRef.current && duration >= 1) {
          onResult({ duration, tempFilePath: res.tempFilePath, confirmed: true });
        } else if (!cancelModeRef.current) {
          console.warn('[VoiceButton] recording too short:', duration);
          Taro.showToast({ title: '说话时间太短', icon: 'none' });
        }
      });
      recorder.onError((err) => {
        console.error('[VoiceButton] recorder error:', err);
        Taro.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' });
      });
      recorderRef.current = recorder;
    } catch (err) {
      console.error('[VoiceButton] init recorder failed:', err);
    }
  }, []);

  const handleTouchStart = () => {
    if (disabled || recording) return;
    setRecording(true);
    setCancelMode(false);
    startAtRef.current = Date.now();
    if (isWeapp && recorderRef.current) {
      recorderRef.current.start({ duration: 60000, format: 'mp3' });
    }
  };

  const handleTouchMove = () => {
    if (recording) setCancelMode(true);
  };

  const handleTouchEnd = () => {
    if (!recording) return;
    setRecording(false);
    const duration = Math.round((Date.now() - startAtRef.current) / 1000);
    if (isWeapp && recorderRef.current) {
      // onStop 回调里统一处理结果
      recorderRef.current.stop();
      return;
    }
    if (cancelMode) {
      setCancelMode(false);
      return;
    }
    // 非微信端：模拟正常完成
    onResult({ duration: Math.max(duration, 2), confirmed: true });
  };

  return (
    <View className={classnames(styles.wrapper, compact && styles.compact)}>
      {recording ? (
        <View className={styles.overlay}>
          <View className={classnames(styles.wave, cancelMode && styles.waveCancel)} />
          <Text className={styles.overlayText}>{cancelMode ? '松开取消' : '正在聆听…'}</Text>
        </View>
      ) : null}
      <View
        className={classnames(
          styles.button,
          compact && styles.compact,
          recording && styles.recording,
          disabled && styles.disabled
        )}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <Text className={styles.mic}>🎙</Text>
        {!compact ? <Text className={styles.label}>按住说话</Text> : null}
      </View>
    </View>
  );
}
