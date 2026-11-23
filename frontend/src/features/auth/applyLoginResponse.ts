import { useAuthStore } from '@/shared/auth/store';
import type { LoginResponse } from '@/shared/types/common';

/**
 * 应用登录/SSO 响应：需要邮箱验证时只保存 15 分钟受限凭证，
 * 返回 true 表示调用方应跳转受限验证页；否则写入普通会话。
 */
export function applyLoginResponse(resp: LoginResponse): boolean {
  const store = useAuthStore.getState();
  if (resp.sessionPurpose === 'EMAIL_VERIFICATION') {
    // 进入受限模式前丢弃旧会话令牌，避免旧 access/refresh 继续参与请求。
    store.clearSession();
    store.setRestrictedToken(resp.restrictedToken ?? null);
    store.setUser(resp.user);
    return true;
  }
  store.setTokens(resp.accessToken, resp.refreshToken);
  store.setUser(resp.user);
  return false;
}
