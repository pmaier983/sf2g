import { useState, useCallback } from 'react'

/**
 * CopyLinkButton — copies the current page URL (with an optional hash/section)
 * to the clipboard and shows a brief "Copied!" confirmation.
 */
export function CopyLinkButton({ section }: { section?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const url = new URL(window.location.href)
    if (section) {
      url.hash = section
    }
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [section])

  return (
    <button
      className="copy-link-btn"
      onClick={handleCopy}
      aria-label={`Copy link${section ? ` to ${section}` : ''}`}
      title={copied ? 'Copied!' : 'Copy link to this section'}
    >
      {copied ? (
        <span className="copy-link-btn__check">✓</span>
      ) : (
        <svg
          className="copy-link-btn__icon"
          viewBox="0 0 16 16"
          fill="currentColor"
          width="14"
          height="14"
        >
          <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z" />
          <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z" />
        </svg>
      )}
    </button>
  )
}
