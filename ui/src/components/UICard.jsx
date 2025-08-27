export default function UICard({ title, value }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow ring-1 ring-indigo-100">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  )
}