const NUMBER = /^([\d,]+(?:\.\d+)?)\s*([^\d\s].*)$/;

export function splitStatValue(value: string): [string, string] {
  const match = NUMBER.exec(value);
  return match ? [match[1], match[2]] : [value, ''];
}

/** 统计卡数值：数字放大，单位以小字跟随（原型 .stat-v / .stat-v small）。 */
export function StatValue({ value }: { value: string }) {
  const [num, unit] = splitStatValue(value);
  return <>{num}{unit && <small>{unit}</small>}</>;
}
