// 引入组件多语言
import messages from './messages.json'
// antd
import antdLocale from 'antd/es/locale/en_US'

const appLocale = {
  // 合并所有 messages, 加入组件的 messages
  messages: Object.assign({}, messages),
  // locale
  locale: 'en-US',
  antdLocale
}

export default appLocale
