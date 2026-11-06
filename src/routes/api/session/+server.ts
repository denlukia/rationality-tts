import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAuthed, publicInfo, sessionInfo } from '#lib/server/session';

export const GET: RequestHandler = async ({ cookies }) => {
	const authed = isAuthed(cookies.get('rtts_session'));
	if (!authed) return json(await publicInfo(false));
	return json(await sessionInfo(true));
};
