/**
 * Footer — classic sf2g.com-style footer with dark background and orange border.
 */
export function Footer() {
  return (
    <footer className="footer" id="site-footer">
      <div className="footer__inner">
        <p className="footer__text">
          SF2G — San Francisco Commuter Cycling Club
        </p>
        <div className="footer__links">
          <a
            href="https://www.strava.com"
            target="_blank"
            rel="noopener noreferrer"
            className="footer__link"
          >
            Powered by Strava
          </a>
          <a
            href="https://github.com/pmaier983/sf2g/issues/new?labels=feedback&title=%5BFeedback%5D%20"
            target="_blank"
            rel="noopener noreferrer"
            className="footer__link"
          >
            Feedback
          </a>
          <a
            href="https://github.com/pmaier983/sf2g"
            target="_blank"
            rel="noopener noreferrer"
            className="footer__link"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  )
}
