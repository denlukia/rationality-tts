export type SentenceStatus = 'empty' | 'done' | 'update';

export interface AudioRef {
	url: string;
	file: string;
	duration: number;
}

export interface SentenceView {
	hash: string;
	text: string;
	status: SentenceStatus;
	patch: string;
	audio: AudioRef | null;
}

export interface ParagraphView {
	hash: string;
	kind: 'heading' | 'text' | 'quote' | 'note';
	text: string;
	sentences: SentenceView[];
}

export interface ChangeItem {
	hash: string;
	text: string;
}

export interface EssayChanges {
	added: ChangeItem[];
	removed: ChangeItem[];
}

export interface Counts {
	done: number;
	update: number;
	empty: number;
}

export interface EssayNode {
	type: 'essay';
	path: string;
	title: string;
	counts: Counts;
	changes: EssayChanges;
}

export interface ChapterNode {
	type: 'chapter';
	path: string;
	title: string;
	counts: Counts;
	essays: EssayNode[];
}

export interface BookNode {
	type: 'book';
	path: string;
	title: string;
	counts: Counts;
	chapters: ChapterNode[];
}

export interface Library {
	root: string;
	books: BookNode[];
	totals: Counts;
	generatedAt: string;
}

export interface EssayView {
	path: string;
	title: string;
	paragraphs: ParagraphView[];
	counts: Counts;
	changes: EssayChanges;
}

export interface SentenceState {
	status: SentenceStatus;
	patch: string;
	audio: AudioRef | null;
}

export interface DialogEssay {
	title: string;
	added: ChangeItem[];
	removed: ChangeItem[];
}

export interface DialogData {
	title: string;
	level: string;
	counts: Counts;
	essays: DialogEssay[];
	paths: string[];
}
