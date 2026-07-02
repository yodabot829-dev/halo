export function Spark({ counts, width = 8 }: { counts: number[]; width?: number }) {
  const max = Math.max(...counts, 1)
  return (
    <svg width={counts.length * width} height="26" className="spark">
      {counts.map((c, i) => {
        const h = c === 0 ? 2 : Math.max(3, (c / max) * 24)
        return (
          <rect
            key={i}
            x={i * width + 1}
            y={26 - h}
            width={width - 2}
            height={h}
            rx="1.5"
            className={c === 0 ? 'spark-bar empty' : 'spark-bar'}
          />
        )
      })}
    </svg>
  )
}
