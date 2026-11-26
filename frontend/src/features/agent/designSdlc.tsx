import { Tag } from 'antd';
import { AgentTagList } from './components/AgentTagList';

type DesignTag = { system?: string; custom?: string; sdlc?: string };
const prototypeDesign = 'PROTOTYPE_DESIGN';

export function isPrdDesignSdlc(name?: string | null) {
  return typeof name === 'string' && /^PRD\s*设计$/iu.test(name.trim());
}

export function PrdDesignSdlcTag({ name }: { name: string }) {
  return <Tag color="blue" style={{ marginInlineEnd: 0 }}>{name}</Tag>;
}

export function designEmployeeTag(member: {
  systemTags?: string[] | null; customTags?: string[] | null; sdlcName?: string | null;
}): DesignTag | undefined {
  const custom = member.customTags?.find(isPrdDesignSdlc);
  if (custom) return { custom };
  if (member.systemTags?.includes(prototypeDesign)) return { system: prototypeDesign };
  return member.sdlcName && isPrdDesignSdlc(member.sdlcName) ? { sdlc: member.sdlcName } : undefined;
}

export function DesignEmployeeTag({ tag }: { tag: DesignTag }) {
  return tag.sdlc ? <PrdDesignSdlcTag name={tag.sdlc} /> : <AgentTagList
    systemTags={tag.system ? [tag.system] : undefined} customTags={tag.custom ? [tag.custom] : undefined} />;
}
