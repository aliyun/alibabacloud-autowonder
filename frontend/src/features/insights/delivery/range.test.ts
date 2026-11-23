import { describe, expect, it } from 'vitest';
import { axisRange, bucketPoint, labelDensity, PARTIAL_OPACITY, tooltipRange } from './range';

const range = (displayStart: string, displayEnd: string) => ({ displayStart, displayEnd });

describe('delivery bucket ranges', () => {
  it('prints both range dates as a two-line axis label', () => {
    expect(axisRange(range('2026-10-19', '2026-10-25'))).toBe('10/19\n10/25');
  });

  it('keeps a truncated first day and the running week explicit', () => {
    expect(axisRange(range('2026-10-19', '2026-10-19'))).toBe('10/19\n10/19');
    expect(axisRange(range('2026-11-16', '2026-11-17'))).toBe('11/16\n11/17');
  });

  it('keeps cross-year ranges readable without a year suffix in the axis', () => {
    expect(axisRange(range('2026-12-29', '2027-01-04'))).toBe('12/29\n01/04');
  });

  it('keeps the year in the tooltip so a cross-year window stays unambiguous', () => {
    expect(tooltipRange(range('2026-12-29', '2027-01-04'))).toBe('2026/12/29 – 2027/01/04');
    expect(tooltipRange(range('2026-10-19', '2026-10-25'))).toBe('2026/10/19 – 2026/10/25');
  });
});

describe('delivery label density', () => {
  it('shows every label when a two-column card has room for it', () => {
    expect(labelDensity(660, 14)).toEqual({ interval: 0, fontSize: 10, valueFontSize: 10, showValue: true });
  });

  it('condenses labels and hides values on the measured three-column card', () => {
    expect(labelDensity(455, 14)).toEqual({ interval: 1, fontSize: 9, valueFontSize: 10, showValue: false });
  });

  it('skips more labels as the card narrows further', () => {
    expect(labelDensity(280, 14)).toEqual({ interval: 1, fontSize: 9, valueFontSize: 10, showValue: false });
    expect(labelDensity(168, 14)).toEqual({ interval: 2, fontSize: 9, valueFontSize: 10, showValue: false });
  });

  it('switches font sizes exactly at the documented thresholds', () => {
    expect(labelDensity(440, 10).fontSize).toBe(10);
    expect(labelDensity(439, 10).fontSize).toBe(9);
    expect(labelDensity(480, 10).valueFontSize).toBe(11);
    expect(labelDensity(479, 10).valueFontSize).toBe(10);
    expect(labelDensity(340, 10)).toEqual({ interval: 0, fontSize: 9, valueFontSize: 10, showValue: true });
    expect(labelDensity(339, 10).showValue).toBe(false);
  });

  it('falls back to a readable density before the container is measured', () => {
    expect(labelDensity(0, 14)).toEqual({ interval: 0, fontSize: 9, valueFontSize: 10, showValue: true });
  });
});

describe('partial bucket points', () => {
  it('dims partial buckets without changing their value', () => {
    expect(bucketPoint(7, true)).toEqual({ value: 7, itemStyle: { opacity: PARTIAL_OPACITY } });
    expect(PARTIAL_OPACITY).toBe(0.55);
  });

  it('keeps full buckets and empty samples untouched', () => {
    expect(bucketPoint(5, false)).toBe(5);
    expect(bucketPoint(0, false)).toBe(0);
    expect(bucketPoint(null, true)).toBeNull();
  });
});
