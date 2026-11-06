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
import {
	currentHashes,
	currentTexts,
	scanBooks,
	findEssay,
	type ParsedEssay,
	type ParsedParagraph,
	type ParsedSentence
} from './content';
import {
	audioFile,
	audioPath,
	audioUrl,
	fileExists,
	readEssayRec,
	writeEssayRec,
	type AudioMeta,
	type EssayRec
} from './db';
import { hashText, verbalizeNumbers } from './text';
import { applyReplacements, applyPronunciation, readSettings } from './settings';

export function effectiveText(original: string, patch?: string): string {
	const p = (patch ?? '').trim();
	return p || original;
}

export function verbalized(original: string): string {
	const s = readSettings();
	return verbalizeNumbers(applyReplacements(original, s.replacements));
}

export function ttsText(original: string, patch?: string): string {
	const p = (patch ?? '').trim();
	const base = p || verbalized(original);
	return applyPronunciation(base, readSettings().pronunciation?.rules);
}

export function audioKey(original: string, patch?: string): string {
	const s = readSettings();
	const final = ttsText(original, patch);
	// Keep the Holos key byte-identical to the pre-engine formula so existing
	// audio is not invalidated; Drama gets its own namespace and voice.
	const voice = s.engine === 'drama' ? `drama:${s.dramaVoice}` : s.voice;
	return hashText(`${final}\n${voice}\n${s.speed}\n${s.sentenceGap}\n${s.paragraphGap}\n${JSON.stringify(s.replacements)}\n${JSON.stringify(s.pronunciation)}`, 24);
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
	if (audio.key !== audioKey(text, srec?.patch)) return 'update';
	if (!fileExists(audio.file)) return 'empty';
	return 'done';
}

function snippet(text: string): ChangeItem {
	return { hash: hashText(text), text: text.length > 240 ? text.slice(0, 240) + '…' : text };
}

/**
 * The baseline for an essay that has never been edited: every paragraph that
 * currently exists is already "known", so nothing is flagged as newly added.
 * It is only written to disk once the essay actually gains a patch or audio.
 */
function baselineRec(essay: ParsedEssay): EssayRec {
	return {
		version: 1,
		path: essay.path,
		known: currentHashes(essay),
		knownTexts: currentTexts(essay),
		paragraphs: {},
		updatedAt: new Date().toISOString(),
		required: true
	};
}

function recFor(essay: ParsedEssay): EssayRec {
	return readEssayRec(essay.path) ?? baselineRec(essay);
}

interface FoundSentence {
	essay: ParsedEssay;
	paragraph: ParsedParagraph;
	sentence: ParsedSentence;
}

function stateFrom(found: FoundSentence, rec: EssayRec): SentenceState {
	const srec = rec.paragraphs[found.paragraph.hash]?.sentences?.[found.sentence.hash];
	const status = new Set(rec.known).has(found.paragraph.hash)
		? sentenceStatus(rec, found.paragraph.hash, found.sentence.text)
		: 'update';
	const patch = srec?.patch ?? '';
	const audio = srec?.audio;
	return {
		status,
		patch,
		replaced: applyReplacements(found.sentence.text, readSettings().replacements),
		verbalized: verbalized(found.sentence.text),
		audio:
			audio && fileExists(audio.file)
				? { url: audioUrl(audio.file), file: audio.file, duration: audio.duration }
				: null
	};
}

export function essayState(essay: ParsedEssay, rec: EssayRec): { counts: Counts; changes: EssayChanges } {
	if (rec.required === false) {
		return { counts: emptyCounts(), changes: { added: [], removed: [] } };
	}
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
				const audio = srec?.audio;
				const status: SentenceStatus = isNew ? 'update' : sentenceStatus(rec, p.hash, s.text);
				const available = !!audio && fileExists(audio.file);
				return {
					hash: s.hash,
					text: s.text,
					status,
					patch,
					replaced: applyReplacements(s.text, readSettings().replacements),
					verbalized: verbalized(s.text),
					audio: available
						? { url: audioUrl(audio.file), file: audio.file, duration: audio.duration }
						: null
				};
			})
		};
	});
}

export function emptyLibrary(): Library {
	return {
		root: 'content/books',
		books: [],
		totals: emptyCounts(),
		generatedAt: new Date().toISOString()
	};
}

export function getLibrary(): Library {
	const scan = scanBooks();
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
				const essayRec = recFor(parsed);
				const { counts, changes } = essayState(parsed, essayRec);
				essays.push({
					type: 'essay',
					path: meta.path,
					title: meta.title,
					counts,
					changes,
					required: essayRec.required !== false
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
	const essayRec = recFor(essay);
	const { counts, changes } = essayState(essay, essayRec);
	return {
		path: essay.path,
		title: essay.title,
		paragraphs: essayParagraphView(essay, essayRec),
		counts,
		changes
	};
}

export function getSentence(relPath: string, pi: number, si: number): FoundSentence | null {
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
	return stateFrom(found, recFor(found.essay));
}

export function savePatch(relPath: string, pi: number, si: number, patch: string): SentenceState | null {
	const found = getSentence(relPath, pi, si);
	if (!found) return null;
	const rec = recFor(found.essay);
	const phash = found.paragraph.hash;
	const shash = found.sentence.hash;
	rec.paragraphs[phash] ??= { text: found.paragraph.text, sentences: {} };
	rec.paragraphs[phash].sentences[shash] ??= {};
	const clean = patch.trim();
	if (clean) rec.paragraphs[phash].sentences[shash].patch = clean;
	else delete rec.paragraphs[phash].sentences[shash].patch;
	rec.updatedAt = new Date().toISOString();
	writeEssayRec(found.essay.path, rec);
	return stateFrom(found, rec);
}

export function saveAudio(relPath: string, pi: number, si: number, meta: AudioMeta): SentenceState | null {
	const found = getSentence(relPath, pi, si);
	if (!found) return null;
	const rec = recFor(found.essay);
	const phash = found.paragraph.hash;
	const shash = found.sentence.hash;
	rec.paragraphs[phash] ??= { text: found.paragraph.text, sentences: {} };
	rec.paragraphs[phash].sentences[shash] ??= {};
	rec.paragraphs[phash].sentences[shash].audio = meta;
	ackParagraph(rec, found.essay, pi);
	rec.updatedAt = new Date().toISOString();
	writeEssayRec(found.essay.path, rec);
	return stateFrom(found, rec);
}

function ackParagraph(rec: EssayRec, essay: ParsedEssay, pi: number): void {
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

export function setRequired(paths: string[], value: boolean): number {
	let changed = 0;
	for (const rel of paths) {
		const essay = findEssay(rel);
		if (!essay) continue;
		const rec = recFor(essay);
		rec.required = value;
		rec.updatedAt = new Date().toISOString();
		writeEssayRec(essay.path, rec);
		changed++;
	}
	return changed;
}

export function ackPaths(paths: string[]): number {
	let changed = 0;
	for (const rel of paths) {
		const essay = findEssay(rel);
		if (!essay) continue;
		const rec = recFor(essay);
		rec.known = [...currentHashes(essay)];
		rec.knownTexts = { ...currentTexts(essay) };
		rec.updatedAt = new Date().toISOString();
		writeEssayRec(essay.path, rec);
		changed++;
	}
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
	// intentionally empty: per-essay cache is keyed by mtime
}
