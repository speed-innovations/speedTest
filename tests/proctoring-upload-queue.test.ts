import { describe, it, expect, vi } from 'vitest'
import { UploadQueue, type QueueItem } from '@/lib/proctoring/client/upload-queue'

/**
 * The upload queue decides what evidence survives a bad network. Its two
 * dangerous failure modes are opposite: retrying forever (the tab accumulates
 * hundreds of MB of unuploaded video) and giving up silently (the reviewer sees
 * a gap and cannot tell why).
 *
 * The clock and the uploader are injected, so backoff is asserted without any
 * real waiting.
 */

let n = 0
function item(id?: string): Omit<QueueItem, 'state' | 'attempts'> {
  const seq = ++n
  return {
    id: id ?? `item-${seq}`,
    kind: 'SCREENSHOT',
    sequence: seq,
    blob: { size: 1000 } as Blob,
    capturedAt: new Date(),
  }
}

/** Collects the sleep durations instead of waiting them out. */
function fakeSleep() {
  const delays: number[] = []
  return {
    delays,
    sleep: (ms: number) => { delays.push(ms); return Promise.resolve() },
  }
}

describe('UploadQueue', () => {
  it('moves an item PENDING -> UPLOADING -> UPLOADED', async () => {
    const seen: string[] = []
    const q = new UploadQueue({
      maxItems: 10, maxRetries: 3, baseDelayMs: 10,
      upload: async i => { seen.push(i.state) },
    })
    q.enqueue(item('a'))
    await q.drain()
    expect(seen).toEqual(['UPLOADING'])
    expect(q.summary().uploaded).toBe(1)
  })

  it('attempts items in FIFO order', async () => {
    const order: string[] = []
    const q = new UploadQueue({
      maxItems: 10, maxRetries: 0, baseDelayMs: 1,
      upload: async i => { order.push(i.id) },
    })
    q.enqueue(item('first'))
    q.enqueue(item('second'))
    q.enqueue(item('third'))
    await q.drain()
    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('retries a transient failure with exponential backoff', async () => {
    const { delays, sleep } = fakeSleep()
    let calls = 0
    const q = new UploadQueue({
      maxItems: 10, maxRetries: 5, baseDelayMs: 100, sleep,
      upload: async () => {
        calls++
        if (calls < 4) throw new Error('network')
      },
    })
    q.enqueue(item('flaky'))
    await q.drain()
    expect(calls).toBe(4)
    // base, 2x, 4x - never an immediate retry against a saturated uplink.
    expect(delays).toEqual([100, 200, 400])
    expect(q.summary().uploaded).toBe(1)
  })

  it('marks an item FAILED after maxRetries and fires onDegraded', async () => {
    const { sleep } = fakeSleep()
    const degraded: string[] = []
    const q = new UploadQueue({
      maxItems: 10, maxRetries: 2, baseDelayMs: 1, sleep,
      upload: async () => { throw new Error('always') },
      onDegraded: i => degraded.push(i.id),
    })
    q.enqueue(item('doomed'))
    await q.drain()
    expect(degraded).toEqual(['doomed'])
    expect(q.summary().failed).toBe(1)
    expect(q.summary().pending).toBe(0)
  })

  it('drops the OLDEST pending item when the bound is reached', async () => {
    // Recent evidence beats old evidence when the network is failing and
    // something has to give.
    const dropped: string[] = []
    const q = new UploadQueue({
      maxItems: 2, maxRetries: 0, baseDelayMs: 1,
      // Never resolves while we fill the queue, so nothing drains underneath us.
      upload: () => new Promise<void>(() => {}),
      onDropped: i => dropped.push(i.id),
    })
    q.enqueue(item('oldest'))   // goes straight to UPLOADING and stays there
    q.enqueue(item('middle'))
    q.enqueue(item('newest'))   // queue is full: evicts the oldest PENDING one

    expect(dropped).toEqual(['middle'])
    expect(q.order()).toEqual(['oldest', 'newest'])
    expect(q.summary().dropped).toBe(1)
  })

  it('never evicts an item that is already in flight', async () => {
    const dropped: string[] = []
    const releases: Array<() => void> = []
    let blocking = true
    const q = new UploadQueue({
      maxItems: 1, maxRetries: 0, baseDelayMs: 1,
      upload: () => blocking
        ? new Promise<void>(r => { releases.push(r) })
        : Promise.resolve(),
      onDropped: i => dropped.push(i.id),
    })
    q.enqueue(item('inflight'))
    q.enqueue(item('queued'))
    // 'inflight' is UPLOADING, so it is not a candidate for eviction even
    // though it is the oldest; there was no PENDING item to drop.
    expect(dropped).toEqual([])
    expect(q.order()).toEqual(['inflight', 'queued'])

    // Let everything finish, so the queue is not left with a promise that never
    // settles - draining otherwise waits on 'queued' forever.
    blocking = false
    releases.forEach(r => r())
    await q.drain()
  })

  it('uploads one at a time so a segment never competes with a screenshot', async () => {
    let concurrent = 0
    let peak = 0
    const q = new UploadQueue({
      maxItems: 10, maxRetries: 0, baseDelayMs: 1,
      upload: async () => {
        concurrent++
        peak = Math.max(peak, concurrent)
        await Promise.resolve()
        concurrent--
      },
    })
    q.enqueue(item())
    q.enqueue(item())
    q.enqueue(item())
    await q.drain()
    expect(peak).toBe(1)
  })

  it('drain() resolves once every item is terminal', async () => {
    const { sleep } = fakeSleep()
    const q = new UploadQueue({
      maxItems: 10, maxRetries: 1, baseDelayMs: 1, sleep,
      upload: async i => { if (i.id === 'bad') throw new Error('no') },
    })
    q.enqueue(item('good'))
    q.enqueue(item('bad'))
    await q.drain()
    const s = q.summary()
    expect(s.pending).toBe(0)
    expect(s.uploading).toBe(0)
    expect(s.uploaded).toBe(1)
    expect(s.failed).toBe(1)
  })

  it('reports a summary on every state change', async () => {
    const summaries: number[] = []
    const q = new UploadQueue({
      maxItems: 10, maxRetries: 0, baseDelayMs: 1,
      upload: async () => {},
      onStateChange: s => summaries.push(s.uploaded),
    })
    q.enqueue(item())
    await q.drain()
    expect(summaries.length).toBeGreaterThan(1)
    expect(summaries[summaries.length - 1]).toBe(1)
  })

  it('drain() on an empty queue resolves immediately', async () => {
    const q = new UploadQueue({
      maxItems: 10, maxRetries: 0, baseDelayMs: 1, upload: async () => {},
    })
    await expect(q.drain()).resolves.toBeUndefined()
  })
})
