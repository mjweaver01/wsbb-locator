import { MapPin, Mail } from 'lucide-react'
import type { RawCoach } from '@/lib/types'

interface CoachCardProps {
  coach: RawCoach
  cardRef?: (el: HTMLElement | null) => void
}

const TIER_LABEL: Record<string, string> = {
  master:     'Master Instructor',
  instructor: 'Instructor',
  certified:  'Certified Coach',
}

const LEVEL_LABEL: Record<number, string> = {
  1: 'Level 1',
  2: 'Level 2',
  3: 'Level 3',
}

function getInitials(fullName: string): string {
  return fullName
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()
}

function formatYear(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).getFullYear().toString()
}

export function CoachCard({ coach, cardRef }: CoachCardProps) {
  const { fullName, avatarUrl, bio, tier, certifications, email, city, state } = coach

  return (
    <article ref={cardRef} className={`coach-card coach-card--${tier}`}>
      <div className="coach-card__header">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={fullName}
            className="coach-avatar"
            loading="lazy"
            onError={e => {
              const el = e.currentTarget
              el.style.display = 'none'
              el.nextElementSibling?.removeAttribute('style')
            }}
          />
        ) : null}
        <div
          className={`coach-avatar--initials coach-avatar--initials-${tier}`}
          aria-hidden={!!avatarUrl}
          style={avatarUrl ? { display: 'none' } : undefined}
        >
          {getInitials(fullName)}
        </div>

        <div className="coach-card__identity">
          <p className="coach-card__name">{fullName}</p>
          <span className={`tier-badge tier-badge--${tier}`}>
            <span className={`tier-badge__dot tier-badge__dot--${tier}`} />
            {TIER_LABEL[tier]}
          </span>
          {city && (
            <p className="coach-card__location">
              <MapPin size={12} strokeWidth={2} />
              {city}{state ? `, ${state}` : ''}
            </p>
          )}
        </div>
      </div>

      <p className={`coach-card__bio${!bio ? ' coach-card__bio--empty' : ''}`}>
        {bio ?? 'Bio not yet added.'}
      </p>

      <div className="coach-card__certs">
        {certifications.map(cert => (
          <span key={cert.level} className="cert-badge">
            {LEVEL_LABEL[cert.level] ?? `Level ${cert.level}`}
            {cert.completedAt && (
              <span className="cert-badge__date"> '{formatYear(cert.completedAt).slice(2)}</span>
            )}
          </span>
        ))}
      </div>

      <div className="coach-card__actions">
        <a
          href={`mailto:${email}`}
          className="coach-card__contact"
          aria-label={`Contact ${fullName}`}
        >
          <Mail size={13} strokeWidth={2} />
          Contact
        </a>
      </div>
    </article>
  )
}
