const ERROR_MESSAGES: Record<string, string> = {
  cancelled: 'Connection cancelled — the provider authorization was declined. Nothing was stored.',
  expired: 'This authorization expired before it was used. Start over to reconnect.',
  unsupported: 'This platform does not support account connections.',
  not_configured: 'OAuth credentials for this platform are not configured on the server.',
  forbidden: 'Your role cannot connect social accounts.',
  no_page: 'No Facebook Pages grant this app content permission. Publishing needs a Page role with content rights.',
  failed: 'The connection failed before it completed. Try again.',
  auth: 'Sign in to connect social accounts.',
  unavailable: 'The connection service is unavailable. Try again shortly.',
  invalid: 'Invalid callback from the provider. Start over to reconnect.',
  platform: 'Unknown platform.',
};

function platformLabel(platform: string): string {
  const labels: Record<string, string> = {
    tiktok: 'TikTok',
    youtube: 'YouTube',
    pinterest: 'Pinterest',
    linkedin: 'LinkedIn',
    instagram: 'Instagram',
    facebook: 'Facebook',
  };
  return labels[platform] ?? platform;
}

/** Notices for OAuth redirect outcomes (?connected= / ?error=). */
export function SocialNotices({ connected, error }: { connected?: string; error?: string }) {
  if (connected) {
    return (
      <p aria-live="polite" className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3 text-sm text-emerald-100">
        {platformLabel(connected)} connected. Tokens are stored encrypted and never leave the server.
      </p>
    );
  }
  if (error) {
    return (
      <p aria-live="polite" className="rounded-xl border border-amber-300/25 bg-amber-400/10 p-3 text-sm text-amber-100">
        {ERROR_MESSAGES[error] ?? 'Something went wrong with the connection. Try again.'}
      </p>
    );
  }
  return null;
}
