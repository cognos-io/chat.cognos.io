export declare const THEME_ATTRIBUTE: 'data-theme';
export declare const ACCENT_ATTRIBUTE: 'data-accent';
export declare const FONT_CUSTOM_PROPERTY: '--cog-font';

export declare const THEMES: readonly ['light', 'dark'];
export declare const ACCENTS: readonly ['emerald', 'blue'];
export declare const FONTS: readonly ['system', 'atkinson', 'inter', 'noto'];

export type CognosTheme = (typeof THEMES)[number];
export type CognosAccent = (typeof ACCENTS)[number];
export type CognosFont = (typeof FONTS)[number];

export interface ApplyThemeOptions {
  theme?: CognosTheme;
  accent?: CognosAccent;
  font?: CognosFont;
}

export declare function getFontCustomProperty(font: CognosFont): string;
export declare function applyTheme(
  target: HTMLElement,
  options?: ApplyThemeOptions,
): void;
export declare function clearFontOverride(target: HTMLElement): void;
