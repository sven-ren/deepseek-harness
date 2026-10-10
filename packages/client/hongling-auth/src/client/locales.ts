/**
 * `hongling.auth` dictionary: the account settings section and the login
 * overlay share one namespace because they render the same panel body.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/client/locales
 */

/** Locale namespace of the account section and the login overlay copy. */
export const AUTH_NS = 'hongling.auth'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '账号',
  'title': '企业 SSO 登录',
  'close': '关闭',
  'status.loggedIn': '已登录',
  'status.loggedOut': '未登录',
  'action.login': '使用企业 SSO 登录',
  'action.logout': '退出登录',
  'action.cancel': '取消',
  'action.retry': '重试',
  'action.copy': '复制链接',
  'action.copied': '已复制',
  'phase.waiting_browser': '已打开系统浏览器，请在浏览器中完成企业认证…',
  'phase.receiving': '浏览器已回跳，正在接收登录结果…',
  'phase.verifying': '正在校验登录凭证…',
  'phase.done': '登录成功',
  'phase.error': '登录失败',
  'hint.manual': '浏览器未自动打开？复制以下链接到任意浏览器打开：',
  'hint.expiry': '凭证过期时间',
  'hint.roles': '角色',
  'error.unavailable': 'Host 通道不可用',
} satisfies Record<string, string>

/** The `hongling.auth` namespace key union. */
export type AuthKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'nav': 'Account',
  'title': 'Enterprise SSO',
  'close': 'Close',
  'status.loggedIn': 'Signed in',
  'status.loggedOut': 'Signed out',
  'action.login': 'Sign in with SSO',
  'action.logout': 'Sign out',
  'action.cancel': 'Cancel',
  'action.retry': 'Retry',
  'action.copy': 'Copy link',
  'action.copied': 'Copied',
  'phase.waiting_browser': 'Browser opened. Finish authentication there…',
  'phase.receiving': 'Receiving sign-in result…',
  'phase.verifying': 'Verifying credentials…',
  'phase.done': 'Signed in',
  'phase.error': 'Sign-in failed',
  'hint.manual': 'Browser didn\'t open? Copy this link into any browser:',
  'hint.expiry': 'Token expires at',
  'hint.roles': 'Roles',
  'error.unavailable': 'Host channel unavailable',
} satisfies Record<AuthKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Account section and login overlay copy. */
    'hongling.auth': AuthKey
  }
}
