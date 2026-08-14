import type { ApertureApi } from './index'

declare global {
  interface Window {
    aperture: ApertureApi
  }
}

export {}
