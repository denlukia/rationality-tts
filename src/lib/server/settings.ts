import fs from 'node:fs';
import path from 'node:path';

export interface Replacement {
	from: string;
	to: string;
}

export interface PronunciationRule {
	key: string;
	value: string;
	type: 'phoneme' | 'alias';
	caseSensitive?: boolean;
}

export interface PronunciationDictionary {
	id: string;
	version: string;
}

export const SETTINGS_PATH = path.resolve(process.env.SETTINGS_FILE ?? path.join(process.env.DATA_DIR ?? 'data', 'settings.json'));

export interface AppSettings {
	engine: Engine;
	voice: string;
	dramaVoice: string;
	speed: number;
	sentenceGap: number;
	paragraphGap: number;
	replacements: Replacement[];
	pronunciation: { rules: PronunciationRule[]; dictionaries: PronunciationDictionary[] };
}

export type Engine = 'holos' | 'drama';

const DEFAULTS: AppSettings = {
	engine: 'holos',
	voice: process.env.HOLOS_VOICE ?? 'Speaker_84',
	dramaVoice: '',
	speed: 1,
	sentenceGap: 0.22,
	paragraphGap: 0.4,
	replacements: [
		{ from: '—', to: '...' },
		{ from: '–', to: '...' }
	],
	pronunciation: { rules: [], dictionaries: [] }
};

/** `TTS_ENGINE` locks the engine (used by the Drama-only Colab image). */
export function engineLocked(): boolean {
	return process.env.TTS_ENGINE === 'holos' || process.env.TTS_ENGINE === 'drama';
}

export function readSettings(): AppSettings {
	let merged: AppSettings = { ...DEFAULTS };
	try {
		const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as Partial<AppSettings>;
		merged = { ...DEFAULTS, ...raw };
	} catch {
		/* defaults */
	}
	if (engineLocked()) merged.engine = process.env.TTS_ENGINE === 'drama' ? 'drama' : 'holos';
	return merged;
}

export function applyReplacements(text: string, replacements: Replacement[]): string {
	let out = text;
	for (const r of replacements ?? []) {
		if (r.from) out = out.split(r.from).join(r.to ?? '');
	}
	return out;
}

export function applyPronunciation(text: string, rules: PronunciationRule[] | undefined): string {
	let out = text;
	for (const r of rules ?? []) {
		if (!r.key || !r.value) continue;
		const replacement = r.type === 'phoneme' ? `<|phoneme_start|>${r.value}<|phoneme_end|>` : r.value;
		if (r.caseSensitive) {
			out = out.split(r.key).join(replacement);
		} else {
			const esc = r.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			out = out.replace(new RegExp(esc, 'gi'), replacement);
		}
	}
	return out;
}

export function writeSettings(patch: Partial<AppSettings>): AppSettings {
	const next = { ...readSettings(), ...patch };
	fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
	const tmp = SETTINGS_PATH + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	fs.renameSync(tmp, SETTINGS_PATH);
	return next;
}
