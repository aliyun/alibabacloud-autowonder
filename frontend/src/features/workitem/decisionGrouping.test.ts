import { describe, it, expect } from 'vitest';
import {
  isMyPendingDecision,
  isPendingDecision,
} from './decisionGrouping';
import type { Workitem } from '@/shared/types/workitem';

function mk(partial: Partial<Workitem>): Workitem {
  return {
    id: 1,
    workType: 'REQ',
    title: 't',
    contentMd: '',
    templateId: null,
    statusNodeId: null,
    statusName: '开发中',
    statusCategory: 'NEW',
    sdlcId: null,
    sdlcName: null,
    assigneeType: 'HUMAN',
    assigneeRef: null,
    assigneeName: null,
    assigneeDisplayName: null,
    creatorId: null,
    creatorName: null,
    creatorDisplayName: null,
    priority: 3,
    version: 1,
    gmtCreate: '',
    gmtModified: '',
    ...partial,
  } as Workitem;
}

describe('isPendingDecision', () => {
  it('true when the server category is PENDING_DECISION', () => {
    expect(isPendingDecision(mk({ statusCategory: 'PENDING_DECISION', statusName: '开发中' }))).toBe(true);
  });
  it('false for other server categories regardless of status names（名称仅展示）', () => {
    expect(isPendingDecision(mk({ statusCategory: 'NEW', statusName: '待决策复核' }))).toBe(false);
    expect(isPendingDecision(mk({ statusCategory: 'IN_PROGRESS', statusName: '审核中' }))).toBe(false);
    expect(isPendingDecision(mk({ statusCategory: 'DONE', statusName: '已发布' }))).toBe(false);
    expect(isPendingDecision(mk({ statusCategory: null }))).toBe(false);
  });
});

describe('isMyPendingDecision', () => {
  it('matches current user human assignment', () => {
    const item = mk({ statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 42 });
    expect(isMyPendingDecision(item, 42)).toBe(true);
  });
  it('rejects other assignee', () => {
    const item = mk({ statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 42 });
    expect(isMyPendingDecision(item, 7)).toBe(false);
  });
  it('rejects agent assignment even if ref matches', () => {
    const item = mk({ statusCategory: 'PENDING_DECISION', assigneeType: 'AGENT', assigneeRef: 42 });
    expect(isMyPendingDecision(item, 42)).toBe(false);
  });
  it('rejects external assignment even if ref matches', () => {
    const item = mk({ statusCategory: 'PENDING_DECISION', assigneeType: 'EXTERNAL', assigneeRef: 42 });
    expect(isMyPendingDecision(item, 42)).toBe(false);
  });
  it('rejects non-pending', () => {
    const item = mk({ statusCategory: 'NEW', assigneeType: 'HUMAN', assigneeRef: 42 });
    expect(isMyPendingDecision(item, 42)).toBe(false);
  });
  it('returns false when userId is null/undefined', () => {
    const item = mk({ statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 42 });
    expect(isMyPendingDecision(item, null)).toBe(false);
    expect(isMyPendingDecision(item, undefined)).toBe(false);
  });
});
