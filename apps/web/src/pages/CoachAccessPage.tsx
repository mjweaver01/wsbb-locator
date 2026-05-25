import { CoachProfileAccess } from '@/components/CoachProfileAccess'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

export function CoachAccessPage() {
  return (
    <main className="coach-access-page">
      <header className="coach-access-page-header">
        <div className="coach-access-page-header__inner">
          <a href="/" className="coach-access-page-header__back">
            ← Back to directory
          </a>
          <p className="coach-access-page-header__eyebrow">WSBB Coach Portal</p>
          <h1 className="coach-access-page-header__title">Coach Listing Access</h1>
          <p className="coach-access-page-header__sub">
            Verify your email to update your public coach profile.
          </p>
        </div>
      </header>

      <CoachProfileAccess apiBase={API_BASE} showIntro={false} />
    </main>
  )
}
