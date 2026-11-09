export interface BuildInfo {
  commitHash: string | null
  committedAt: string | null
  builtAt: string
}

// Replaced by Vite at build time; viewing or refreshing the page never changes it.
declare const __BUILD_INFO__: BuildInfo
export const buildInfo = __BUILD_INFO__
