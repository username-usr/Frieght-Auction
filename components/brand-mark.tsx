import Image from 'next/image'
import Link from 'next/link'

type BrandMarkProps = {
  href?: string
  label?: string
  priority?: boolean
  compact?: boolean
}

export function BrandMark({
  href = '/',
  label = 'Logistics operations',
  priority = false,
  compact = false,
}: BrandMarkProps) {
  const content = (
    <div className="flex flex-col items-start gap-0.5">
      <Image
        src="/ramnath-logo.png"
        alt="Ram-Nath"
        width={500}
        height={107}
        priority={priority}
        className={compact ? 'h-7 w-auto' : 'h-9 w-auto'}
      />
      {label && (
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
          {label}
        </span>
      )}
    </div>
  )

  return (
    <Link
      href={href}
      aria-label="Ram-Nath home"
      className="inline-flex min-w-0 items-start rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
    >
      {content}
    </Link>
  )
}
