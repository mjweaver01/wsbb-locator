import { useState } from "react";
import { MapPin, Mail } from "lucide-react";
import type { Coach } from "@/lib/types";
import { LEVEL_LABEL, TIER_LABELS } from "@/lib/tiers";

interface CoachCardProps {
  coach: Coach;
  cardRef?: (el: HTMLElement | null) => void;
  includeAnchorId?: boolean;
}

function getInitials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

function formatYear(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).getFullYear().toString();
}

export function CoachCard({
  coach,
  cardRef,
  includeAnchorId = true,
}: CoachCardProps) {
  const { fullName, avatarUrl, bio, tier, certifications, email, city, state } =
    coach;
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = Boolean(avatarUrl) && !avatarFailed;

  return (
    <article
      id={includeAnchorId ? `coach-${coach.thinkificUserId}` : undefined}
      ref={cardRef}
      className={`coach-card coach-card--${tier}`}
    >
      <div className="coach-card__header">
        {showAvatar ? (
          <img
            src={avatarUrl ?? undefined}
            alt={fullName}
            className="coach-avatar"
            loading="lazy"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <div
            className={`coach-avatar--initials coach-avatar--initials-${tier}`}
            aria-hidden="false"
          >
            {getInitials(fullName)}
          </div>
        )}

        <div className="coach-card__identity">
          <p className="coach-card__name">{fullName}</p>
          <span className={`tier-badge tier-badge--${tier}`}>
            <span className={`tier-badge__dot tier-badge__dot--${tier}`} />
            {TIER_LABELS[tier].badge}
          </span>
          {city && (
            <p className="coach-card__location">
              <MapPin size={12} strokeWidth={2} />
              {city}
              {state ? `, ${state}` : ""}
            </p>
          )}
        </div>
      </div>

      {bio ?? (
        <p
          className={`coach-card__bio${!bio ? " coach-card__bio--empty" : ""}`}
        >
          Bio not yet added
        </p>
      )}

      <div className="coach-card__certs">
        {certifications.map((cert) => (
          <span key={cert.level} className="cert-badge">
            {LEVEL_LABEL[cert.level] ?? `Level ${cert.level}`}
            {cert.completedAt && (
              <span className="cert-badge__date">
                {" "}
                '{formatYear(cert.completedAt).slice(2)}
              </span>
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
  );
}
