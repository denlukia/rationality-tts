import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const TTS_URL = process.env.TTS_URL ?? 'http://127.0.0.1:8767';

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) return json({ error: 'file is required' }, { status: 400 });
	const refText = String(form.get('ref_text') ?? '').trim();
	if (!refText) return json({ error: 'потрібен текст референсного аудіо' }, { status: 400 });
	const fd = new FormData();
	fd.append('file', file, file.name);
	fd.append('name', String(form.get('name') ?? file.name.replace(/\.[^.]+$/, '')));
	fd.append('ref_text', refText);
	try {
		const r = await fetch(`${TTS_URL}/voices/drama`, { method: 'POST', body: fd, signal: AbortSignal.timeout(120000) });
		if (!r.ok) return json({ error: await r.text() }, { status: 502 });
		return json(await r.json());
	} catch {
		return json({ error: 'TTS server offline' }, { status: 503 });
	}
};
