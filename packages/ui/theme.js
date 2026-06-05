export const THEME_ATTRIBUTE = 'data-theme';
export const ACCENT_ATTRIBUTE = 'data-accent';
export const FONT_CUSTOM_PROPERTY = '--cog-font';

export const THEMES = ['light', 'dark'];
export const ACCENTS = ['emerald', 'blue'];
export const FONTS = ['system', 'atkinson', 'inter', 'noto'];

const fontCustomProperties = {
  system: '--cog-font-system',
  atkinson: '--cog-font-atkinson',
  inter: '--cog-font-inter',
  noto: '--cog-font-noto',
};

export function getFontCustomProperty(font) {
  return fontCustomProperties[font] ?? fontCustomProperties.system;
}

export function applyTheme(target, options = {}) {
  const { theme, accent, font } = options;

  if (theme) {
    target.setAttribute(THEME_ATTRIBUTE, theme);
  }

  if (accent) {
    target.setAttribute(ACCENT_ATTRIBUTE, accent);
  }

  if (font) {
    target.style.setProperty(
      FONT_CUSTOM_PROPERTY,
      `var(${getFontCustomProperty(font)})`,
    );
  }
}

export function clearFontOverride(target) {
  target.style.removeProperty(FONT_CUSTOM_PROPERTY);
}
