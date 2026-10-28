import { object, code, invalid } from './action-validation';

export type HistoryKind = 'product' | 'movement' | 'all';
export type HistoryAge = 0 | 30 | 90;
export type HistoryInput = {kind: HistoryKind; olderThanDays: HistoryAge};
export function historyInput(input: unknown): HistoryInput {
  const value = object(input);
  const kind = code(value.kind, ['product','movement','all'], 'request kind');
  if (value.olderThanDays !== 0 && value.olderThanDays !== 30 && value.olderThanDays !== 90) invalid('Choose All, 30 days or 90 days.');
  return {kind, olderThanDays: value.olderThanDays as HistoryAge};
}
export function historyCutoff(days: HistoryAge, now = Date.now()): string | null {
  return days === 0 ? null : new Date(now - days * 86400000).toISOString();
}
export function historyCount(data: unknown): number {
  if (!Array.isArray(data) || data.length !== 1) throw new Error('Invalid history result');
  const row = object(data[0]);
  if (![row.product_count,row.movement_count].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid history counts');
  const result = (row.product_count as number) + (row.movement_count as number);
  if (!Number.isSafeInteger(result)) throw new Error('Invalid history total');
  return result;
}
