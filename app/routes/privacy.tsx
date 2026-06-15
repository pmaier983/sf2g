import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Privacy Policy — SF2G" },
      {
        name: "description",
        content:
          "SF2G privacy policy — what data we collect and how we use it.",
      },
    ],
  }),
});

const sectionStyle = {
  marginBottom: "var(--space-6)",
} as const;

const headingStyle = {
  marginBottom: "var(--space-3)",
  color: "var(--color-text)",
} as const;

const listStyle = {
  paddingLeft: "var(--space-5)",
  marginBottom: "var(--space-4)",
  lineHeight: "1.7",
} as const;

const paragraphStyle = {
  lineHeight: "1.7",
  marginBottom: "var(--space-3)",
  color: "var(--color-text-secondary)",
} as const;

function PrivacyPage() {
  return (
    <div
      className="container"
      style={{
        maxWidth: "720px",
        padding: "var(--space-6) var(--space-4)",
      }}
    >
      <h1 style={{ marginBottom: "var(--space-2)" }}>Privacy Policy</h1>
      <p
        style={{
          color: "var(--color-text-muted)",
          marginBottom: "var(--space-6)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        Last updated: June 2026
      </p>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Overview</h2>
        <p style={paragraphStyle}>
          SF2G is a community cycling commute tracker for the SF2G (San
          Francisco to the Peninsula) community. This policy explains what data
          we collect, how we store it, and your rights regarding that data.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>What Data We Collect</h2>
        <p style={paragraphStyle}>
          When you connect your Strava account, we collect and store:
        </p>
        <ul style={listStyle}>
          <li>
            <strong>Strava profile information</strong> — your username, first
            name, last name, and profile photo URL
          </li>
          <li>
            <strong>Ride activity data</strong> — ride name, date, distance,
            elevation, speed, moving time, route GPS data, and activity
            visibility settings
          </li>
          <li>
            <strong>Performance metrics</strong> — average and max heart rate,
            average and max power (watts), kilojoules, and relative effort
            score, when available from your device
          </li>
          <li>
            <strong>OAuth tokens</strong> — access and refresh tokens used to
            sync your rides from Strava
          </li>
        </ul>
        <p style={paragraphStyle}>
          We do <strong>not</strong> collect your email address, password, or
          any data beyond what is listed above.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>How Data Is Stored</h2>
        <p style={paragraphStyle}>
          Your data is stored in a PostgreSQL database hosted on{" "}
          <a
            href="https://supabase.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Supabase
          </a>
          &apos;s cloud infrastructure. Database access is protected by
          Row-Level Security (RLS) policies and service-role authentication for
          server-side writes.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>What&apos;s Publicly Visible</h2>
        <p style={paragraphStyle}>
          The following data is visible to all visitors on the leaderboard and
          ride tables:
        </p>
        <ul style={listStyle}>
          <li>Your display name and profile photo</li>
          <li>
            Ride statistics — date, distance, speed, elevation, route category
          </li>
          <li>Leaderboard rankings and aggregate ride counts</li>
        </ul>
        <p style={paragraphStyle}>
          Rides marked as private on Strava are excluded from the public
          leaderboard and ride tables. Hidden rides (manually hidden by you) are
          also excluded from public views.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>What&apos;s Private</h2>
        <p style={paragraphStyle}>
          The following data is <strong>never</strong> exposed publicly:
        </p>
        <ul style={listStyle}>
          <li>OAuth access and refresh tokens</li>
          <li>Your email address (we don&apos;t collect it)</li>
          <li>Session cookies and authentication state</li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Data Retention</h2>
        <p style={paragraphStyle}>
          Your profile and ride data are stored as long as your Strava account
          remains connected to SF2G. We periodically sync new rides from your
          Strava account to keep your data up to date.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Deleting Your Data</h2>
        <p style={paragraphStyle}>
          You can disconnect your Strava account at any time from your profile
          page. When you disconnect:
        </p>
        <ul style={listStyle}>
          <li>
            All of your ride data is permanently deleted from our database
          </li>
          <li>Your OAuth tokens are cleared</li>
          <li>Your Strava access is revoked</li>
          <li>Your data is removed from the leaderboard</li>
        </ul>
        <p style={paragraphStyle}>
          You can also revoke SF2G&apos;s access directly from your{" "}
          <a
            href="https://www.strava.com/settings/apps"
            target="_blank"
            rel="noopener noreferrer"
          >
            Strava settings page
          </a>
          .
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Third-Party Services</h2>
        <p style={paragraphStyle}>
          SF2G relies on the following third-party services:
        </p>
        <ul style={listStyle}>
          <li>
            <strong>Strava API</strong> — ride data sync and OAuth
            authentication
          </li>
          <li>
            <strong>Supabase</strong> — database hosting and API layer
          </li>
          <li>
            <strong>Cloudflare Pages</strong> — application hosting and CDN
          </li>
          <li>
            <strong>OpenStreetMap / CARTO</strong> — interactive map tile
            rendering
          </li>
        </ul>
        <p style={paragraphStyle}>
          Each service has its own privacy policy. We encourage you to review
          them for details on how they handle data.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Cookies &amp; Local Storage</h2>
        <p style={paragraphStyle}>SF2G uses minimal browser storage:</p>
        <ul style={listStyle}>
          <li>
            <strong>Session cookie</strong> — a signed, HTTP-only cookie used to
            maintain your authenticated session
          </li>
          <li>
            <strong>Theme preference</strong> — your dark/light mode choice is
            stored in <code>localStorage</code>
          </li>
        </ul>
        <p style={paragraphStyle}>
          We do not use tracking cookies, advertising cookies, or any
          third-party analytics scripts.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Analytics &amp; Tracking</h2>
        <p style={paragraphStyle}>
          SF2G does not use any analytics services (no Google Analytics, no
          Mixpanel, no tracking pixels). We do not track your browsing behavior
          beyond basic server request logs that are automatically generated by
          our hosting infrastructure.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Children&apos;s Privacy</h2>
        <p style={paragraphStyle}>
          SF2G is not directed at children under 13 years of age. We do not
          knowingly collect personal information from children under 13. If you
          believe a child under 13 has provided us with personal data, please
          contact us so we can delete it.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Changes to This Policy</h2>
        <p style={paragraphStyle}>
          We may update this privacy policy from time to time. Changes will be
          reflected by updating the &quot;Last updated&quot; date at the top of
          this page. We encourage you to check back periodically.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Contact</h2>
        <p style={paragraphStyle}>
          If you have questions about this privacy policy or your data, please
          open an issue on our{" "}
          <a
            href="https://github.com/pmaier983/sf2g/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub repository
          </a>
          .
        </p>
      </section>
    </div>
  );
}
