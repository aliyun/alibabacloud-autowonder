/** Each wheel keeps its place while only changed digits turn. */
export function RollingNumber({ value }: { value: string }) {
  return <span className="awo-number" aria-label={value}>
    <span aria-hidden="true">{Array.from(value).map((character, index) =>
      /[0-9]/.test(character) ? <Digit key={value.length - index} value={Number(character)} />
        : <span key={value.length - index}>{character}</span>)}</span>
  </span>;
}

function Digit({ value }: { value: number }) {
  return <span className="awo-digit">
    <span className="awo-digit-strip" style={{ transform: `translateY(-${value * 1.12}em)` }}>
      {Array.from({ length: 10 }, (_, index) => <span key={index}>{index}</span>)}
    </span>
  </span>;
}
