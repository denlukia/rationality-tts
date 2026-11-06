import { json } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { AUTH_REQUIRED, isAuthed } from '#lib/server/session';

export const handle: Handle = async ({ event, resolve }) => {
	const authed = isAuthed(event.cookies.get('rtts_session'));
	event.locals.authed = authed;
	event.locals.authRequired = AUTH_REQUIRED;

	if (AUTH_REQUIRED && !authed) {
		const path = event.url.pathname;
		const open = path === '/api/session' || path === '/api/session/connect';
		if (!open && (path.startsWith('/api/') || path.startsWith('/audio/'))) {
			return json({ error: 'unauthorized' }, { status: 401 });
		}
	}
	return resolve(event);
};
