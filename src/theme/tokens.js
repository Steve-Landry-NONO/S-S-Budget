/**
 * Duo Budget V3 — Premium Duo.
 * Design reference: Figma Duo Budget V3.0 Premium Duo.
 * Keep semantic tokens separate from financial business logic.
 */
export const palette = Object.freeze({
  midnight: '#0F1C2E',
  signature: '#5775E8',
  positive: '#2BAA89',
  amber: '#E9A14E',
  background: '#F7F8FA',
  surface: '#FFFFFF',
  danger: '#C84B59',
  muted: '#596A81',
  border: '#E6EBF2',
  lightBlue: '#EEF2FF',
  lightGreen: '#E8F8F1',
});

export const spacing = Object.freeze({ xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 40 });
export const radius = Object.freeze({ sm: 8, md: 12, lg: 18, xl: 24, pill: 999 });
export const typography = Object.freeze({
  hero: { fontSize: 34, fontWeight: '700', lineHeight: 41 },
  heading: { fontSize: 26, fontWeight: '700', lineHeight: 32 },
  section: { fontSize: 19, fontWeight: '700', lineHeight: 26 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  label: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  amount: { fontSize: 30, fontWeight: '700', lineHeight: 38 },
});

export const themes = Object.freeze({
  light: {
    background: palette.background,
    surface: palette.surface,
    surfaceRaised: palette.surface,
    text: palette.midnight,
    mutedText: palette.muted,
    border: palette.border,
    primary: palette.signature,
    primaryContrast: palette.surface,
    card: palette.midnight,
    cardText: palette.surface,
    positive: palette.positive,
    warning: palette.amber,
    danger: palette.danger,
  },
  dark: {
    background: '#091320',
    surface: '#16253A',
    surfaceRaised: '#1B2C43',
    text: '#F7F8FA',
    mutedText: '#B2C0D5',
    border: '#30415A',
    primary: '#8DA1FF',
    primaryContrast: '#091320',
    card: '#233858',
    cardText: '#FFFFFF',
    positive: '#55D4B0',
    warning: '#F5BE68',
    danger: '#FF8C96',
  },
});
