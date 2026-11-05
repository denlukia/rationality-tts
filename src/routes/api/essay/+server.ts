import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEssayView } from '#lib/server/library';

export const GET: RequestHandler = ({ url }) => {
	const path = url.searchParams.get('path');
	if (!path) return json({ error: 'path is required' }, { status: 400 });
	const essay = getEssayView(path);
	if (!essay) return json({ error: 'essay not found' }, { status: 404 });
	return json(essay);
};
