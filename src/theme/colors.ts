export type ColorScheme = 'light' | 'dark';

const LIGHT_COLORS = {
  bg: '#f6f4ef',
  cardBg: '#fffefa',
  cardBorder: '#e8e3d9',
  cyan: '#286b57',
  cyanDark: '#1c5745',
  cyanSoft: '#e8f1eb',
  gold: '#98692c',
  goldSoft: '#f8efdf',
  green: '#286b57',
  greenSoft: '#e8f1eb',
  greenBtn: '#286b57',
  danger: '#a4494b',
  dangerSoft: '#f8ecea',
  textLight: '#20322b',
  textMuted: '#55665d',
  textDim: '#78847c',
} as const;

const DARK_COLORS = {
  bg: '#101714',
  cardBg: '#19221e',
  cardBorder: '#2b3932',
  cyan: '#65d3ab',
  cyanDark: '#26785e',
  cyanSoft: '#203b31',
  gold: '#edc26f',
  goldSoft: '#44351d',
  green: '#70d39a',
  greenSoft: '#20392b',
  greenBtn: '#26785e',
  danger: '#ff8b91',
  dangerSoft: '#42262b',
  textLight: '#edf5f0',
  textMuted: '#b4c3ba',
  textDim: '#91a198',
} as const;

export type ColorPalette = { [Key in keyof typeof LIGHT_COLORS]: string };

export let COLORS: ColorPalette = LIGHT_COLORS;

export function setColorScheme(scheme: ColorScheme): void {
  COLORS = scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}
