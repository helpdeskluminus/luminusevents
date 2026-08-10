export type SessionType = 'competition' | 'webinar' | 'workshop' | 'other';

export const SESSION_TYPES: { value: SessionType; label: string }[] = [
  { value: 'competition', label: 'Competition' },
  { value: 'webinar', label: 'Webinar' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'other', label: 'Other' },
];

/** Display label for a session, respecting the custom label set on 'other'. */
export function sessionTypeLabel(sessionType: string | null | undefined, typeLabel?: string | null): string {
  if (sessionType === 'other') return (typeLabel || '').trim() || 'Session';
  return SESSION_TYPES.find((t) => t.value === sessionType)?.label ?? 'Session';
}

/** Brand accent per type, used for badges (Tailwind classes) and the email (hex). */
export const SESSION_TYPE_STYLE: Record<SessionType, { badgeClass: string; emailHex: string; emailHexSecondary: string }> = {
  competition: { badgeClass: 'bg-primary/10 text-primary', emailHex: '#ec1cb4', emailHexSecondary: '#7c3aed' },
  webinar: { badgeClass: 'bg-sky-500/10 text-sky-600', emailHex: '#0ea5e9', emailHexSecondary: '#6366f1' },
  workshop: { badgeClass: 'bg-amber-500/10 text-amber-600', emailHex: '#f59e0b', emailHexSecondary: '#ec1cb4' },
  other: { badgeClass: 'bg-violet-500/10 text-violet-600', emailHex: '#8b5cf6', emailHexSecondary: '#ec1cb4' },
};

export function sessionTypeStyle(sessionType: string | null | undefined) {
  return SESSION_TYPE_STYLE[(sessionType as SessionType) ?? 'competition'] ?? SESSION_TYPE_STYLE.competition;
}
