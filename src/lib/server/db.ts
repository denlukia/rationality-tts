import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
export const DB_PATH = path.join(DATA_DIR, 'db.json');

export interface AudioMeta {
	key: string;
	file: string;
	duration: number;
	text: string;
	at: number;
}

export interface SentenceRec {
	patch?: string;
	audio?: AudioMeta;
}

export interface ParagraphRec {
	text: string;
	sentences: Record<string, SentenceRec>;
}

export interface EssayRec {
	known: string[];
	knownTexts: Record<string, string>;
	paragraphs: Record<string, ParagraphRec>;
	updatedAt: string;
}

export interface Db {
	version: 1;
	essays: Record<string, EssayRec>;
}

let dbCache: Db | null = null;
let dbMtime = 0;

function emptyDb(): Db {
	return { version: 1, essays: {} };
}

export function readDb(): Db {
	try {
		const stat = fs.statSync(DB_PATH);
		if (dbCache && stat.mtimeMs === dbMtime) return dbCache;
		const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) as Db;
		dbCache = raw.version === 1 && raw.essays ? raw : emptyDb();
		dbMtime = stat.mtimeMs;
		return dbCache;
	} catch {
		if (!dbCache) dbCache = emptyDb();
		return dbCache;
	}
}

export function writeDb(db: Db): void {
	fs.mkdirSync(DATA_DIR, { recursive: true });
	const tmp = DB_PATH + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(db, null, '\t') + '\n', 'utf8');
	fs.renameSync(tmp, DB_PATH);
	dbMtime = fs.statSync(DB_PATH).mtimeMs;
	dbCache = db;
}

export function ensureEssay(db: Db, relPath: string, hashes: string[], texts: Record<string, string>): EssayRec {
	let rec = db.essays[relPath];
	if (!rec) {
		rec = { known: [...hashes], knownTexts: { ...texts }, paragraphs: {}, updatedAt: new Date().toISOString() };
		db.essays[relPath] = rec;
		return rec;
	}
	rec.known ??= [];
	rec.knownTexts ??= {};
	rec.paragraphs ??= {};
	return rec;
}

export function audioFile(key: string): string {
	return `${key}.opus`;
}

export function audioPath(file: string): string {
	return path.join(AUDIO_DIR, file);
}

export function audioUrl(file: string): string {
	return `/audio/${encodeURIComponent(file)}`;
}

export function fileExists(file: string): boolean {
	return fs.existsSync(audioPath(file));
}
