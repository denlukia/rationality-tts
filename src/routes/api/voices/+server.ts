import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const TTS_URL = process.env.TTS_URL ?? 'http://127.0.0.1:8767';

export const GET: RequestHandler = async ({ url }) => {
	const engine = url.searchParams.get('engine') === 'drama' ? 'drama' : 'holos';
	try {
		const r = await fetch(`${TTS_URL}/voices?engine=${engine}`, { signal: AbortSignal.timeout(5000) });
		return json(await r.json());
	} catch {
		return json({ presets: [], custom: {}, drama: {}, all: [], drama_all: [] }, { status: 503 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) return json({ error: 'file is required' }, { status: 400 });
	const name = String(form.get('name') ?? 'custom');
	const fd = new FormData();
	fd.append('file', file, file.name);
	fd.append('name', name);
	try {
		const r = await fetch(`${TTS_URL}/voices/custom`, { method: 'POST', body: fd, signal: AbortSignal.timeout(120000) });
		if (!r.ok) return json({ error: await r.text() }, { status: 502 });
		return json(await r.json());
	} catch {
		return json({ error: 'TTS server offline' }, { status: 503 });
	}
};
