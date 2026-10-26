import { Link } from "@tanstack/react-router";

/** Avatar + name linking to the rider's profile (both segment tables). */
export function SegmentRider({
  userId,
  displayName,
  avatarUrl,
}: {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}) {
  return (
    <div className="segments__rider">
      {avatarUrl ? (
        <img
          className="segments__avatar"
          src={avatarUrl}
          alt=""
          loading="lazy"
          width={28}
          height={28}
        />
      ) : (
        <span
          className="segments__avatar segments__avatar--empty"
          aria-hidden="true"
        >
          👤
        </span>
      )}
      <Link
        to="/profile/$userId"
        params={{ userId }}
        className="segments__rider-name"
        onClick={(e) => e.stopPropagation()}
      >
        {displayName}
      </Link>
    </div>
  );
}
