import { i18n } from '@/shared/i18n';

export function repoNameInvalidMessage() {
  return i18n.t('repo:validation.nameInvalid');
}

export function isValidRepoName(value?: string): boolean {
  const name = value?.trim();
  if (!name) {
    return true;
  }
  if (name.includes('/') || name.includes('\\')) {
    return false;
  }
  if (name === '.' || name === '..') {
    return false;
  }
  if (/^[a-zA-Z]:/u.test(name)) {
    return false;
  }
  if (name.startsWith('~') || name.startsWith('%')) {
    return false;
  }
  return !/\p{Cc}/u.test(name);
}

const SCP_LIKE_SSH_REPO_PATTERN = /^[\w.-]+@[\w.-]+:[\w./~@-]+(?:\.git)?$/;
const URL_REPO_PATTERN = /^(https?:\/\/|ssh:\/\/|git:\/\/).+/i;

export function isValidRepoUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return true;
  }
  return URL_REPO_PATTERN.test(trimmed) || SCP_LIKE_SSH_REPO_PATTERN.test(trimmed);
}
