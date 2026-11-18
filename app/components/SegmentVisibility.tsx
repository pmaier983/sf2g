import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { currentUserQueryOptions } from "../queries/user";
import { setSegmentBoardHidden } from "../server/segments";
import { trackEvent } from "../lib/analytics";

/**
 * Every connected rider is on the segment boards (riders consent when they
 * sign up for SF2G; phase 09, P1). A signed-in rider gets a quiet way to hide
 * their times, and to show them again.
 */
export function SegmentVisibility() {
  const queryClient = useQueryClient();
  const { data: user } = useQuery(currentUserQueryOptions());
  const toggle = useMutation({
    mutationFn: (hidden: boolean) =>
      setSegmentBoardHidden({ data: { hidden } }),
    onSuccess: async (_res, hidden) => {
      trackEvent("segment_board_hidden", { hidden });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["currentUser"] }),
        queryClient.invalidateQueries({ queryKey: ["segments"] }),
      ]);
    },
  });

  if (!user) return null;
  const hidden = user.segment_board_hidden;

  return (
    <p className="segments__opt-out">
      {hidden
        ? "Your times are hidden from the segment boards."
        : "Your times are on the segment boards."}{" "}
      <button
        type="button"
        className="segments__opt-out-btn"
        onClick={() => toggle.mutate(!hidden)}
        disabled={toggle.isPending}
      >
        {hidden ? "Show my times" : "Hide my times"}
      </button>
      {toggle.error && (
        <span className="segments__opt-in-error" role="alert">
          {" "}
          Couldn't update your setting. Please try again.
        </span>
      )}
    </p>
  );
}
