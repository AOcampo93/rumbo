/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** ArcGIS key for basemap styles, restricted by referrer. Without it the map uses Esri's public tiles. */
  readonly VITE_ARCGIS_API_KEY?: string;
  /** Basemap style used with a key, e.g. "arcgis/navigation". */
  readonly VITE_DEFAULT_BASEMAP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** apps/web/package.json version, injected by Vite. */
declare const __APP_VERSION__: string;
