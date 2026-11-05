import fs from 'node:fs';
import path from 'node:path';
import { hashText, splitParagraphs, splitSentences } from './text';

export const BOOKS_ROOT = path.resolve(process.env.CONTENT_DIR ?? path.join('content', 'books'));

export interface ParsedSentence {
	hash: string;
	text: string;
}

export interface ParsedParagraph {
	hash: string;
	kind: 'heading' | 'text' | 'quote' | 'note';
	text: string;
	sentences: ParsedSentence[];
}

export interface ParsedEssay {
	path: string;
	absPath: string;
	title: string;
	mtimeMs: number;
	paragraphs: ParsedParagraph[];
}

export interface BookMeta {
	dir: string;
	path: string;
	title: string;
	chapters: ChapterMeta[];
}

export interface ChapterMeta {
	dir: string;
	path: string;
	title: string;
	essays: EssayMeta[];
}

export interface EssayMeta {
	dir: string;
	path: string;
	title: string;
}

export interface Scan {
	books: BookMeta[];
	essays: Map<string, ParsedEssay>;
	order: string[];
}

const cache = new Map<string, ParsedEssay>();

function stripOrderPrefix(name: string): string {
	return name.replace(/^\d+\.\s*/, '').replace(/^\[\d+\]\s*/, '').trim();
}

function essayTitle(file: string): string {
	return file.replace(/\.md$/i, '').replace(/^\[\d+\]\s*/, '').trim();
}

export function parseEssay(absPath: string, relPath: string): ParsedEssay {
	const stat = fs.statSync(absPath);
	const hit = cache.get(absPath);
	if (hit && hit.mtimeMs === stat.mtimeMs) return hit;
	const raw = fs.readFileSync(absPath, 'utf8');
	const rawParagraphs = splitParagraphs(raw);
	const firstHeading = rawParagraphs.find((p) => p.kind === 'heading');
	const title = (firstHeading?.text || essayTitle(path.basename(absPath))).replace(/^#+\s*/, '').trim();
	const paragraphs: ParsedParagraph[] = rawParagraphs
		.filter((p, i) => !(i === 0 && p.kind === 'heading' && p.text === title))
		.map((p) => {
			const sentences = splitSentences(p.text).map((text) => ({ hash: hashText(text), text }));
			return { hash: hashText(p.text), kind: p.kind, text: p.text, sentences };
		});
	const parsed: ParsedEssay = {
		path: relPath,
		absPath,
		title,
		mtimeMs: stat.mtimeMs,
		paragraphs
	};
	cache.set(absPath, parsed);
	return parsed;
}

export function scanBooks(): Scan {
	const books: BookMeta[] = [];
	const essays = new Map<string, ParsedEssay>();
	const order: string[] = [];
	if (!fs.existsSync(BOOKS_ROOT)) {
		return { books, essays, order };
	}
	const bookDirs = fs
		.readdirSync(BOOKS_ROOT, { withFileTypes: true })
		.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'private')
		.sort((a, b) => a.name.localeCompare(b.name, 'uk'));
	for (const bookDir of bookDirs) {
		const bookPath = path.join(BOOKS_ROOT, bookDir.name);
		const chapters: ChapterMeta[] = [];
		const entries = fs
			.readdirSync(bookPath, { withFileTypes: true })
			.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
			.sort((a, b) => a.name.localeCompare(b.name, 'uk'));
		for (const chapterDir of entries) {
			const chapterPath = path.join(bookPath, chapterDir.name);
			const chapterRel = [bookDir.name, chapterDir.name].join('/');
			const essayFiles = fs
				.readdirSync(chapterPath, { withFileTypes: true })
				.filter((e) => e.isFile() && /\.md$/i.test(e.name))
				.sort((a, b) => a.name.localeCompare(b.name, 'uk'));
			const chapterEssays: EssayMeta[] = [];
			for (const file of essayFiles) {
				const abs = path.join(chapterPath, file.name);
				const rel = [chapterRel, file.name].join('/');
				const parsed = parseEssay(abs, rel);
				essays.set(rel, parsed);
				order.push(rel);
				chapterEssays.push({ dir: file.name, path: rel, title: parsed.title });
			}
			chapters.push({
				dir: chapterDir.name,
				path: chapterRel,
				title: stripOrderPrefix(chapterDir.name),
				essays: chapterEssays
			});
		}
		books.push({
			dir: bookDir.name,
			path: bookDir.name,
			title: stripOrderPrefix(bookDir.name),
			chapters
		});
	}
	return { books, essays, order };
}

export function findEssay(relPath: string): ParsedEssay | null {
	const normalized = relPath.replace(/\\/g, '/');
	const direct = scanBooks().essays.get(normalized);
	return direct ?? null;
}

export function currentHashes(essay: ParsedEssay): string[] {
	return essay.paragraphs.map((p) => p.hash);
}

export function currentTexts(essay: ParsedEssay): Record<string, string> {
	const out: Record<string, string> = {};
	for (const p of essay.paragraphs) out[p.hash] = p.text;
	return out;
}
