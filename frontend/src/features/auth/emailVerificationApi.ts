import { apiClient } from '@/shared/api/client';
import type { LoginResponse } from '@/shared/types/common';

export type EmailVerificationPurpose = 'REGISTER' | 'PROFILE_EMAIL' | 'RESTRICTED';

export interface EmailVerificationPolicy {
  verificationEnabled: boolean;
  suffixRestrictionEnabled: boolean;
  allowedSuffixes: string[];
  codeLength: number;
  codeTtlSeconds: number;
  resendIntervalSeconds: number;
  maxAttempts: number;
}

export interface SendCodeResult {
  challengeId: string;
  resendAt: string;
  expiresAt: string;
}

export interface VerifyCodeResult {
  proof?: string | null;
  session?: LoginResponse | null;
}

export const EMAIL_VERIFICATION_POLICY_QUERY_KEY = ['email-verification-policy'] as const;

export async function fetchEmailVerificationPolicy(): Promise<EmailVerificationPolicy> {
  const resp = await apiClient.get<EmailVerificationPolicy>('/api/auth/email-verification/policy');
  return resp.data;
}

/** 受限验证页必须显式携带受限凭证；普通流程沿用当前登录会话。 */
function authConfig(authToken?: string | null) {
  return authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined;
}

export async function sendEmailCode(
  params: { purpose: EmailVerificationPurpose; email: string },
  authToken?: string | null,
): Promise<SendCodeResult> {
  const resp = await apiClient.post<SendCodeResult>(
    '/api/auth/email-verification/codes', params, authConfig(authToken));
  return resp.data;
}

export async function verifyEmailCode(
  params: { purpose: EmailVerificationPurpose; email: string; challengeId: string; code: string },
  authToken?: string | null,
): Promise<VerifyCodeResult> {
  const resp = await apiClient.post<VerifyCodeResult>(
    '/api/auth/email-verification/verify', params, authConfig(authToken));
  return resp.data;
}

export async function signOutRestricted(authToken: string): Promise<void> {
  await apiClient.post('/api/auth/email-verification/sign-out', {}, authConfig(authToken));
}
