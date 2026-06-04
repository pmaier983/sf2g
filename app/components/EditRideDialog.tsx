/**
 * EditRideDialog — modal for editing a ride's name, route category,
 * or hiding it from the leaderboard.
 *
 * Opens when clicking the ✏️ edit button on a ride row.
 * Uses useMutation to call upsertRideOverride server function.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { upsertRideOverride } from '../server/ride-overrides'
import { toast } from './Toast'
import { RouteTag } from './RouteTag'
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
  const [isNotSf2g, setIsNotSf2g] = useState(false)
  const [showHideConfirm, setShowHideConfirm] = useState(false)

  // Reset form when ride changes or dialog opens
  useEffect(() => {
    if (isOpen) {
      setName(ride.name ?? '')
      setRouteCategory(ride.routeCategory)
      setIsNotSf2g(false)
      setShowHideConfirm(false)
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
      return upsertRideOverride({
        data: {
          rideId: ride.id,
          overrideName: name !== (ride.name ?? '') ? name : undefined,
          overrideRouteCategory:
            isNotSf2g ? null : (routeCategory !== ride.routeCategory ? routeCategory : undefined),
          isHidden: false,
          isNotSf2g,
        },
      })
    },
    onSuccess: () => {
      toast.success('Ride updated!')
      queryClient.invalidateQueries({ queryKey: ['ridesLeaderboard'] })
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
      queryClient.invalidateQueries({ queryKey: ['userRides'] })
      onClose()
    },
    onError: (err: Error) => {
      toast.error('Failed to update ride', {
        description: err.message,
      })
    },
  })

  // Hide mutation
  const hideMutation = useMutation({
    mutationFn: async () => {
      return upsertRideOverride({
        data: {
          rideId: ride.id,
          isHidden: true,
        },
      })
    },
    onSuccess: () => {
      toast.success('Ride hidden from leaderboard')
      queryClient.invalidateQueries({ queryKey: ['ridesLeaderboard'] })
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
      queryClient.invalidateQueries({ queryKey: ['userRides'] })
      onClose()
    },
    onError: (err: Error) => {
      toast.error('Failed to hide ride', {
        description: err.message,
      })
    },
  })

  const handleSave = useCallback(() => {
    saveMutation.mutate()
  }, [saveMutation])

  const handleHide = useCallback(() => {
    hideMutation.mutate()
  }, [hideMutation])

  if (!isOpen) return null

  const isSaving = saveMutation.isPending || hideMutation.isPending

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
                  !isNotSf2g && routeCategory === route
                    ? ' edit-ride-dialog__route-chip--active'
                    : ''
                }`}
                onClick={() => {
                  setRouteCategory(route)
                  setIsNotSf2g(false)
                }}
                disabled={isSaving}
              >
                {ROUTE_LABELS[route]}
              </button>
            ))}
          </div>
        </div>

        {/* Mark as Not SF2G */}
        <div className="edit-ride-dialog__field">
          <label className="edit-ride-dialog__checkbox-label">
            <input
              type="checkbox"
              checked={isNotSf2g}
              onChange={(e) => setIsNotSf2g(e.target.checked)}
              disabled={isSaving}
            />
            Mark as not a valid SF2G ride
          </label>
          <span className="edit-ride-dialog__hint">
            This removes the ride from route totals and leaderboard rankings.
          </span>
        </div>

        {/* Actions */}
        <div className="edit-ride-dialog__actions">
          {/* Hide ride */}
          {!showHideConfirm ? (
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => setShowHideConfirm(true)}
              disabled={isSaving}
            >
              🗑️ Hide Ride
            </button>
          ) : (
            <div className="edit-ride-dialog__confirm-group">
              <span className="edit-ride-dialog__confirm-text">
                Hide this ride from the leaderboard?
              </span>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                onClick={handleHide}
                disabled={isSaving}
              >
                {hideMutation.isPending ? 'Hiding...' : 'Yes, hide it'}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setShowHideConfirm(false)}
                disabled={isSaving}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Save / Cancel */}
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
              className="btn btn--primary"
              onClick={handleSave}
              disabled={isSaving}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
