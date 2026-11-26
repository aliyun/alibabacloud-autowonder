import type { VisualState, VisualTask, VisualAgent } from './visual';
export const names: string[];
export const colors: string[];
export function taskAge(task: VisualTask, time: number): number;
export function archiveTransfer(task: VisualTask, time: number): { taskId: string; from: number; progress: number } | null;
export function dispatchTransfer(task: VisualTask, time: number): { taskId: string; from: number; to: number; progress: number } | null;
export class OfficeSimulation implements VisualState {
  constructor(options?: { preload?: boolean; employeeCount?: number });
  mode?: 'demo';
  agents: VisualAgent[];
  tasks: VisualTask[];
  events: { taskId: string; key: string; names: string[]; time: number }[];
  time: number;
  counts: { total: number; pending: number; active: number; done: number };
  zoneChanges: number[];
  staffDoorOpen: boolean;
  preparation: { readyAt: number } | null;
  fileInventory: { ready: number };
  onlineCount: number;
  advance(dt: number): void;
  setEmployeeCount(count: number): void;
}
