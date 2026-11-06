import fs from 'node:fs';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { audioDiskPath } from '#lib/server/library';

const TYPES: Record<string, string> = {
	opus: 'audio/ogg; codecs=opus',
	wav: 'audio/wav',
	flac: 'audio/flac'
};

export const GET: RequestHandler = ({ params }) => {
	const file = params.file;
	if (!/^[a-zA-Z0-9_-]+\.(opus|wav|flac)$/.test(file)) throw error(404, 'not found');
	const full = audioDiskPath(file);
	if (!fs.existsSync(full)) throw error(404, 'not found');
	const ext = file.split('.').pop() ?? '';
	const data = fs.readFileSync(full);
	return new Response(new Uint8Array(data), {
		headers: {
			'content-type': TYPES[ext] ?? 'application/octet-stream',
			'content-length': String(data.length),
			'cache-control': 'public, max-age=31536000, immutable'
		}
	});
};
