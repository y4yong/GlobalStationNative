export type ColorScheme = 'light' | 'dark';

const LIGHT_COLORS = {
  bg: '#f5f7f6',
  cardBg: '#ffffff',
  cardBorder: '#e1e8e4',
  cyan: '#176f5a',
  cyanDark: '#245f50',
  cyanSoft: '#e8f3ee',
  gold: '#946318',
  goldSoft: '#fff3d9',
  green: '#24734e',
  greenSoft: '#e7f4eb',
  greenBtn: '#176f5a',
  danger: '#a33c45',
  dangerSoft: '#fbecee',
  textLight: '#1d2d27',
  textMuted: '#52635b',
  textDim: '#708078',
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
