export interface EnvironmentVariable {
  id: number;
  name: string;
  value: '**';
  description: string | null;
  /** 预置说明展示键；用户编辑说明或改名后为 null。 */
  descriptionLabelKey?: string | null;
  gmtCreate: string;
  gmtModified: string;
  version: number;
  onlineMountCount?: number;
  draftMountCount?: number;
}

export interface CreateEnvironmentVariableInput {
  name: string;
  value: string;
  description?: string;
  /** 选中的预置键；服务端有限注册表校验后才记录说明来源。 */
  presetKey?: 'qoder' | 'qodercn';
}

export interface UpdateEnvironmentVariableInput {
  name: string;
  description?: string;
  updateValue: boolean;
  value?: string;
}
