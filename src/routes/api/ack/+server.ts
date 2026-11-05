import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ackPaths } from '#lib/server/library';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { paths?: string[] };
	if (!Array.isArray(body.paths) || body.paths.length === 0) {
		return json({ error: 'paths is required' }, { status: 400 });
	}
	return json({ acknowledged: ackPaths(body.paths) });
};
