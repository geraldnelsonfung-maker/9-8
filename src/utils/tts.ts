/**
 * 音频晨报 TTS 工具（F20）：整份晨报转语音播报，≤3 分钟。
 * - H5：Web Speech API（SpeechSynthesis），逐句合成避免长文本卡死
 * - 微信端：同声传译插件 textToSpeech（单次约 1024 字节上限，分块请求）→
 *   InnerAudioContext 顺序播放队列；插件未配置时 onError 降级提示
 * 全局单播放通道：再次 start 会先停掉上一次。
 */
import Taro from '@tarojs/taro';

const isWeapp = process.env.TARO_ENV === 'weapp';

/** 分块上限（字）：微信 TTS 单次约 1024 字节，中文 3 字节/字，110 字留足余量 */
const CHUNK_SIZE = 110;

export interface TtsCallbacks {
  onEnd?: () => void;
  onError?: (message: string) => void;
}

/** 按句切分（不依赖正则 lookbehind，兼容低版本 WebView） */
export function splitTtsChunks(text: string): string[] {
  const clean = text.replace(/\s*\n+\s*/g, '。').replace(/([。！？；])+/g, '$1');
  const sentences = clean.split(/([。！？；])/);
  const parts: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    const body = (sentences[i] || '').trim();
    const mark = sentences[i + 1] || '';
    if (body) parts.push(body + mark);
  }
  const chunks: string[] = [];
  let buf = '';
  for (const seg of parts) {
    if (buf && (buf + seg).length > CHUNK_SIZE) {
      chunks.push(buf);
      buf = seg;
    } else {
      buf += seg;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter(Boolean);
}

/* ---------------- 全局播放通道状态 ---------------- */

let activeStop: (() => void) | null = null;

/** 停止当前播报（幂等） */
export function stopSpeak() {
  if (activeStop) {
    const fn = activeStop;
    activeStop = null;
    fn();
  }
}

/** 是否正在播报 */
export function isSpeaking(): boolean {
  return activeStop !== null;
}

/* ---------------- H5：Web Speech API ---------------- */

function speakH5(chunks: string[], cb: TtsCallbacks) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    cb.onError?.('当前浏览器不支持语音合成');
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  let index = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    synth.cancel();
    activeStop = null;
  };
  const next = () => {
    if (stopped) return;
    if (index >= chunks.length) {
      activeStop = null;
      cb.onEnd?.();
      return;
    }
    const utter = new SpeechSynthesisUtterance(chunks[index++]);
    utter.lang = 'zh-CN';
    utter.rate = 1.05;
    utter.onend = next;
    utter.onerror = () => {
      if (!stopped) {
        stop();
        cb.onError?.('语音播报中断');
      }
    };
    synth.speak(utter);
  };
  activeStop = stop;
  next();
}

/* ---------------- 微信端：同声传译插件 TTS + 音频队列 ---------------- */

function speakWeapp(chunks: string[], cb: TtsCallbacks) {
  let plugin: any = null;
  try {
    plugin = Taro.requirePlugin('WechatSI');
  } catch (err) {
    console.warn('[tts] WechatSI plugin unavailable:', err);
  }
  if (!plugin || typeof plugin.textToSpeech !== 'function') {
    cb.onError?.('语音合成插件未配置，暂无法播报');
    return;
  }
  const queue = [...chunks];
  let audio: Taro.InnerAudioContext | null = null;
  let stopped = false;

  const stop = () => {
    stopped = true;
    if (audio) {
      try {
        audio.stop();
        audio.destroy();
      } catch (err) {
        /* 已销毁 */
      }
    }
    audio = null;
    activeStop = null;
  };

  const requestNext = () => {
    if (stopped) return;
    const chunk = queue.shift();
    if (chunk === undefined) {
      activeStop = null;
      cb.onEnd?.();
      stop();
      return;
    }
    plugin.textToSpeech({
      lang: 'zh_CN',
      tts: true,
      content: chunk,
      success: (res: { filename?: string }) => {
        if (stopped) return;
        if (!res || !res.filename) {
          stop();
          cb.onError?.('语音合成失败');
          return;
        }
        audio = Taro.createInnerAudioContext();
        audio.src = res.filename;
        audio.onEnded(() => {
          if (audio) {
            try {
              audio.destroy();
            } catch (err) {
              /* 已销毁 */
            }
            audio = null;
          }
          requestNext();
        });
        audio.onError(() => {
          if (!stopped) {
            stop();
            cb.onError?.('音频播放失败');
          }
        });
        audio.play();
      },
      fail: (err: unknown) => {
        console.warn('[tts] textToSpeech fail:', err);
        if (!stopped) {
          stop();
          cb.onError?.('语音合成失败');
        }
      }
    });
  };

  activeStop = stop;
  requestNext();
}

/** 开始播报：自动覆盖上一次未完成的播报 */
export function startSpeak(chunks: string[], cb: TtsCallbacks = {}) {
  stopSpeak();
  if (!chunks.length) {
    cb.onError?.('没有可播报的内容');
    return;
  }
  if (isWeapp) speakWeapp(chunks, cb);
  else speakH5(chunks, cb);
}
