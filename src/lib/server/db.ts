import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
export const DB_DIR = path.join(DATA_DIR, 'db');
export const LEGACY_DB_PATH = path.join(DATA_DIR, 'db.json');

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
	version: 1;
	path: string;
	known: string[];
	knownTexts: Record<string, string>;
	paragraphs: Record<string, ParagraphRec>;
	updatedAt: string;
	required?: boolean;
}

interface Cached {
	mtimeMs: number;
	rec: EssayRec;
}

const cache = new Map<string, Cached>();
let migrated = false;

/**
 * One JSON file per essay, mirroring the content tree:
 *   content/books/1. Мапа/[020] Передмова/[010] Передмова.md
 *   data/db/1. Мапа/[020] Передмова/[010] Передмова.json
 *
 * This keeps git diffs and merges local: editing one sentence touches one
 * small file instead of rewriting a multi-megabyte db.json.
 */
export function essayDbPath(relPath: string): string {
	const rel = relPath.replace(/\\/g, '/').replace(/\.md$/i, '.json');
	const abs = path.resolve(DB_DIR, rel);
	if (abs !== DB_DIR && !abs.startsWith(DB_DIR + path.sep)) {
		throw new Error(`bad essay path: ${relPath}`);
	}
	return abs;
}

export function readEssayRec(relPath: string): EssayRec | null {
	migrateLegacyDb();
	const file = essayDbPath(relPath);
	try {
		const stat = fs.statSync(file);
		const hit = cache.get(file);
		if (hit && hit.mtimeMs === stat.mtimeMs) return hit.rec;
		const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as EssayRec;
		if (!raw || raw.version !== 1) return null;
		raw.path = relPath;
		raw.known ??= [];
		raw.knownTexts ??= {};
		raw.paragraphs ??= {};
		cache.set(file, { mtimeMs: stat.mtimeMs, rec: raw });
		return raw;
	} catch {
		return null;
	}
}

export function writeEssayRec(relPath: string, rec: EssayRec): void {
	const file = essayDbPath(relPath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const clean: EssayRec = {
		version: 1,
		path: relPath,
		known: rec.known ?? [],
		knownTexts: rec.knownTexts ?? {},
		paragraphs: rec.paragraphs ?? {},
		updatedAt: rec.updatedAt ?? new Date().toISOString()
	};
	if (rec.required !== undefined) clean.required = rec.required;
	const tmp = file + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(clean, null, '\t') + '\n', 'utf8');
	fs.renameSync(tmp, file);
	cache.set(file, { mtimeMs: fs.statSync(file).mtimeMs, rec: clean });
}

export function deleteEssayRec(relPath: string): boolean {
	const file = essayDbPath(relPath);
	cache.delete(file);
	try {
		fs.unlinkSync(file);
		return true;
	} catch {
		return false;
	}
}

export function essayRecExists(relPath: string): boolean {
	try {
		return fs.statSync(essayDbPath(relPath)).isFile();
	} catch {
		return false;
	}
}

/** Split the old single db.json into per-essay files, once. */
function migrateLegacyDb(): void {
	if (migrated) return;
	migrated = true;
	try {
		if (!fs.existsSync(LEGACY_DB_PATH)) return;
		const parsed = JSON.parse(fs.readFileSync(LEGACY_DB_PATH, 'utf8')) as {
			essays?: Record<string, EssayRec>;
		};
		let count = 0;
		for (const [rel, rec] of Object.entries(parsed.essays ?? {})) {
			try {
				if (essayRecExists(rel)) continue;
				writeEssayRec(rel, rec);
				count++;
			} catch {
				/* a bad path must not abort the whole migration */
			}
		}
		fs.renameSync(LEGACY_DB_PATH, LEGACY_DB_PATH + '.migrated');
		console.log(`[db] migrated ${count} essays to ${DB_DIR}`);
	} catch (err) {
		console.error('[db] legacy migration failed', err);
	}
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
