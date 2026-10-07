import Basemap from '@arcgis/core/Basemap.js';
import esriConfig from '@arcgis/core/config.js';
import TileLayer from '@arcgis/core/layers/TileLayer.js';
import type { BasemapKind, MapTheme } from './types.ts';

// Basemaps (PROJECT_PLAN §10.3). With VITE_ARCGIS_API_KEY (restricted by
// referrer) the app uses Esri's vector basemap styles. Without it, the
// public ArcGIS Online tile services the mockups were drawn on: same look,
// no key. Esri's attribution is always shown by the map component.

const API_KEY = import.meta.env.VITE_ARCGIS_API_KEY?.trim() ?? '';
if (API_KEY) esriConfig.apiKey = API_KEY;

export const hasApiKey = API_KEY.length > 0;

const PUBLIC_TILES = {
  streets: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer',
  topo: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer',
  darkBase:
    'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer',
  darkLabels:
    'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer',
} as const;

export function createBasemap(kind: BasemapKind, theme: MapTheme): Basemap | string {
  if (hasApiKey) {
    if (theme === 'dark') return 'arcgis/navigation-night';
    if (kind === 'topo') return 'arcgis/topographic';
    return import.meta.env.VITE_DEFAULT_BASEMAP?.trim() || 'arcgis/navigation';
  }
  if (theme === 'dark') {
    return new Basemap({
      baseLayers: [new TileLayer({ url: PUBLIC_TILES.darkBase })],
      referenceLayers: [new TileLayer({ url: PUBLIC_TILES.darkLabels })],
    });
  }
  return new Basemap({ baseLayers: [new TileLayer({ url: PUBLIC_TILES[kind] })] });
}
