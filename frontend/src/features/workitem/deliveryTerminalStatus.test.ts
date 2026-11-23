import { describe, expect, it } from 'vitest';
import { convergeStepsForTerminalStatus } from './components/DeliveryProgress';
import type { DeliveryStep } from '@/shared/types/workitem';

const steps = (): DeliveryStep[] => [
  { stepId: 1, stepKey: 'a', name: 'a', status: 'done', attempts: [], executorName: null, subSteps: null, durationMs: null },
  { stepId: 2, stepKey: 'b', name: 'b', status: 'active', attempts: [], executorName: null, subSteps: null, durationMs: null },
  { stepId: 3, stepKey: 'c', name: 'c', status: 'pending', attempts: [], executorName: null, subSteps: null, durationMs: null },
];

describe('convergeStepsForTerminalStatus with unified status category', () => {
  it('converges active steps when the workitem category is DONE', () => {
    const converged = convergeStepsForTerminalStatus(steps(), 'DONE');
    expect(converged.map(step => step.status)).toEqual(['done', 'done', 'pending']);
  });

  it('converges active steps to cancelled when the workitem category is CANCELED', () => {
    const converged = convergeStepsForTerminalStatus(steps(), 'CANCELED');
    expect(converged.map(step => step.status)).toEqual(['done', 'cancelled', 'pending']);
  });

  it('leaves steps untouched for unfinished categories and unknown values', () => {
    for (const value of ['IN_PROGRESS', 'NEW', 'PENDING_DECISION', '不明状态']) {
      expect(convergeStepsForTerminalStatus(steps(), value).map(step => step.status))
        .toEqual(['done', 'active', 'pending']);
    }
  });
});
