import { useTranslation } from 'react-i18next';
import { useEffect, useRef, type ReactNode } from 'react';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { Checkbox, Input, InputNumber, Radio, Switch } from 'antd';
import { OTHER_SENTINEL } from './elicitationAnswer';
import type { ElicitationField as ElicitationFieldType, ElicitationOption } from './schemaForm';

export interface ElicitationFieldProps {
  field: ElicitationFieldType;
  /** select: string|OTHER；multiselect: string[]（可含 OTHER）；其余为原值 */
  value: unknown;
  otherText: string;
  error?: string;
  disabled?: boolean;
  onValueChange: (value: unknown) => void;
  onOtherTextChange: (text: string) => void;
  /** 单选点中真实选项时触发，供向导自动切下一题；选「有其他想法」不触发。 */
  onPickOption?: (optionValue: string) => void;
}

function OptionLabel({ option }: { option: ElicitationOption }) {
  return (
    <>
      <span className="t">{option.label}</span>
      {option.hint ? <span className="h">{option.hint}</span> : null}
    </>
  );
}

export function ElicitationField({
  field, value, otherText, error, disabled, onValueChange, onOtherTextChange, onPickOption,
}: ElicitationFieldProps) {
  const { t } = useTranslation('workitem');
  const otherInputRef = useRef<TextAreaRef>(null);

  const isOtherSelected = field.control === 'select'
    ? value === OTHER_SENTINEL
    : field.control === 'multiselect'
      ? ((value as string[] | undefined) ?? []).includes(OTHER_SENTINEL)
      : false;

  // 只在「同一题内 OTHER 从未选变为选中」（用户刚点了「有其他想法」）时聚焦，浏览器随之把输入框滚到可见；
  // 换题回看已选 OTHER 的题目是「挂载即已选」，不抢焦点，免得夺走刚点的步骤点按钮焦点（对齐 mockup 的 inp.focus()）。
  const prevOther = useRef({ name: field.name, other: isOtherSelected });
  useEffect(() => {
    if (prevOther.current.name === field.name && !prevOther.current.other && isOtherSelected) {
      otherInputRef.current?.focus();
    }
    prevOther.current = { name: field.name, other: isOtherSelected };
  });

  const otherInput = (
    <div className="aw-cl-other-input">
      <Input.TextArea
        ref={otherInputRef}
        value={otherText}
        disabled={disabled}
        rows={2}
        placeholder={t('clarification.otherPlaceholder')}
        data-testid={`elicitation-other-input-${field.name}`}
        onChange={(e) => onOtherTextChange(e.target.value)}
      />
    </div>
  );

  let control: ReactNode;

  if (field.control === 'select') {
    control = (
      <>
        <Radio.Group
          value={value as string | undefined}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value as string;
            onValueChange(next);
            if (next !== OTHER_SENTINEL) onPickOption?.(next);
          }}
          className="aw-cl-opts"
        >
          {(field.options ?? []).map((option, index) => (
            <Radio
              key={option.value}
              value={option.value}
              data-testid={`elicitation-option-${field.name}-${index}`}
              className="aw-cl-opt"
            >
              <OptionLabel option={option} />
            </Radio>
          ))}
          <Radio
            key={OTHER_SENTINEL}
            value={OTHER_SENTINEL}
            data-testid={`elicitation-option-${field.name}-other`}
            className="aw-cl-opt other"
          >
            <span className="t">{t('clarification.otherIdeas')}</span>
          </Radio>
        </Radio.Group>
        {value === OTHER_SENTINEL ? otherInput : null}
      </>
    );
  } else if (field.control === 'multiselect') {
    const arr = (value as string[] | undefined) ?? [];
    control = (
      <>
        <Checkbox.Group
          value={arr}
          disabled={disabled}
          onChange={(next) => onValueChange(next as string[])}
          className="aw-cl-opts"
        >
          {(field.options ?? []).map((option, index) => (
            <Checkbox
              key={option.value}
              value={option.value}
              data-testid={`elicitation-option-${field.name}-${index}`}
              className="aw-cl-opt"
            >
              <OptionLabel option={option} />
            </Checkbox>
          ))}
          <Checkbox
            key={OTHER_SENTINEL}
            value={OTHER_SENTINEL}
            data-testid={`elicitation-option-${field.name}-other`}
            className="aw-cl-opt other"
          >
            <span className="t">{t('clarification.otherIdeas')}</span>
          </Checkbox>
        </Checkbox.Group>
        {arr.includes(OTHER_SENTINEL) ? otherInput : null}
      </>
    );
  } else if (field.control === 'boolean') {
    control = (
      <Switch
        checked={value === true}
        disabled={disabled}
        data-testid={`elicitation-field-${field.name}`}
        onChange={(checked) => onValueChange(checked)}
        style={{ marginTop: 10 }}
      />
    );
  } else if (field.control === 'number') {
    control = (
      <InputNumber
        value={value as number | undefined}
        disabled={disabled}
        aria-label={field.label}
        data-testid={`elicitation-field-${field.name}`}
        onChange={(next) => onValueChange(next ?? undefined)}
        style={{ width: '100%', marginTop: 10 }}
      />
    );
  } else if (field.control === 'json') {
    control = (
      <>
        <Input.TextArea
          value={(value as string) ?? ''}
          disabled={disabled}
          rows={3}
          aria-label={field.label}
          className="aw-cl-textq"
          data-testid={`elicitation-field-${field.name}`}
          onChange={(e) => onValueChange(e.target.value)}
          style={{ marginTop: 10 }}
        />
        {field.rawSchema !== undefined ? (
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--aw-text-3)' }}>{t('clarification.rawSchema')}</summary>
            <pre data-testid={`elicitation-raw-schema-${field.name}`} className="aw-cl-pre" style={{ marginTop: 4 }}>
              {JSON.stringify(field.rawSchema, null, 2)}
            </pre>
          </details>
        ) : null}
      </>
    );
  } else {
    control = (
      <Input.TextArea
        value={(value as string) ?? ''}
        disabled={disabled}
        rows={2}
        aria-label={field.label}
        className="aw-cl-textq"
        data-testid={`elicitation-field-${field.name}`}
        onChange={(e) => onValueChange(e.target.value)}
        style={{ marginTop: 10 }}
      />
    );
  }

  return (
    <div>
      {control}
      {error ? (
        <div data-testid={`elicitation-error-${field.name}`} className="aw-cl-q-err">
          {error}
        </div>
      ) : null}
    </div>
  );
}
