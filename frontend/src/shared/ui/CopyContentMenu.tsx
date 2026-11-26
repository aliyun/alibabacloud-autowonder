import { i18n } from '@/shared/i18n';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Tooltip, message } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { copyTextToClipboard } from '@/shared/lib/clipboard';
import { markdownToPlainText } from '@/shared/lib/markdownToPlainText';

interface CopyContentMenuProps {
  contentMd?: string | null;
  tooltip?: string;
  /** 渲染为 icon + 文字按钮（与「编辑」等文字按钮统一视觉）；缺省保持图标钮 */
  withLabel?: boolean;
  /** 追加到文字按钮的类名（卡片头 ghost 契约等由调用方决定）；图标钮路径不适用 */
  className?: string;
}

export function CopyContentMenu({ contentMd, tooltip, withLabel = false, className }: CopyContentMenuProps) {
  const { t } = useTranslation('shared');
  tooltip ??= t('copy.title');
  // Workitem bodies may arrive as null from the server; trimming null crashes the whole route.
  const content = contentMd ?? '';
  if (!content.trim()) return null;

  const handleMenuClick = async ({ key }: { key: string }) => {
    const plain = key === 'plaintext';
    const copied = await copyTextToClipboard(plain ? markdownToPlainText(content) : content);
    if (!copied) {
      message.error(i18n.t('shared:copy.failed'));
      return;
    }
    message.success(plain ? i18n.t('shared:copy.plainCopied') : i18n.t('shared:copy.markdownCopied'));
  };

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: [
          { key: 'markdown', label: t('copy.markdown') },
          { key: 'plaintext', label: t('copy.plain') },
        ],
        onClick: handleMenuClick,
      }}
    >
      {withLabel ? (
        <Button icon={<AwStrokeIcon name="copy" />} aria-label={tooltip} data-testid="copy-content-menu" className={className}>{t('copy.title')}</Button>
      ) : (
        <Tooltip title={tooltip}>
          <Button
            type="text"
            size="small"
            icon={<AwStrokeIcon name="copy" />}
            aria-label={tooltip}
            data-testid="copy-content-menu"
          />
        </Tooltip>
      )}
    </Dropdown>
  );
}
