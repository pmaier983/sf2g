/**
 * EditRideDialog — modal for editing a ride's name, route category,
 * or excluding it from the leaderboard.
 *
 * Opens when clicking the ✏️ edit button on a ride row.
 * Uses useMutation to call upsertRideOverride server function.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { upsertRideOverride } from '../server/ride-overrides'
import { toast } from './Toast'
import { RouteTag } from './RouteTag'
import { Tooltip } from './Tooltip'
import { ROUTE_LABELS } from '../lib/constants'
import type { RouteCategory } from '../lib/database.types'
import { formatRideDate } from '../lib/leaderboard-utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface EditRideData {
  id: string
  name: string | null
  rideDate: string
  routeCategory: RouteCategory | null
  stravaActivityId: number
  isHidden?: boolean
}

interface EditRideDialogProps {
  ride: EditRideData
  isOpen: boolean
  onClose: () => void
}

const ROUTE_OPTIONS: RouteCategory[] = [
  'bayway', 'skyline', 'hmbw', 'royale', 'fleaway', 'mebw', 'febw', 'other',
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function EditRideDialog({ ride, isOpen, onClose }: EditRideDialogProps) {
  const queryClient = useQueryClient()
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Form state
  const [name, setName] = useState(ride.name ?? '')
  const [routeCategory, setRouteCategory] = useState<RouteCategory | null>(ride.routeCategory)
  const [excludeFromLeaderboard, setExcludeFromLeaderboard] = useState(false)
  const [showExcludeConfirm, setShowExcludeConfirm] = useState(false)

  // Reset form when ride changes or dialog opens
  useEffect(() => {
    if (isOpen) {
      setName(ride.name ?? '')
      setRouteCategory(ride.routeCategory)
      setExcludeFromLeaderboard(ride.isHidden ?? false)
      setShowExcludeConfirm(false)
    }
  }, [isOpen, ride])

  // Native dialog open/close
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (isOpen && !dialog.open) {
      dialog.showModal()
    } else if (!isOpen && dialog.open) {
      dialog.close()
    }
  }, [isOpen])

  // Close on backdrop click
  const handleDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        onClose()
      }
    },
    [onClose],
  )

  // Close on Escape
  const handleCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault()
      onClose()
    },
    [onClose],
  )

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      // When restoring a hidden ride, always send the route category to re-classify it
      const shouldSendRoute = !excludeFromLeaderboard && ride.isHidden
        ? routeCategory  // restoring — send whatever is selected
        : excludeFromLeaderboard
          ? null  // excluding — clear route
          : (routeCategory !== ride.routeCategory ? routeCategory : undefined)  // normal edit

      return upsertRideOverride({
        data: {
          rideId: ride.id,
          overrideName: name !== (ride.name ?? '') ? name : undefined,
          overrideRouteCategory: shouldSendRoute,
          isHidden: excludeFromLeaderboard,
          isNotSf2g: excludeFromLeaderboard,
        },
      })
    },
    onSuccess: () => {
      // Show appropriate message based on action
      if (excludeFromLeaderboard && !ride.isHidden) {
        toast.success('Ride excluded from leaderboard')
      } else if (!excludeFromLeaderboard && ride.isHidden) {
        toast.success('Ride restored to leaderboard!')
      } else {
        toast.success('Ride updated!')
      }
      queryClient.invalidateQueries({ queryKey: ['ridesLeaderboard'] })
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
      queryClient.invalidateQueries({ queryKey: ['rides'] })
      queryClient.invalidateQueries({ queryKey: ['allUserRides'] })
      onClose()
    },
    onError: (err: Error) => {
      toast.error('Failed to update ride', {
        description: err.message,
      })
    },
  })

  const handleSave = useCallback(() => {
    saveMutation.mutate()
  }, [saveMutation])

  if (!isOpen) return null

  const isSaving = saveMutation.isPending

  return (
    <dialog
      ref={dialogRef}
      className="edit-ride-dialog__backdrop"
      onClick={handleDialogClick}
      onCancel={handleCancel}
      aria-label="Edit ride"
    >
      <div className="edit-ride-dialog__content">
        {/* Header */}
        <div className="edit-ride-dialog__header">
          <h2 className="edit-ride-dialog__title">Edit Ride</h2>
          <button
            className="edit-ride-dialog__close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Ride info */}
        <div className="edit-ride-dialog__info">
          <span className="edit-ride-dialog__date">
            {formatRideDate(ride.rideDate) ?? ride.rideDate}
          </span>
          {ride.routeCategory && (
            <RouteTag category={ride.routeCategory} />
          )}
          <a
            href={`https://www.strava.com/activities/${String(ride.stravaActivityId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="edit-ride-dialog__strava-link"
          >
            View on Strava ↗
          </a>
        </div>

        {/* Edit Name */}
        <div className="edit-ride-dialog__field">
          <label htmlFor="edit-ride-name" className="edit-ride-dialog__label">
            Ride Name
          </label>
          <input
            id="edit-ride-name"
            type="text"
            className="edit-ride-dialog__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            disabled={isSaving}
          />
        </div>

        {/* Change Route */}
        <div className="edit-ride-dialog__field">
          <label className="edit-ride-dialog__label">
            Route Category
          </label>
          <div className="edit-ride-dialog__route-chips">
            {ROUTE_OPTIONS.map((route) => (
              <button
                key={route}
                type="button"
                className={`edit-ride-dialog__route-chip${
                  !excludeFromLeaderboard && routeCategory === route
                    ? ' edit-ride-dialog__route-chip--active'
                    : ''
                }`}
                onClick={() => {
                  setRouteCategory(route)
                  setExcludeFromLeaderboard(false)
                  setShowExcludeConfirm(false)
                }}
                disabled={isSaving}
              >
                {ROUTE_LABELS[route]}
              </button>
            ))}
          </div>
        </div>

        {/* Exclude from Leaderboard (combined hide + not-sf2g) — show for SF2G rides or already-hidden rides */}
        {(ride.routeCategory || ride.isHidden) && (
          <>
            <div className="edit-ride-dialog__field">
              <Tooltip
                content="Removes this ride from all route totals, leaderboard rankings, and hides it from the rides feed. Use this if the ride was incorrectly classified as an SF2G commute."
                placement="top"
              >
                <label htmlFor="edit-ride-exclude" className="edit-ride-dialog__checkbox-label">
                  <input
                    id="edit-ride-exclude"
                    type="checkbox"
                    checked={excludeFromLeaderboard}
                    onChange={(e) => {
                      setExcludeFromLeaderboard(e.target.checked)
                      if (e.target.checked) {
                        setShowExcludeConfirm(true)
                      } else {
                        setShowExcludeConfirm(false)
                      }
                    }}
                    disabled={isSaving}
                  />
                  Exclude from leaderboard
                </label>
              </Tooltip>
              <span className="edit-ride-dialog__hint">
                {ride.isHidden
                  ? 'This ride is currently excluded. Uncheck to restore it.'
                  : 'Hides this ride and removes it from all SF2G stats.'}
              </span>
            </div>

            {/* Exclude confirmation warning */}
            {showExcludeConfirm && excludeFromLeaderboard && (
              <div className="edit-ride-dialog__exclude-warning">
                ⚠️ This ride will be hidden from the leaderboard and all route stats.
              </div>
            )}
          </>
        )}

        {/* Actions — simplified: only Save / Cancel */}
        <div className="edit-ride-dialog__actions">
          <div className="edit-ride-dialog__save-group">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`btn ${
                excludeFromLeaderboard && !ride.isHidden
                  ? 'btn--danger'
                  : !excludeFromLeaderboard && ride.isHidden
                    ? 'btn--success'
                    : 'btn--primary'
              }`}
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving
                ? 'Saving...'
                : excludeFromLeaderboard && !ride.isHidden
                  ? 'Exclude & Save'
                  : !excludeFromLeaderboard && ride.isHidden
                    ? 'Restore & Save'
                    : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
