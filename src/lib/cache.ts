/**
 * 프로세스 내 TTL 캐시.
 *
 * KIPRIS Plus는 호출량에 한도(및 과금)가 걸린다. verify_citations가 답변 하나에서
 * 번호 20개를 뽑으면 그것만으로 20회를 쓴다. 같은 번호를 두 번 묻지 않는 것이
 * 기능이 아니라 생존 조건이다.
 */

interface Entry<T> {
  value: T
  expires: number
}

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>()

  constructor(
    private ttlMs: number,
    private maxEntries = 500
  ) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key)
    if (!hit) return undefined
    if (Date.now() > hit.expires) {
      this.store.delete(key)
      return undefined
    }
    // LRU 근사: 조회된 항목을 뒤로 보낸다
    this.store.delete(key)
    this.store.set(key, hit)
    return hit.value
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs })
  }

  get size(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }
}
