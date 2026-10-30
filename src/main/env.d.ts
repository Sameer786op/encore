/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  /** the Client ID of Vyse Music's own Spotify app, from .env.local when a release is built */
  readonly MAIN_VITE_SPOTIFY_CLIENT_ID?: string;
}
