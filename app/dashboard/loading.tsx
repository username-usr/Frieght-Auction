export default function DashboardLoading() {
  return (
    <div className="w-full space-y-6 animate-pulse p-2 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-4 w-28 rounded bg-slate-200" />
          <div className="h-8 w-64 rounded-lg bg-slate-300" />
        </div>
        <div className="h-10 w-32 rounded-lg bg-blue-200" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="h-24 rounded-xl border border-slate-200 bg-white p-4" />
        <div className="h-24 rounded-xl border border-slate-200 bg-white p-4" />
        <div className="h-24 rounded-xl border border-slate-200 bg-white p-4" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="h-6 w-36 rounded bg-slate-200" />
          <div className="h-8 w-48 rounded bg-slate-100" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-slate-50 border border-slate-100" />
          ))}
        </div>
      </div>
    </div>
  )
}
