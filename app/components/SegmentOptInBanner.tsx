import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { currentUserQueryOptions } from "../queries/user";
import { setSegmentBoardOptIn } from "../server/segments";

/**
 * Shown to a signed-in rider who has not opted in to the segment board.
 * Strava's API agreement only allows showing a rider's efforts to others
 * with their consent, so riders are hidden until they click this. An
 * opted-in rider gets a link to hide their times again.
 */
export function SegmentOptInBanner() {
  const queryClient = useQueryClient();
  const { data: user } = useQuery(currentUserQueryOptions());
  const optIn = useMutation({
    mutationFn: (value: boolean) =>
      setSegmentBoardOptIn({ data: { optIn: value } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["currentUser"] }),
        queryClient.invalidateQueries({ queryKey: ["segments"] }),
      ]);
    },
  });

  if (!user) return null;

  // Opted in: a quiet way back out.
  if (user.segment_board_opt_in) {
    return (
      <p className="segments__opt-out">
        Your times are on the board.{" "}
        <button
          type="button"
          className="segments__opt-out-btn"
          onClick={() => optIn.mutate(false)}
          disabled={optIn.isPending}
        >
          Hide my times
        </button>
      </p>
    );
  }

  return (
    <div
      className="segments__opt-in"
      role="region"
      aria-label="Join the segment board"
    >
      <p>
        Your Skyline efforts are hidden. Join the board to show your best times
        to other SF2G riders (you can leave any time from this page).
      </p>
      <button
        type="button"
        className="btn btn--primary btn--sm"
        onClick={() => optIn.mutate(true)}
        disabled={optIn.isPending}
      >
        {optIn.isPending ? "Joining…" : "Show my times"}
      </button>
      {optIn.error && (
        <p className="segments__opt-in-error" role="alert">
          Couldn't update your setting. Please try again.
        </p>
      )}
    </div>
  );
}
