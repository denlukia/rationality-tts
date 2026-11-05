import type {
	BookNode,
	ChapterNode,
	ChangeItem,
	Counts,
	EssayChanges,
	EssayNode,
	EssayView,
	Library,
	ParagraphView,
	SentenceState,
	SentenceStatus
} from '#lib/types';
import { currentHashes, currentTexts, scanBooks, findEssay, type ParsedEssay } from './content';
import { audioFile, audioPath, audioUrl, ensureEssay, fileExists, readDb, writeDb, type AudioMeta, type EssayRec, type Db } from './db';
import { hashText, verbalizeNumbers } from './text';

export function effectiveText(original: string, patch?: string): string {
	const p = (patch ?? '').trim();
	return p || original;
}

export function audioKey(text: string): string {
	return hashText(verbalizeNumbers(text), 24);
}

function emptyCounts(): Counts {
	return { done: 0, update: 0, empty: 0 };
}

function addCounts(into: Counts, from: Counts): void {
	into.done += from.done;
	into.update += from.update;
	into.empty += from.empty;
}

function sentenceStatus(rec: EssayRec, phash: string, text: string): SentenceStatus {
	const srec = rec.paragraphs[phash]?.sentences?.[hashText(text)];
	const audio = srec?.audio;
	if (!audio) return 'empty';
	if (audio.key !== audioKey(effectiveText(text, srec?.patch))) return 'update';
	if (!fileExists(audio.file)) return 'empty';
	return 'done';
}

function snippet(text: string): ChangeItem {
	return { hash: hashText(text), text: text.length > 240 ? text.slice(0, 240) + '…' : text };
}

export function essayState(essay: ParsedEssay, rec: EssayRec): { counts: Counts; changes: EssayChanges } {
	const counts = emptyCounts();
	const changes: EssayChanges = { added: [], removed: [] };
	const knownSet = new Set(rec.known);
	const hashes = currentHashes(essay);
	const currentSet = new Set(hashes);

	for (let pi = 0; pi < essay.paragraphs.length; pi++) {
		const p = essay.paragraphs[pi];
		const isNew = !knownSet.has(p.hash);
		if (isNew) changes.added.push(snippet(p.text));
		for (const s of p.sentences) {
			if (isNew) counts.update++;
			else {
				const status = sentenceStatus(rec, p.hash, s.text);
				counts[status]++;
			}
		}
	}
	for (const hash of rec.known) {
		if (!currentSet.has(hash)) {
			counts.update++;
			changes.removed.push({ hash, text: rec.knownTexts[hash] ?? '(видалений абзац)' });
		}
	}
	return { counts, changes };
}

function initEssay(db: Db, essay: ParsedEssay): EssayRec {
	return ensureEssay(db, essay.path, currentHashes(essay), currentTexts(essay));
}

function essayParagraphView(essay: ParsedEssay, rec: EssayRec): ParagraphView[] {
	return essay.paragraphs.map((p) => {
		const isNew = !new Set(rec.known).has(p.hash);
		return {
			hash: p.hash,
			kind: p.kind,
			text: p.text,
			sentences: p.sentences.map((s) => {
				const srec = rec.paragraphs[p.hash]?.sentences?.[s.hash];
				const patch = srec?.patch ?? '';
				const effective = effectiveText(s.text, patch);
				const audio = srec?.audio;
				const status: SentenceStatus = isNew
					? 'update'
					: sentenceStatus(rec, p.hash, s.text);
				const fresh = status === 'done' && audio && fileExists(audio.file);
				return {
					hash: s.hash,
					text: s.text,
					status,
					patch,
					audio: fresh
						? { url: audioUrl(audio.file), file: audio.file, duration: audio.duration }
						: null
				};
			})
		};
	});
}

export function getLibrary(): Library {
	const db = readDb();
	const scan = scanBooks();
	let dirty = false;
	const books: BookNode[] = [];
	const totals = emptyCounts();

	for (const book of scan.books) {
		const bookCounts = emptyCounts();
		const chapters: ChapterNode[] = [];
		for (const chapter of book.chapters) {
			const chapterCounts = emptyCounts();
			const essays: EssayNode[] = [];
			for (const meta of chapter.essays) {
				const parsed = scan.essays.get(meta.path);
				if (!parsed) continue;
				const rec = db.essays[meta.path];
				if (!rec) dirty = true;
				const essayRec = initEssay(db, parsed);
				const { counts, changes } = essayState(parsed, essayRec);
				essays.push({
					type: 'essay',
					path: meta.path,
					title: meta.title,
					counts,
					changes
				});
				addCounts(chapterCounts, counts);
			}
			chapters.push({
				type: 'chapter',
				path: chapter.path,
				title: chapter.title,
				counts: chapterCounts,
				essays
			});
			addCounts(bookCounts, chapterCounts);
		}
		books.push({
			type: 'book',
			path: book.path,
			title: book.title,
			counts: bookCounts,
			chapters
		});
		addCounts(totals, bookCounts);
	}

	if (dirty) writeDb(db);
	return {
		root: 'content/books',
		books,
		totals,
		generatedAt: new Date().toISOString()
	};
}

export function getEssayView(relPath: string): EssayView | null {
	const essay = findEssay(relPath);
	if (!essay) return null;
	const db = readDb();
	const rec = db.essays[essay.path];
	const existed = !!rec;
	const essayRec = initEssay(db, essay);
	if (!existed) writeDb(db);
	const { counts, changes } = essayState(essay, essayRec);
	return {
		path: essay.path,
		title: essay.title,
		paragraphs: essayParagraphView(essay, essayRec),
		counts,
		changes
	};
}

export function getSentence(relPath: string, pi: number, si: number) {
	const essay = findEssay(relPath);
	if (!essay) return null;
	const paragraph = essay.paragraphs[pi];
	const sentence = paragraph?.sentences[si];
	if (!paragraph || !sentence) return null;
	return { essay, paragraph, sentence };
}

export function getSentenceState(relPath: string, pi: number, si: number): SentenceState | null {
	const found = getSentence(relPath, pi, si);
	if (!found) return null;
	const db = readDb();
	const rec = initEssay(db, found.essay);
	const srec = rec.paragraphs[found.paragraph.hash]?.sentences?.[found.sentence.hash];
	const status = new Set(rec.known).has(found.paragraph.hash)
		? sentenceStatus(rec, found.paragraph.hash, found.sentence.text)
		: 'update';
	const audio = srec?.audio;
	return {
		status,
		patch: srec?.patch ?? '',
		audio: status === 'done' && audio ? { url: audioUrl(audio.file), file: audio.file, duration: audio.duration } : null
	};
}

export function savePatch(relPath: string, pi: number, si: number, patch: string): SentenceState | null {
	const found = getSentence(relPath, pi, si);
	if (!found) return null;
	const db = readDb();
	const rec = initEssay(db, found.essay);
	const phash = found.paragraph.hash;
	const shash = found.sentence.hash;
	rec.paragraphs[phash] ??= { text: found.paragraph.text, sentences: {} };
	rec.paragraphs[phash].sentences[shash] ??= {};
	const clean = patch.trim();
	if (clean) rec.paragraphs[phash].sentences[shash].patch = clean;
	else delete rec.paragraphs[phash].sentences[shash].patch;
	rec.updatedAt = new Date().toISOString();
	writeDb(db);
	return getSentenceState(relPath, pi, si);
}

export function saveAudio(relPath: string, pi: number, si: number, meta: AudioMeta): SentenceState | null {
	const found = getSentence(relPath, pi, si);
	if (!found) return null;
	const db = readDb();
	const rec = initEssay(db, found.essay);
	const phash = found.paragraph.hash;
	const shash = found.sentence.hash;
	rec.paragraphs[phash] ??= { text: found.paragraph.text, sentences: {} };
	rec.paragraphs[phash].sentences[shash] ??= {};
	rec.paragraphs[phash].sentences[shash].audio = meta;
	ackParagraph(db, rec, found.essay, pi);
	rec.updatedAt = new Date().toISOString();
	writeDb(db);
	return getSentenceState(relPath, pi, si);
}

function ackParagraph(db: Db, rec: EssayRec, essay: ParsedEssay, pi: number): void {
	const paragraph = essay.paragraphs[pi];
	if (!paragraph) return;
	const hashes = currentHashes(essay);
	const currentSet = new Set(hashes);
	if (!rec.known.includes(paragraph.hash)) {
		const existing = rec.known[pi];
		if (existing && existing !== paragraph.hash && !currentSet.has(existing)) {
			delete rec.knownTexts[existing];
			rec.known[pi] = paragraph.hash;
		} else {
			rec.known.splice(pi, 0, paragraph.hash);
		}
	}
	rec.knownTexts[paragraph.hash] = paragraph.text;
}

export function ackPaths(paths: string[]): number {
	const db = readDb();
	let changed = 0;
	for (const rel of paths) {
		const essay = findEssay(rel);
		if (!essay) continue;
		const rec = initEssay(db, essay);
		const hashes = currentHashes(essay);
		rec.known = [...hashes];
		rec.knownTexts = { ...currentTexts(essay) };
		rec.updatedAt = new Date().toISOString();
		changed++;
	}
	if (changed) writeDb(db);
	return changed;
}

export function audioDiskPath(file: string): string {
	return audioPath(file);
}

export function newAudioFile(key: string): string {
	return audioFile(key);
}

export function hasAudioFile(key: string): boolean {
	return fileExists(audioFile(key));
}

export function resetCacheForTests(): void {
	// intentionally empty: cache is keyed by mtime
}
