import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { audioKey, effectiveText, getSentence, getSentenceState, saveAudio } from '#lib/server/library';
import { audioFile } from '#lib/server/db';
import { verbalizeNumbers } from '#lib/server/text';

const TTS_URL = process.env.TTS_URL ?? 'http://127.0.0.1:8767';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { path?: string; pi?: number; si?: number; force?: boolean };
	if (!body.path || typeof body.pi !== 'number' || typeof body.si !== 'number') {
		return json({ error: 'path, pi and si are required' }, { status: 400 });
	}
	const found = getSentence(body.path, body.pi, body.si);
	if (!found) return json({ error: 'sentence not found' }, { status: 404 });

	const current = getSentenceState(body.path, body.pi, body.si);
	if (current?.status === 'done' && current.audio && !body.force) {
		return json({ ...current, cached: true });
	}

	const state = getSentenceState(body.path, body.pi, body.si);
	const patch = state?.patch ?? '';
	const text = effectiveText(found.sentence.text, patch);
	const spoken = verbalizeNumbers(text);
	const key = audioKey(text);
	const expected = audioFile(key);

	let response: Response;
	try {
		response = await fetch(`${TTS_URL}/synth`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: spoken, key, voice: process.env.HOLOS_VOICE ?? 'Speaker_84' }),
			signal: AbortSignal.timeout(180_000)
		});
	} catch {
		return json(
			{
				error:
					'TTS сервер не запущений. Запустіть `bun run tts` (або python tts/server.py) і спробуйте ще раз.'
			},
			{ status: 503 }
		);
	}
	if (!response.ok) {
		const detail = await response.text();
		return json({ error: `TTS: ${detail.slice(0, 500)}` }, { status: 502 });
	}
	const result = (await response.json()) as { file?: string; duration?: number; engine?: string };
	const file = result.file ?? expected;
	const duration = result.duration ?? 0;
	if (file !== expected) {
		// The server may fall back to WAV when ffmpeg is unavailable.
		const ext = file.includes('.') ? file.split('.').pop() : 'opus';
		if (!['opus', 'wav', 'flac'].includes(ext ?? '')) {
			return json({ error: `unexpected audio file ${file}` }, { status: 502 });
		}
	}
	const saved = saveAudio(body.path, body.pi, body.si, {
		key,
		file,
		duration,
		text,
		at: Date.now()
	});
	if (!saved) return json({ error: 'could not save audio' }, { status: 500 });
	return json({ ...saved, cached: false, engine: result.engine ?? 'holos' });
};

export const GET: RequestHandler = async () => {
	try {
		const r = await fetch(`${TTS_URL}/health`, { signal: AbortSignal.timeout(2500) });
		return json(await r.json());
	} catch {
		return json({ engine: null, ready: false, error: 'offline' }, { status: 503 });
	}
};
