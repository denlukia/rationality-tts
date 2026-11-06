import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { connect, createSession } from '#lib/server/session';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = (await request.json().catch(() => ({}))) as { token?: string; repo?: string };
	try {
		const result = await connect(body.token ?? '', body.repo);
		cookies.set('rtts_session', createSession(), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 24 * 3600,
			// The tunnel is HTTPS, but adapter-node may see the request as HTTP.
			// A non-secure cookie still travels over HTTPS, so this is the safe default.
			secure: false
		});
		return json({ ok: true, ...result });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
