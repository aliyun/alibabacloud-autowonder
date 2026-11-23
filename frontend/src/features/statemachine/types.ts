export type WorkType = 'REQ' | 'TASK' | 'BUG';
export type NodeCategory = 'INIT' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';

export interface StatusTemplate {
  id: number;
  workType: WorkType;
  name: string;
  /** 系统播种模板的展示键；自定义/改名后为 null。 */
  systemLabelKey?: string | null;
  isDefault: boolean;
  gmtCreate: string;
  gmtModified: string;
}

export interface StatusNode {
  id: number;
  templateId: number;
  code: string;
  name: string;
  /** 系统播种节点的展示键；自定义/改名后为 null。 */
  systemLabelKey?: string | null;
  category: NodeCategory;
  sort: number;
  gmtCreate: string;
}

export interface StatusTransition {
  id: number;
  templateId: number;
  fromNodeId: number;
  toNodeId: number;
  name: string;
  /** 系统播种流转的展示键；改名后为 null。 */
  systemLabelKey?: string | null;
  gmtCreate: string;
}

export interface TemplateDetail extends StatusTemplate {
  nodes: StatusNode[];
  transitions: StatusTransition[];
}
