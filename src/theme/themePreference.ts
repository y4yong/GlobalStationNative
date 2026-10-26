import * as Keychain from 'react-native-keychain';
import { ColorScheme } from './colors';

const SERVICE = 'com.globalstationnative.appearance';

export async function readColorSchemePreference(): Promise<ColorScheme | null> {
  const credentials = await Keychain.getGenericPassword({ service: SERVICE });
  if (!credentials) return null;
  if (credentials.password === 'light' || credentials.password === 'dark') {
    return credentials.password;
  }
  throw new Error('The saved appearance preference is invalid.');
}

export async function saveColorSchemePreference(scheme: ColorScheme): Promise<void> {
  await Keychain.setGenericPassword('appearance', scheme, { service: SERVICE });
}
