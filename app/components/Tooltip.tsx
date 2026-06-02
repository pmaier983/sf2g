import { useState, type ReactNode } from 'react'
import {
  useFloating,
  useHover,
  useFocus,
  useRole,
  useDismiss,
  useInteractions,
  offset,
  flip,
  shift,
  FloatingPortal,
  type Placement,
} from '@floating-ui/react'

interface TooltipProps {
  /** The content shown inside the tooltip */
  content: ReactNode
  /** The trigger element(s) */
  children: ReactNode
  /** Preferred placement relative to the trigger */
  placement?: Placement
  /** Delay in ms before showing (default: 200) */
  delay?: number
}

/**
 * Tooltip — Floating UI powered tooltip component.
 *
 * Wraps children in an inline span that acts as the positioning reference.
 *
 * Usage:
 *   <Tooltip content="Helpful text here">
 *     <button>Hover me</button>
 *   </Tooltip>
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 200,
}: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  })

  const hover = useHover(context, { delay: { open: delay, close: 0 } })
  const focus = useFocus(context)
  const role = useRole(context, { role: 'tooltip' })
  const dismiss = useDismiss(context)

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    role,
    dismiss,
  ])

  return (
    <>
      <span
        ref={refs.setReference}
        style={{ display: 'inline-flex', alignItems: 'center' }}
        {...getReferenceProps()}
      >
        {children}
      </span>
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className="tooltip"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
