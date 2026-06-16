import { COGNOS_AVATAR_COLORS, type CognosAvatarColor } from '@cognos/ui-angular';
import type { CognosIconName } from '@cognos/ui/icons';

// Curated subset of the icon set offered as user avatars. The account editor
// renders these as the icon picker grid, so the order here is the order shown.
export const avatarIcons = [
  'sparkles',
  'message-square',
  'shield',
  'key-round',
  'laptop',
  'monitor-smartphone',
  'cloud',
  'server',
  'gauge',
  'book-text',
  'graduation-cap',
  'pencil',
  'search',
  'landmark',
  'scale',
  'languages',
  'git-branch',
  'layout-grid',
  'sun',
  'moon',
] as const satisfies readonly CognosIconName[];

export type AvatarIcon = (typeof avatarIcons)[number];

// The avatar palette is shared with the persona avatars (defined in ui-angular).
export const avatarColors = COGNOS_AVATAR_COLORS;
export type AvatarColor = CognosAvatarColor;

export const defaultAvatarIcon: AvatarIcon = 'sparkles';
export const defaultAvatarColor: AvatarColor = 'slate';

// Unknown/missing/legacy values coerce to undefined so the avatar falls back to
// initials until the user explicitly picks an icon.
export function coerceAvatarIcon(value: unknown): AvatarIcon | undefined {
  return typeof value === 'string' && (avatarIcons as readonly string[]).includes(value)
    ? (value as AvatarIcon)
    : undefined;
}

export function coerceAvatarColor(value: unknown): AvatarColor {
  return typeof value === 'string' &&
    (avatarColors as readonly string[]).includes(value)
    ? (value as AvatarColor)
    : defaultAvatarColor;
}
