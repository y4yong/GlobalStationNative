import * as Keychain from 'react-native-keychain';
import { UserRole } from '../../data/models/Drama';

const SERVICE = 'com.globalstationnative.session';

export interface SecureSession {
  jwt: string;
  role: UserRole;
  fingerprint: string;
}

export async function saveSession(session: SecureSession): Promise<void> {
  await Keychain.setGenericPassword('session', JSON.stringify(session), { service: SERVICE, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export async function readSession(): Promise<SecureSession | null> {
  const credentials = await Keychain.getGenericPassword({ service: SERVICE });
  if (!credentials) return null;
  return JSON.parse(credentials.password) as SecureSession;
}

export async function clearSession(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE });
}

export function createSessionFingerprint(): string {
  return `gs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
