export default defineAppConfig({
  plugins: {
    // 微信同声传译（语音转写 ASR，F05）：需在小程序后台「设置-第三方设置-插件管理」
    // 添加该插件后生效；version 以后台插件管理页显示的最新稳定版为准。
    // H5 构建忽略 plugins 字段，仅 weapp 生效。
    WechatSI: {
      version: '0.3.5',
      provider: 'wx069ba97219f66d99'
    }
  },
  pages: [
    'pages/briefing/index',
    'pages/inbox/index',
    'pages/library/index',
    'pages/calendar/index',
    'pages/mine/index',
    'pages/search/index',
    'pages/history/index',
    'pages/shopping/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#FFF3EC',
    navigationBarTitleText: '私人晨报助理',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    color: '#999999',
    selectedColor: '#FF7A45',
    backgroundColor: '#FFFFFF',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/briefing/index',
        text: '晨报',
        iconPath: 'assets/tabbar/briefing.svg',
        selectedIconPath: 'assets/tabbar/briefing-selected.svg'
      },
      {
        pagePath: 'pages/inbox/index',
        text: '收件箱',
        iconPath: 'assets/tabbar/inbox.svg',
        selectedIconPath: 'assets/tabbar/inbox-selected.svg'
      },
      {
        pagePath: 'pages/library/index',
        text: '热点',
        iconPath: 'assets/tabbar/library.svg',
        selectedIconPath: 'assets/tabbar/library-selected.svg'
      },
      {
        pagePath: 'pages/calendar/index',
        text: '日历',
        iconPath: 'assets/tabbar/calendar.svg',
        selectedIconPath: 'assets/tabbar/calendar-selected.svg'
      },
      {
        pagePath: 'pages/mine/index',
        text: '我的',
        iconPath: 'assets/tabbar/mine.svg',
        selectedIconPath: 'assets/tabbar/mine-selected.svg'
      }
    ]
  }
})
