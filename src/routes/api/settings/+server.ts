import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readSettings, writeSettings, type AppSettings } from '#lib/server/settings';

export const GET: RequestHandler = () => json(readSettings());

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Partial<AppSettings>;
	return json(writeSettings(body));
};
