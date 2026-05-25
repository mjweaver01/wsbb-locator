interface FooterCtaProps {
  pathwayUrl: string
}

export function FooterCta({ pathwayUrl }: FooterCtaProps) {
  return (
    <footer className="footer-cta">
      <p className="footer-cta__eyebrow">Join the Directory</p>
      <h2 className="footer-cta__heading">
        Complete the
        <br />
        Pathway
      </h2>
      <p className="footer-cta__sub">
        Earn your WSBB certification and get listed alongside the world's top
        conjugate coaches.
      </p>
      <a
        href={pathwayUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="footer-cta__btn"
      >
        Start Level 1 →
      </a>
    </footer>
  )
}
