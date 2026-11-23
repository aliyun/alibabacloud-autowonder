import { apiClient } from '@/shared/api/client';

export interface MailSettings {
  host?: string | null;
  port?: number | null;
  security?: string | null;
  fromAddress?: string | null;
  fromName?: string | null;
  authMode?: string | null;
  username?: string | null;
  secretConfigured: boolean;
  activeConfigured: boolean;
  draftVersion: number;
  activeVersion: number;
  tested: boolean;
  testSuccess: boolean;
  testedAt?: string | null;
  testResult?: string | null;
  activeTested: boolean;
}

export interface SaveMailSettingsPayload {
  host: string;
  port: number;
  security: string;
  fromAddress: string;
  fromName?: string;
  authMode: string;
  username?: string;
  password?: string;
  expectedVersion: number;
}

export interface TestMailPayload extends SaveMailSettingsPayload {
  recipient: string;
}

export interface MailTestResult {
  success: boolean;
  failureCode?: string | null;
  fingerprint?: string | null;
  testedAt?: string | null;
  settings: MailSettings;
}

export interface PlatformEmailVerificationPolicy {
  verificationEnabled: boolean;
  forceExistingEnabled: boolean;
  suffixRestrictionEnabled: boolean;
  allowedSuffixes: string[];
  verificationEnabledAt?: string | null;
  version: number;
  mailSettingsTested: boolean;
}

export interface UpdateEmailVerificationPolicyPayload {
  verificationEnabled?: boolean;
  forceExistingEnabled?: boolean;
  suffixRestrictionEnabled?: boolean;
  allowedSuffixes?: string[];
  confirmDisableVerification?: boolean;
  expectedVersion: number;
}

export const MAIL_SETTINGS_QUERY_KEY = ['platform-mail-settings'] as const;
export const PLATFORM_EMAIL_POLICY_QUERY_KEY = ['platform-email-verification-policy'] as const;

export async function fetchMailSettings(): Promise<MailSettings> {
  const resp = await apiClient.get<MailSettings>('/api/platform/mail-settings');
  return resp.data;
}

export async function saveMailSettings(payload: SaveMailSettingsPayload): Promise<MailSettings> {
  const resp = await apiClient.put<MailSettings>('/api/platform/mail-settings', payload);
  return resp.data;
}

export async function testMailSettings(payload: TestMailPayload): Promise<MailTestResult> {
  const resp = await apiClient.post<MailTestResult>('/api/platform/mail-settings/test', payload);
  return resp.data;
}

export async function fetchPlatformEmailPolicy(): Promise<PlatformEmailVerificationPolicy> {
  const resp = await apiClient.get<PlatformEmailVerificationPolicy>('/api/platform/email-verification/policy');
  return resp.data;
}

export async function updatePlatformEmailPolicy(
  payload: UpdateEmailVerificationPolicyPayload,
): Promise<PlatformEmailVerificationPolicy> {
  const resp = await apiClient.put<PlatformEmailVerificationPolicy>(
    '/api/platform/email-verification/policy', payload);
  return resp.data;
}
