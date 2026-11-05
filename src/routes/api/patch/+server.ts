import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { savePatch } from '#lib/server/library';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { path?: string; pi?: number; si?: number; patch?: string };
	if (!body.path || typeof body.pi !== 'number' || typeof body.si !== 'number') {
		return json({ error: 'path, pi and si are required' }, { status: 400 });
	}
	const state = savePatch(body.path, body.pi, body.si, body.patch ?? '');
	if (!state) return json({ error: 'sentence not found' }, { status: 404 });
	return json(state);
};
