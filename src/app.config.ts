export default defineAppConfig({
  pages: [
    'pages/briefing/index',
    'pages/inbox/index',
    'pages/library/index',
    'pages/mine/index',
    'pages/search/index'
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
        text: '收藏',
        iconPath: 'assets/tabbar/library.svg',
        selectedIconPath: 'assets/tabbar/library-selected.svg'
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
