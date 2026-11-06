import type { LayoutServerLoad } from './$types';
import { emptyLibrary, getLibrary } from '#lib/server/library';
import { engineLocked, readSettings } from '#lib/server/settings';
import { AUTH_REQUIRED, isAuthed } from '#lib/server/session';

export const load: LayoutServerLoad = ({ cookies }) => {
	const authed = isAuthed(cookies.get('rtts_session'));
	const auth = { required: AUTH_REQUIRED, authed };
	const locked = engineLocked();
	const settings = readSettings();

	if (auth.required && !auth.authed) {
		return { auth, engineLocked: locked, library: emptyLibrary(), settings };
	}
	return { auth, engineLocked: locked, library: getLibrary(), settings };
};
