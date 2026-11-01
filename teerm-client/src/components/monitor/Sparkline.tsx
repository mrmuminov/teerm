/** A small line chart of recent values. `max` fixes the vertical scale. */
export function Sparkline({
  values,
  max,
  className,
}: {
  values: number[];
  max?: number;
  className?: string;
}) {
  const width = 120;
  const height = 28;

  if (values.length < 2) {
    return <div className={className} style={{ height }} aria-hidden="true" />;
  }

  const top = max ?? Math.max(...values, 1);
  const step = width / (values.length - 1);
  const points = values
    .map((value, index) => {
      const y = height - (Math.min(value, top) / top) * (height - 2) - 1;
      return `${(index * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height }}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
