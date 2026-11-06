import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const TTS_URL = process.env.TTS_URL ?? 'http://127.0.0.1:8767';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { voice?: string; engine?: string; speed?: number; text?: string; dictionaries?: unknown[] };
	const engine = body.engine === 'drama' ? 'drama' : 'holos';
	const voice = body.voice ?? '';
	if (!voice && engine !== 'drama') return json({ error: 'voice is required' }, { status: 400 });
	try {
		const r = await fetch(`${TTS_URL}/preview`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ voice, engine, speed: body.speed, text: body.text, dictionaries: body.dictionaries }),
			signal: AbortSignal.timeout(180_000)
		});
		if (!r.ok) return json({ error: await r.text() }, { status: 502 });
		const result = (await r.json()) as { file: string; duration: number };
		return json({ url: `/audio/${encodeURIComponent(result.file)}`, file: result.file, duration: result.duration });
	} catch {
		return json({ error: 'TTS server offline' }, { status: 503 });
	}
};
