import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from 'react-native-geolocation-service';

export interface ViewingLocation {
  latitude: number;
  longitude: number;
}

export async function requestViewingLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return result[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED
      || result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
  }
  if (Platform.OS === 'ios') {
    return (await Geolocation.requestAuthorization('whenInUse')) === 'granted';
  }
  return false;
}

export function getCurrentViewingLocation(): Promise<ViewingLocation | null> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return Promise.resolve(null);
  return new Promise((resolve) => {
    Geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => resolve(null),
      {
        enableHighAccuracy: false,
        timeout: 8_000,
        maximumAge: 60_000,
        accuracy: { android: 'balanced', ios: 'kilometer' },
      },
    );
  });
}
