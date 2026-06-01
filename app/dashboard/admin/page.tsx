import { redirect } from 'next/navigation'

// Default landing inside /dashboard/admin. Sends visitors to the Loads tab
// rather than rendering a third "index" page; the sub-nav makes the other
// tabs one click away.
export default function AdminIndex() {
  redirect('/dashboard/admin/loads')
}
