import { afterEach, describe, expect, it } from 'vitest';
import { clearFoldState, isFoldExpanded, setFoldExpanded } from './foldingState';

describe('foldingState', () => {
  afterEach(() => { clearFoldState(); });

  it('remembers expanded folds by stable node identity', () => {
    expect(isFoldExpanded('thinking-1-0-7')).toBe(false);
    setFoldExpanded('thinking-1-0-7', true);
    expect(isFoldExpanded('thinking-1-0-7')).toBe(true);
    setFoldExpanded('thinking-1-0-7', false);
    expect(isFoldExpanded('thinking-1-0-7')).toBe(false);
  });

  it('bounds the retained fold state so long conversations cannot grow it forever', () => {
    for (let index = 0; index < 5001; index++) setFoldExpanded(`fold-${index}`, true);
    expect(isFoldExpanded('fold-0')).toBe(false);
    expect(isFoldExpanded('fold-5000')).toBe(true);
  });
});
