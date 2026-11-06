import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const TTS_URL = process.env.TTS_URL ?? 'http://127.0.0.1:8767';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { text?: string };
	if (!body.text?.trim()) return json({ error: 'text is required' }, { status: 400 });
	try {
		const r = await fetch(`${TTS_URL}/ipa`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: body.text }),
			signal: AbortSignal.timeout(30000)
		});
		if (!r.ok) return json({ error: await r.text() }, { status: 502 });
		return json(await r.json());
	} catch {
		return json({ error: 'TTS server offline' }, { status: 503 });
	}
};
