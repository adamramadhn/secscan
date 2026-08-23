import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const QUEUE_NAME = 'secscan-jobs';

let queueInstance: Queue | null = null;

/**
 * Singleton BullMQ Queue. Redis connection dibuat lazy — baru terhubung
 * saat getQueue() pertama kali dipanggil (bukan saat modul di-import).
 */
export function getQueue(): Queue {
  if (queueInstance) return queueInstance;
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/5';
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  queueInstance = new Queue(QUEUE_NAME, { connection });
  queueInstance.on('error', (err) => {
    // Jangan crash route karena koneksi Redis bermasalah; cukup log.
    console.error('[jobs] BullMQ queue error:', err?.message ?? err);
  });
  return queueInstance;
}

/**
 * Enqueue job scan. jobId dipakai sebagai jobId BullMQ (dedupe di sisi queue)
 * sekaligus isi payload untuk worker.
 */
export async function enqueueScan(jobId: string): Promise<void> {
  const queue = getQueue();
  await queue.add(
    'scan',
    { jobId },
    {
      jobId,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 500 },
      attempts: 1,
    },
  );
}