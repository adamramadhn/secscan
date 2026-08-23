import { withAuth } from '@/lib/require-auth';
import { getJob, getJobSkills } from '@/lib/db';

const POLL_INTERVAL_MS = 2000;
const HARD_STOP_MS = 30 * 60 * 1000; // 30 menit

function ssePayload(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function snapshot(id: string): { job: ReturnType<typeof getJob>; jobSkills: ReturnType<typeof getJobSkills> } {
  const jobSkills = getJobSkills(id);
  const job = getJob(id);
  return { job, jobSkills };
}

export const GET = withAuth(async (req: Request, ctx) => {
  const { id } = await ctx!.params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let hardStopId: ReturnType<typeof setTimeout> | null = null;
      let closed = false;

      const cleanup = () => {
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
        if (hardStopId !== null) {
          clearTimeout(hardStopId);
          hardStopId = null;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // stream sudah ditutup client — abaikan
        }
      };

      const send = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          // client disconnect → enqueue throw
          close();
          return false;
        }
      };

      // Client disconnect (abort) → hentikan polling & tutup stream.
      req.signal.addEventListener('abort', close);

      // Hard-stop 30 menit supaya stream tidak menggantung selamanya.
      hardStopId = setTimeout(close, HARD_STOP_MS);

      const tick = () => {
        const { job, jobSkills } = snapshot(id);

        if (!job) {
          send(ssePayload('error', { error: 'not_found' }));
          close();
          return;
        }

        let skillsParsed: unknown = [];
        try {
          skillsParsed = JSON.parse(job.skills_json);
        } catch {
          skillsParsed = [];
        }

        if (!send(ssePayload('data', { job: { ...job, skills: skillsParsed }, jobSkills }))) return;

        if (job.status === 'done' || job.status === 'failed') {
          send(ssePayload('end', { status: job.status }));
          close();
        }
      };

      // Event pertama langsung, lalu tiap 2 detik.
      tick();
      if (!closed) {
        intervalId = setInterval(tick, POLL_INTERVAL_MS);
      }
    },
    cancel() {
      // cancel() dipanggil runtime saat client disconnect; interval cleanup
      // sudah ditangani lewat listener abort + guard closed di start().
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
