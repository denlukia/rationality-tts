import { createHash } from 'node:crypto';

export function sha1(s: string): string {
	return createHash('sha1').update(s, 'utf8').digest('hex');
}

export function hashText(s: string, len = 16): string {
	return sha1(s).slice(0, len);
}

const ENTITIES: Record<string, string> = {
	'&shy;': '',
	'&nbsp;': ' ',
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
	'&apos;': "'"
};

export function decodeEntities(s: string): string {
	let out = s.replace(/&(shy|nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m);
	out = out.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
	return out;
}

export function cleanInline(s: string): string {
	let t = decodeEntities(s).replace(/\u00ad/g, '').replace(/\u00a0/g, ' ');
	t = t.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
	t = t.replace(/\{\{[^}]*\}\}/g, '');
	t = t.replace(/<!--.*?-->/g, '');
	t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
	t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
	t = t.replace(/\[\^[^\]]+\]/g, '');
	t = t.replace(/<[^>]+>/g, '');
	t = t.replace(/^\s*(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, '');
	t = t.replace(/\*\*|__|~~/g, '');
	t = t.replace(/(^|[\s(])[*_]([^*_]+)[*_](?=$|[\s).,!?:;»“”"'])/g, '$1$2');
	t = t.replace(/[*_`]/g, '');
	t = t.replace(/\s+([,.;:!?…])/g, '$1');
	t = t.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ');
	return t.trim();
}

export interface RawParagraph {
	text: string;
	kind: 'heading' | 'text' | 'quote' | 'note';
}

export function splitParagraphs(source: string): RawParagraph[] {
	let src = source.replace(/^\uFEFF/, '');
	src = src.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
	src = src.replace(/\{\{[^}]*\}\}/g, '');
	src = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
	const blocks = src.split(/\r?\n\s*\r?\n/);
	const out: RawParagraph[] = [];
	for (const block of blocks) {
		const trimmed = block.trim();
		if (!trimmed) continue;
		// Footnote definitions always start their own block.
		if (/^\[\^[^\]]+\]:/.test(trimmed)) {
			for (const line of trimmed.split(/\r?\n/)) {
				if (!line.trim()) continue;
				const text = cleanInline(line.replace(/^\s*\[\^[^\]]+\]:\s*/, ''));
				if (text) out.push({ text, kind: 'note' });
			}
			continue;
		}
		const kind: RawParagraph['kind'] = /^#{1,6}\s/.test(trimmed)
			? 'heading'
			: /^>/.test(trimmed)
				? 'quote'
				: 'text';
		const text = cleanInline(trimmed);
		if (text) out.push({ text, kind });
	}
	return out;
}

const SENT_RE = /[^.!?…]+(?:[.!?…]+[»”"')\]]*|$)/g;

function hardSplit(s: string, limit = 380): string[] {
	const out: string[] = [];
	let rest = s.trim();
	while (rest.length > limit) {
		let cut = -1;
		for (const sep of ['; ', ', ', ' — ', ' ']) {
			const idx = rest.lastIndexOf(sep, limit);
			if (idx > limit * 0.4) {
				cut = idx + sep.length;
				break;
			}
		}
		if (cut < 0) cut = limit;
		out.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest) out.push(rest);
	return out;
}

export function splitSentences(text: string): string[] {
	const parts = text.match(SENT_RE) ?? [text];
	const out: string[] = [];
	for (const raw of parts) {
		const p = raw.replace(/\s+/g, ' ').trim();
		if (!p) continue;
		if (!/[\p{L}\p{N}]/u.test(p)) continue;
		for (const piece of hardSplit(p)) {
			if (piece) out.push(piece);
		}
	}
	return out.length ? out : [text.trim()].filter(Boolean);
}

const ONES = [
	'нуль',
	'один',
	'два',
	'три',
	'чотири',
	"п'ять",
	'шість',
	'сім',
	'вісім',
	"дев'ять",
	'десять',
	'одинадцять',
	'дванадцять',
	'тринадцять',
	'чотирнадцять',
	"п'ятнадцять",
	'шістнадцять',
	'сімнадцять',
	'вісімнадцять',
	"дев'ятнадцять"
];
const TENS = ['', '', 'двадцять', 'тридцять', 'сорок', "п'ятдесят", 'шістдесят', 'сімдесят', 'вісімдесят', "дев'яносто"];
const HUNDREDS = ['', 'сто', 'двісті', 'триста', 'чотириста', "п'ятсот", 'шістсот', 'сімсот', 'вісімсот', "дев'ятсот"];

function triad(n: number, feminine = false): string[] {
	const parts: string[] = [];
	const h = Math.floor(n / 100);
	const t = Math.floor((n % 100) / 10);
	const o = n % 10;
	if (h) parts.push(HUNDREDS[h]);
	if (t >= 2) {
		parts.push(TENS[t]);
		if (o) parts.push(feminine && o === 1 ? 'одна' : feminine && o === 2 ? 'дві' : ONES[o]);
	} else if (t === 1) {
		parts.push(ONES[10 + o]);
	} else if (o) {
		parts.push(feminine && o === 1 ? 'одна' : feminine && o === 2 ? 'дві' : ONES[o]);
	}
	return parts;
}

export function cardinal(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	if (n === 0) return 'нуль';
	if (n < 0) return 'мінус ' + cardinal(-n);
	const groups = [
		['', '', ''],
		['тисяча', 'тисячі', 'тисяч'],
		['мільйон', 'мільйони', 'мільйонів'],
		['мільярд', 'мільярди', 'мільярдів']
	];
	const chunks: number[] = [];
	let rest = Math.floor(n);
	while (rest > 0) {
		chunks.push(rest % 1000);
		rest = Math.floor(rest / 1000);
	}
	const parts: string[] = [];
	for (let i = chunks.length - 1; i >= 0; i--) {
		const c = chunks[i];
		if (!c) continue;
		const feminine = i === 1;
		parts.push(...triad(c, feminine));
		const forms = groups[i];
		if (forms[0]) {
			const mod10 = c % 10;
			const mod100 = c % 100;
			const form = mod10 === 1 && mod100 !== 11 ? forms[0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
			parts.push(form);
		}
	}
	return parts.join(' ');
}

const ORDINAL_YEAR: Record<number, string> = {
	0: 'нульовому',
	1: 'першому',
	2: 'другому',
	3: 'третьому',
	4: 'четвертому',
	5: "п'ятому",
	6: 'шостому',
	7: 'сьомому',
	8: 'восьмому',
	9: "дев'ятому",
	10: 'десятому',
	11: 'одинадцятому',
	12: 'дванадцятому',
	13: 'тринадцятому',
	14: 'чотирнадцятому',
	15: "п'ятнадцятому",
	16: 'шістнадцятому',
	17: 'сімнадцятому',
	18: 'вісімнадцятому',
	19: "дев'ятнадцятому",
	20: 'двадцятому',
	30: 'тридцятому',
	40: 'сороковому',
	50: "п'ятдесятому",
	60: 'шістдесятому',
	70: 'сімдесятому',
	80: 'вісімдесятому',
	90: "дев'яностому",
	100: 'сотому',
	200: 'двохсотому',
	300: 'трьохсотому',
	400: 'чотирьохсотому',
	500: "п'ятисотому",
	600: 'шестисотому',
	700: 'семисотому',
	800: 'восьмисотому',
	900: "дев'ятисотому",
	1000: 'тисячному'
};

function yearOrdinal(n: number): string {
	const parts: string[] = [];
	const th = Math.floor(n / 1000);
	const h = Math.floor((n % 1000) / 100);
	const rest = n % 100;
	if (th) parts.push(th === 1 ? 'тисячного' : cardinal(th) + 'тисячного');
	if (h) parts.push(ORDINAL_YEAR[h * 100]);
	if (rest) {
		if (ORDINAL_YEAR[rest]) parts.push(ORDINAL_YEAR[rest]);
		else {
			const t = Math.floor(rest / 10) * 10;
			const o = rest % 10;
			if (t) parts.push(ORDINAL_YEAR[t]);
			if (o) parts.push(ORDINAL_YEAR[o]);
		}
	}
	return parts.join(' ') || 'нульовому';
}

/** Light Ukrainian number verbalizer so the TTS never has to read digits. */
export function verbalizeNumbers(text: string): string {
	let t = text;
	// Years: "у 1949 році" / "1949 року"
	t = t.replace(/\b(1\d{3}|20\d{2})\s*(році|року|рік|роках|роками)\b/giu, (m, y: string, tail: string) => {
		return `у ${yearOrdinal(Number(y))} ${tail}`;
	});
	// Percent
	t = t.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_, num: string) => {
		const [a, b] = num.replace(',', '.').split('.');
		const whole = cardinal(Number(a));
		if (!b) return whole + ' відсотків';
		return `${whole} цілих ${cardinal(Number(b))} ${b.length === 1 ? 'десятих' : 'сотих'} відсотків`;
	});
	// Decimals
	t = t.replace(/\b(\d+)[.,](\d+)\b/g, (_, a: string, b: string) => {
		const whole = cardinal(Number(a));
		const frac = cardinal(Number(b));
		const suffix = b.length === 1 ? 'десятих' : b.length === 2 ? 'сотих' : 'тисячних';
		return `${whole} цілих ${frac} ${suffix}`;
	});
	// Plain integers
	t = t.replace(/\b\d+\b/g, (m) => cardinal(Number(m)));
	return t;
}
