import { Redis } from '@upstash/redis'

export class BoardStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BoardStoreError'
  }
}

let client: Redis | null = null

export function getRedis(): Redis {
  if (client) return client
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    throw new BoardStoreError('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.')
  }
  client = new Redis({ url, token })
  return client
}
