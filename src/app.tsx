import React, { useEffect } from 'react';
import Taro from '@tarojs/taro';
import { useDidShow, useDidHide } from '@tarojs/taro';
// 全局样式
import './app.scss';

function App(props) {
  useEffect(() => {
    // 云开发初始化：仅微信小程序平台启用（H5/其他平台走 mock 数据）
    if (process.env.TARO_ENV === 'weapp') {
      if (Taro.cloud) {
        Taro.cloud.init({ env: '', traceUser: true });
        console.info('[App] cloud init done');
      } else {
        console.error('[App] Taro.cloud is unavailable, please check base library version');
      }
    }
  }, []);

  // 对应 onShow
  useDidShow(() => {});

  // 对应 onHide
  useDidHide(() => {});

  return props.children;
}

export default App;
