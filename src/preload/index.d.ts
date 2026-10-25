import type { EncoreApi } from "../shared/types";

declare global {
  interface Window {
    encore: EncoreApi;
  }
}

export {};
