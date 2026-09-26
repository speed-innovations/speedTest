import { describe, it, expect, vi } from 'vitest'
import { EventQueue, type WireEvent } from '@/lib/proctoring/client/event-queue'

let n = 0
function ev(type: WireEvent['type'] = 'LOOKING_LEFT', severity: WireEvent['severity'] = 'WARN'): WireEvent {
  return { clientEventId: `evt-queue-${n++}`, type, startedAt: new Date().toISOString(), severity }
}

describe('EventQueue', () => {
  it('sends batches no larger than the batch size', async () => {
    const send = vi.fn((_batch: WireEvent[], _opts: { keepalive: boolean }) => Promise.resolve(true))
    const q = new EventQueue({ send, batchSize: 3, perTypeMax: 100 })
    for (let i = 0; i < 7; i++) q.push(ev())
    await q.flush()
    expect(send.mock.calls.map(c => (c[0] as WireEvent[]).length)).toEqual([3, 3, 1])
    expect(q.size).toBe(0)
  })

  it('never holds more than maxSize, evicting INFO before WARN', () => {
    const q = new EventQueue({ send: () => Promise.resolve(true), maxSize: 3, perTypeMax: 100 })
    q.push(ev('TAB_VISIBLE', 'INFO'))
    q.push(ev('LOOKING_LEFT'))
    q.push(ev('LOOKING_RIGHT'))
    q.push(ev('MULTIPLE_FACES'))
    expect(q.size).toBe(3)
    expect(q.dropped).toBe(1)
  })

  it('caps each type per window, so a stuck condition cannot spam', () => {
    let now = 0
    const q = new EventQueue({ send: () => Promise.resolve(true), perTypeMax: 5, perTypeWindowMs: 60_000, now: () => now })
    const accepted = [0, 1, 2, 3, 4, 5, 6].map(() => q.push(ev('WINDOW_BLUR')))
    expect(accepted).toEqual([true, true, true, true, true, false, false])
    expect(q.push(ev('LOOKING_LEFT'))).toBe(true) // other types unaffected
    now = 61_000
    expect(q.push(ev('WINDOW_BLUR'))).toBe(true)
  })

  it('keeps a failed batch for the next flush, still bounded', async () => {
    const send = vi.fn(() => Promise.resolve(false))
    const q = new EventQueue({ send, maxSize: 5, perTypeMax: 100 })
    for (let i = 0; i < 4; i++) q.push(ev())
    await q.flush()
    expect(q.size).toBe(4)
    send.mockImplementation(() => Promise.resolve(true))
    await q.flush()
    expect(q.size).toBe(0)
  })

  it('treats a throwing sender as a failure, not a crash', async () => {
    const q = new EventQueue({ send: () => Promise.reject(new Error('offline')), perTypeMax: 100 })
    q.push(ev())
    await expect(q.flush()).resolves.toBeUndefined()
    expect(q.size).toBe(1)
  })

  it('is single-flight: overlapping flushes share one drain', async () => {
    let release: (v: boolean) => void = () => undefined
    const send = vi.fn(() => new Promise<boolean>(r => { release = r }))
    const q = new EventQueue({ send, perTypeMax: 100 })
    q.push(ev())
    const a = q.flush()
    const b = q.flush()
    release(true)
    await Promise.all([a, b])
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('passes keepalive through for the pagehide flush', async () => {
    const send = vi.fn((_batch: WireEvent[], _opts: { keepalive: boolean }) => Promise.resolve(true))
    const q = new EventQueue({ send, perTypeMax: 100 })
    q.push(ev())
    await q.flush({ keepalive: true })
    expect(send.mock.calls[0][1]).toEqual({ keepalive: true })
  })

  it('refuses events after close, and forgets what it held', () => {
    const q = new EventQueue({ send: () => Promise.resolve(true), perTypeMax: 100 })
    q.push(ev())
    q.close()
    expect(q.size).toBe(0)
    expect(q.push(ev())).toBe(false)
  })
})
