import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setRequired } from '#lib/server/library';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { paths?: string[]; value?: boolean };
	if (!Array.isArray(body.paths) || body.paths.length === 0) {
		return json({ error: 'paths is required' }, { status: 400 });
	}
	if (typeof body.value !== 'boolean') {
		return json({ error: 'value is required' }, { status: 400 });
	}
	return json({ updated: setRequired(body.paths, body.value) });
};
