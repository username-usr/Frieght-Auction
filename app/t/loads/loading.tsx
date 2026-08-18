export default function TruckerPortalLoading() {
  return (
    <div className="w-full space-y-6 animate-pulse p-4 max-w-4xl mx-auto">
      <div className="h-6 w-40 rounded bg-slate-200" />
      <div className="h-10 w-full rounded-xl bg-slate-300" />
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="h-5 w-1/3 rounded bg-slate-200" />
            <div className="h-4 w-2/3 rounded bg-slate-100" />
            <div className="h-8 w-1/4 rounded bg-blue-100" />
          </div>
        ))}
      </div>
    </div>
  )
}
