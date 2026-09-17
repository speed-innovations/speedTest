import clsx from 'clsx'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  light?: boolean
  showTagline?: boolean
}

export default function SpeedLogo({ size = 'md', light = false, showTagline = true }: LogoProps) {
  const sizes = {
    sm: { text: 'text-xl', sub: 'text-[9px]', gap: 'gap-2', lines: { w1: 36, w2: 28, w3: 32, dot: 8, h: 4 } },
    md: { text: 'text-3xl', sub: 'text-[11px]', gap: 'gap-2.5', lines: { w1: 48, w2: 36, w3: 42, dot: 10, h: 5 } },
    lg: { text: 'text-5xl', sub: 'text-sm', gap: 'gap-3', lines: { w1: 60, w2: 46, w3: 54, dot: 12, h: 6 } },
  }
  const s = sizes[size]
  const textColor = light ? 'text-white' : 'text-[#3B1F8C]'
  const subColor = light ? 'text-white/50' : 'text-gray-500'

  return (
    <div className={clsx('flex items-center', s.gap)}>
      {/* Speed lines + dot */}
      <div className="flex flex-col gap-[3px] items-end relative">
        {/* Dot */}
        <div className="rounded-full self-end" style={{
          width: s.lines.dot,
          height: s.lines.h,
          borderRadius: s.lines.h / 2,
          background: '#00C9A7',
          marginBottom: 1,
        }} />
        {/* Lines */}
        {[s.lines.w1, s.lines.w2, s.lines.w3].map((w, i) => (
          <div key={i} style={{
            width: w,
            height: s.lines.h,
            borderRadius: s.lines.h / 2,
            background: 'linear-gradient(90deg, #00C9A7, #3B1F8C)',
            opacity: i === 1 ? 0.65 : 1,
          }} />
        ))}
      </div>

      {/* Text */}
      <div className="leading-none">
        <div className={clsx('font-black tracking-tight', s.text, textColor)} style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>
          SPEE
          <span className="relative inline-block">
            D
            {/* Circle accents inside D */}
            <span className="absolute rounded-full" style={{
              width: size === 'sm' ? 3 : size === 'md' ? 4 : 5,
              height: size === 'sm' ? 3 : size === 'md' ? 4 : 5,
              top: '30%', right: '32%',
              background: light ? 'rgba(255,255,255,0.4)' : 'rgba(59,31,140,0.3)',
            }} />
            <span className="absolute rounded-full" style={{
              width: size === 'sm' ? 4 : size === 'md' ? 6 : 8,
              height: size === 'sm' ? 4 : size === 'md' ? 6 : 8,
              top: '40%', right: '18%',
              background: light ? 'rgba(255,255,255,0.3)' : 'rgba(59,31,140,0.25)',
            }} />
          </span>
        </div>
        {showTagline && (
          <div className={clsx('font-light tracking-[0.25em] leading-none mt-0.5 text-right', s.sub, subColor)}>
            innovation
          </div>
        )}
      </div>
    </div>
  )
}
