import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { commit } from '#lib/server/session';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { message?: string };
	try {
		return json(await commit(body.message));
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 409 });
	}
};
