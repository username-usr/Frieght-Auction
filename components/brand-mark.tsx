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
    <>
      <Image
        src="/ramnath-logo.png"
        alt="Ram-Nath"
        width={500}
        height={107}
        priority={priority}
        className={compact ? 'h-7 w-auto sm:h-8' : 'h-9 w-auto sm:h-10'}
      />
      <span className="hidden border-l border-slate-200 pl-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 sm:block">
        {label}
      </span>
    </>
  )

  return (
    <Link
      href={href}
      aria-label="Ram-Nath home"
      className="inline-flex min-w-0 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-900 focus-visible:ring-offset-4"
    >
      {content}
    </Link>
  )
}
