// The only file of this package that talks to a browser API (see eslint.config.js).
import type { PositionSource, PositionSourceErrorCode } from '../types.ts';

/** The slice of the Geolocation API the source needs, so tests can pass a fake. */
export interface GeolocationLike {
  watchPosition(
    success: (position: {
      coords: {
        latitude: number;
        longitude: number;
        accuracy: number;
        heading: number | null;
        speed: number | null;
      };
      timestamp: number;
    }) => void,
    error: (error: { code: number; message: string }) => void,
    options?: { enableHighAccuracy?: boolean; maximumAge?: number; timeout?: number },
  ): number;
  clearWatch(id: number): void;
}

export interface GeolocationSourceOptions {
  enableHighAccuracy?: boolean;
  /** Ms a cached reading may be reused. Default 2000. */
  maximumAge?: number;
  /** Ms to wait for a reading before a TIMEOUT error. Default 20000. */
  timeout?: number;
  /** Defaults to navigator.geolocation. */
  geolocation?: GeolocationLike;
}

/** GeolocationPositionError codes (1-3) mapped to the engine's codes. */
const ERROR_CODES: Record<number, PositionSourceErrorCode> = {
  1: 'PERMISSION_DENIED',
  2: 'POSITION_UNAVAILABLE',
  3: 'TIMEOUT',
};

/**
 * Real GPS through navigator.geolocation.watchPosition (§8.1). Works only in
 * the foreground and over HTTPS; with the screen locked the browser stops
 * delivering readings, which the engine reports as a lost signal.
 */
export function createGeolocationSource(options: GeolocationSourceOptions = {}): PositionSource {
  const geolocation =
    options.geolocation ??
    (globalThis as { navigator?: { geolocation?: GeolocationLike } }).navigator?.geolocation;
  let watchId: number | null = null;

  return {
    kind: 'gps',
    trusted: false,
    start(onSample, onError) {
      if (!geolocation) {
        onError({ code: 'UNSUPPORTED', message: 'This browser has no geolocation' });
        return;
      }
      if (watchId !== null) return;
      watchId = geolocation.watchPosition(
        ({ coords, timestamp }) =>
          onSample({
            lat: coords.latitude,
            lng: coords.longitude,
            accuracy: coords.accuracy,
            timestamp,
            heading: coords.heading,
            speed: coords.speed,
          }),
        (error) =>
          onError({
            code: ERROR_CODES[error.code] ?? 'POSITION_UNAVAILABLE',
            message: error.message,
          }),
        {
          enableHighAccuracy: options.enableHighAccuracy ?? true,
          maximumAge: options.maximumAge ?? 2000,
          timeout: options.timeout ?? 20000,
        },
      );
    },
    stop() {
      if (watchId === null) return;
      geolocation?.clearWatch(watchId);
      watchId = null;
    },
  };
}
