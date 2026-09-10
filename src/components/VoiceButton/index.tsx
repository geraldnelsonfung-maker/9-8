import { useEffect, useRef, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import classnames from 'classnames';
import styles from './index.module.scss';

const isWeapp = process.env.TARO_ENV === 'weapp';

export interface VoiceResult {
  /** 录音时长（秒） */
  duration: number;
  /** 录音临时文件路径（仅微信端降级路径） */
  tempFilePath?: string;
  /** ASR 转写文本：微信端走同声传译插件时返回；插件未配置的降级路径与 H5 mock 无此字段 */
  transcript?: string;
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
 * 微信端优先用「微信同声传译」插件边录边识别（transcript 直接可用）；
 * 插件未添加/加载失败时降级为 RecorderManager 纯录音（上层据此提示未配置）；
 * 其他平台（H5 预览）模拟录音时长，由上层走 mock 转写。
 */
export default function VoiceButton({ disabled = false, compact = false, onResult }: VoiceButtonProps) {
  const [recording, setRecording] = useState(false);
  const [cancelMode, setCancelMode] = useState(false);
  const startAtRef = useRef<number>(0);
  const recorderRef = useRef<Taro.RecorderManager | null>(null);
  // 同声传译插件识别 manager（weapp；null = 插件不可用，走纯录音降级）
  const pluginRef = useRef<any>(null);
  // 组件卸载标记：抑制卸载后异步回调里的 toast 与 onResult
  const unmountedRef = useRef(false);
  // 通过插件 stop 时是否丢弃结果（滑动取消）
  const discardRef = useRef(false);
  // onStop 回调里读取最新 cancelMode，用 ref 保存
  const cancelModeRef = useRef(false);
  // onResult 用 ref 转发：避免插件事件注册一次后捕获到过期闭包（额度/状态读取错误）
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    cancelModeRef.current = cancelMode;
  }, [cancelMode]);

  /** 降级路径：纯录音（无转写），上层收到无 transcript 的结果 */
  const initFallbackRecorder = () => {
    try {
      const recorder = Taro.getRecorderManager();
      recorder.onStop((res) => {
        const duration = Math.round((Date.now() - startAtRef.current) / 1000);
        if (unmountedRef.current) return;
        if (res && res.tempFilePath && !cancelModeRef.current && duration >= 1) {
          onResultRef.current({ duration, tempFilePath: res.tempFilePath, confirmed: true });
        } else if (!cancelModeRef.current) {
          console.warn('[VoiceButton] recording too short:', duration);
          Taro.showToast({ title: '说话时间太短', icon: 'none' });
        }
      });
      recorder.onError((err) => {
        console.error('[VoiceButton] recorder error:', err);
        if (!unmountedRef.current) {
          Taro.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' });
        }
      });
      recorderRef.current = recorder;
    } catch (err) {
      console.error('[VoiceButton] init recorder failed:', err);
    }
  };

  useEffect(() => {
    if (!isWeapp) return;
    unmountedRef.current = false;
    // 优先探测同声传译插件（需在小程序后台添加「微信同声传译」后生效）
    try {
      const manager = Taro.requirePlugin('WechatSI').getRecordRecognitionManager();
      pluginRef.current = manager;
      manager.onRecognize((res: any) => {
        // 中间识别结果：仅留调试日志，不驱动 UI
        if (res && res.result) console.debug('[VoiceButton] recognize:', res.result);
      });
      manager.onStop((res: any) => {
        const duration = Math.round((Date.now() - startAtRef.current) / 1000);
        if (unmountedRef.current || cancelModeRef.current || discardRef.current) return;
        const transcript = String((res && (res.transcript || res.result)) || '').trim();
        if (!transcript) {
          Taro.showToast({ title: '没听清，再试一次', icon: 'none' });
          return;
        }
        if (duration < 1) {
          Taro.showToast({ title: '说话时间太短', icon: 'none' });
          return;
        }
        onResultRef.current({ duration, transcript, confirmed: true });
      });
      manager.onError((err: any) => {
        console.error('[VoiceButton] recognize error:', err);
        if (!unmountedRef.current && !cancelModeRef.current) {
          Taro.showToast({ title: '语音识别失败，请重试', icon: 'none' });
          setRecording(false);
        }
      });
    } catch (err) {
      console.warn('[VoiceButton] WechatSI plugin unavailable, fallback to recorder:', err);
      pluginRef.current = null;
      initFallbackRecorder();
    }
    return () => {
      unmountedRef.current = true;
      // 卸载时停掉未完成的录音/识别，避免跨页面泄漏
      try {
        pluginRef.current && pluginRef.current.stop();
      } catch (e) {
        /* ignore */
      }
      try {
        recorderRef.current && recorderRef.current.stop();
      } catch (e) {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTouchStart = () => {
    if (disabled || recording) return;
    setRecording(true);
    setCancelMode(false);
    discardRef.current = false;
    startAtRef.current = Date.now();
    if (!isWeapp) return;
    if (pluginRef.current) {
      pluginRef.current.start({ lang: 'zh_CN', duration: 60000 });
    } else if (recorderRef.current) {
      recorderRef.current.start({ duration: 60000, format: 'mp3' });
    }
  };

  const handleTouchMove = () => {
    if (recording) setCancelMode(true);
  };

  const handleTouchEnd = () => {
    if (!recording) return;
    setRecording(false);
    if (!isWeapp) {
      if (cancelMode) {
        setCancelMode(false);
        return;
      }
      // 非微信端：模拟正常完成（转写由上层 mock）
      const duration = Math.round((Date.now() - startAtRef.current) / 1000);
      onResultRef.current({ duration: Math.max(duration, 2), confirmed: true });
      return;
    }
    if (pluginRef.current) {
      // 插件路径：结果统一在 onStop 回调处理；取消时丢弃
      discardRef.current = cancelMode;
      pluginRef.current.stop();
      return;
    }
    if (recorderRef.current) {
      // 降级路径：onStop 回调里统一处理结果
      recorderRef.current.stop();
    }
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
