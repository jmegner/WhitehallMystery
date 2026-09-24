export interface WorkerEnv {
  GAME_ROOMS: DurableObjectNamespace
  CREATE_GAME_LIMITER: RateLimit
  CONNECT_LIMITER: RateLimit
  SESSION_LIMITER: RateLimit
  ALLOWED_ORIGINS: string
  ROOM_TTL_DAYS: string
}
