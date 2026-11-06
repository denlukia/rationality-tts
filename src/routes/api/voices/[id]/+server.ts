import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const TTS_URL = process.env.TTS_URL ?? 'http://127.0.0.1:8767';

export const DELETE: RequestHandler = async ({ params }) => {
	const kind = params.id.startsWith('drama-') ? 'drama' : 'custom';
	try {
		const r = await fetch(`${TTS_URL}/voices/${kind}/${encodeURIComponent(params.id)}`, {
			method: 'DELETE',
			signal: AbortSignal.timeout(5000)
		});
		if (!r.ok) return json({ error: await r.text() }, { status: 502 });
		return json(await r.json());
	} catch {
		return json({ error: 'TTS server offline' }, { status: 503 });
	}
};
