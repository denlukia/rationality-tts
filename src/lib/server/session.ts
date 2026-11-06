import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR } from './db';

const execFileAsync = promisify(execFile);

export const AUTH_REQUIRED = process.env.SESSION_REQUIRE_AUTH === '1';
export const BUDGET_SEC = Number(process.env.SESSION_BUDGET_SEC ?? 0) || 0;
const AUTOSAVE_SEC = Number(process.env.AUTOSAVE_SEC ?? 0) || 0;
const STARTED_AT = Date.now();

const DEFAULT_REPO = process.env.GITHUB_REPO ?? 'denlukia/rationality-tts-data';

interface LastCommit {
	sha: string;
	message: string;
	at: number;
}

interface State {
	token: string;
	repo: string;
	lastCommit: LastCommit | null;
	lastError: string | null;
	busy: boolean;
	sessions: Map<string, number>;
}

const globalKey = '__rtts_session_state__';
const g = globalThis as unknown as Record<string, State | undefined>;
const state: State =
	g[globalKey] ??
	(g[globalKey] = {
		token: process.env.GITHUB_TOKEN ?? '',
		repo: DEFAULT_REPO,
		lastCommit: null,
		lastError: null,
		busy: false,
		sessions: new Map<string, number>()
	});

function askpassPath(): string {
	const file = path.join(os.tmpdir(), 'rtts-git-askpass.js');
	if (!fs.existsSync(file)) {
		fs.writeFileSync(
			file,
			'#!/usr/bin/env node\n' +
				"const prompt = process.argv[2] || '';\n" +
				"process.stdout.write(/username/i.test(prompt) ? 'x-access-token' : (process.env.GIT_TOKEN || ''));\n",
			{ mode: 0o755 }
		);
	}
	return file;
}

function cleanGitError(err: unknown, fallback: string): Error {
	const e = err as { stderr?: string; stdout?: string; message?: string };
	const text = (e.stderr || e.stdout || e.message || '').trim();
	return new Error(text ? text.split('\n').slice(-4).join('\n') : fallback);
}

async function git(args: string[], opts: { cwd?: string; token?: string } = {}): Promise<string> {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		GIT_TERMINAL_PROMPT: '0'
	};
	const token = opts.token ?? state.token;
	if (token) {
		env.GIT_TOKEN = token;
		env.GIT_ASKPASS = askpassPath();
	}
	try {
		const { stdout } = await execFileAsync('git', args, {
			cwd: opts.cwd ?? DATA_DIR,
			env,
			timeout: 180_000,
			maxBuffer: 16 * 1024 * 1024
		});
		return stdout;
	} catch (err) {
		throw cleanGitError(err, `git ${args[0]} failed`);
	}
}

export function normalizeRepo(input?: string): string {
	const raw = (input || state.repo || DEFAULT_REPO).trim();
	const match = raw.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?$/);
	const slug = match ? `${match[1]}/${match[2]}` : raw.replace(/\.git$/, '');
	if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) throw new Error('очікую owner/repo або URL GitHub');
	return slug;
}

export function isGitRepo(): boolean {
	try {
		return fs.statSync(path.join(DATA_DIR, '.git')).isDirectory();
	} catch {
		return false;
	}
}

export function dataConnected(): boolean {
	return isGitRepo();
}

function ensureDirs(): void {
	for (const dir of ['audio', 'db', 'voices/drama', 'voices/custom']) {
		fs.mkdirSync(path.join(DATA_DIR, dir), { recursive: true });
	}
}

async function verifyToken(token: string, repo: string): Promise<void> {
	let res: Response;
	try {
		res = await fetch(`https://api.github.com/repos/${repo}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'User-Agent': 'rationality-tts'
			},
			signal: AbortSignal.timeout(15_000)
		});
	} catch {
		throw new Error('немає зв’язку з GitHub');
	}
	if (res.status === 401) throw new Error('токен недійсний');
	if (res.status === 404) throw new Error(`немає доступу до ${repo}`);
	if (!res.ok) throw new Error(`GitHub: ${res.status}`);
}

export interface ConnectResult {
	repo: string;
	cloned: boolean;
	pulled: boolean;
}

export async function connect(token: string, repoInput?: string): Promise<ConnectResult> {
	const clean = token.trim();
	if (!clean) throw new Error('потрібен GitHub token');
	const repo = normalizeRepo(repoInput);
	await verifyToken(clean, repo);

	const previous = state.token;
	state.token = clean;
	state.repo = repo;

	try {
		if (isGitRepo()) {
			await pull();
			return { repo, cloned: false, pulled: true };
		}
		const exists = fs.existsSync(DATA_DIR);
		const entries = exists ? fs.readdirSync(DATA_DIR).filter((n) => n !== '.DS_Store') : [];
		if (entries.length > 0) {
			throw new Error('тека data/ не порожня — перемістіть її перед підключенням репозиторію');
		}
		fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
		await git(['clone', '--depth', '1', `https://github.com/${repo}.git`, DATA_DIR], {
			cwd: path.dirname(DATA_DIR)
		});
		// Never keep the token in .git/config.
		await git(['remote', 'set-url', 'origin', `https://github.com/${repo}.git`]);
		ensureDirs();
		return { repo, cloned: true, pulled: false };
	} catch (err) {
		state.token = previous;
		throw err;
	}
}

async function currentBranch(): Promise<string> {
	try {
		return (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || 'main';
	} catch {
		return 'main';
	}
}

async function hasRemoteBranch(branch: string): Promise<boolean> {
	try {
		await git(['rev-parse', '--verify', `origin/${branch}`]);
		return true;
	} catch {
		return false;
	}
}

export async function pull(): Promise<void> {
	const branch = await currentBranch();
	await git(['fetch', 'origin', '--prune']);
	if (!(await hasRemoteBranch(branch))) return;
	try {
		await git(['rebase', '--autostash', `origin/${branch}`]);
	} catch (err) {
		try {
			await git(['rebase', '--abort']);
		} catch {
			/* nothing to abort */
		}
		throw new Error(`конфлікт злиття: ${(err as Error).message}`);
	}
	state.lastError = null;
}

export async function isDirty(): Promise<boolean> {
	if (!isGitRepo() || state.busy) return false;
	try {
		return (await git(['status', '--porcelain'])).trim().length > 0;
	} catch {
		return false;
	}
}

export interface CommitResult {
	committed: boolean;
	pushed: boolean;
	sha: string | null;
	files: number;
	message: string;
}

export async function commit(message?: string): Promise<CommitResult> {
	if (!state.token) throw new Error('спочатку підключіть GitHub token');
	if (!isGitRepo()) throw new Error('репозиторій даних не підключено');
	if (state.busy) throw new Error('збереження вже виконується');

	state.busy = true;
	try {
		await git(['add', '-A']);
		const status = (await git(['status', '--porcelain'])).trim();
		if (!status) {
			return { committed: false, pushed: false, sha: state.lastCommit?.sha ?? null, files: 0, message: 'нічого змінювати' };
		}
		const files = status.split('\n').length;
		const text = (message ?? '').trim() || `сесія ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
		await git([
			'-c',
			'user.name=rationality-tts',
			'-c',
			'user.email=rationality-tts@users.noreply.github.com',
			'commit',
			'-m',
			text
		]);
		const branch = await currentBranch();
		await pull();
		await git(['push', 'origin', `HEAD:${branch}`]);
		const sha = (await git(['rev-parse', '--short', 'HEAD'])).trim();
		state.lastCommit = { sha, message: text, at: Date.now() };
		state.lastError = null;
		return { committed: true, pushed: true, sha, files, message: text };
	} catch (err) {
		state.lastError = (err as Error).message;
		throw err;
	} finally {
		state.busy = false;
	}
}

async function autosave(): Promise<void> {
	if (!state.token || state.busy || !isGitRepo()) return;
	try {
		if (!(await isDirty())) return;
		await commit(`автозбереження ${new Date().toISOString().slice(11, 16)}`);
		console.log('[sync] autosaved');
	} catch (err) {
		state.lastError = (err as Error).message;
		console.warn('[sync] autosave failed:', state.lastError);
	}
}

const autosaveKey = '__rtts_autosave_timer__';
const timers = globalThis as unknown as Record<string, ReturnType<typeof setInterval> | undefined>;
if (AUTOSAVE_SEC > 0 && !timers[autosaveKey]) {
	timers[autosaveKey] = setInterval(() => void autosave(), AUTOSAVE_SEC * 1000);
}

export function activeRepo(): string {
	return state.repo;
}

export function createSession(): string {
	const id = crypto.randomUUID();
	state.sessions.set(id, Date.now() + 24 * 3600 * 1000);
	return id;
}

export function isAuthed(sessionId: string | null | undefined): boolean {
	if (!AUTH_REQUIRED) return true;
	if (!sessionId) return false;
	const expiry = state.sessions.get(sessionId);
	if (!expiry) return false;
	if (expiry < Date.now()) {
		state.sessions.delete(sessionId);
		return false;
	}
	return true;
}

export interface SessionInfo {
	authRequired: boolean;
	authed: boolean;
	repo: string;
	hasToken: boolean;
	connected: boolean;
	startedAt: number;
	budgetSec: number;
	remainingSec: number;
	dirty: boolean;
	lastCommit: LastCommit | null;
	lastError: string | null;
}

export async function publicInfo(authed: boolean): Promise<SessionInfo> {
	return {
		authRequired: AUTH_REQUIRED,
		authed,
		repo: state.repo,
		hasToken: Boolean(state.token),
		connected: isGitRepo(),
		startedAt: STARTED_AT,
		budgetSec: BUDGET_SEC,
		remainingSec: BUDGET_SEC ? Math.max(0, BUDGET_SEC - Math.floor((Date.now() - STARTED_AT) / 1000)) : 0,
		dirty: false,
		lastCommit: null,
		lastError: null
	};
}

export async function sessionInfo(authed: boolean): Promise<SessionInfo> {
	const base = await publicInfo(authed);
	if (!base.connected) return base;
	return {
		...base,
		dirty: await isDirty(),
		lastCommit: state.lastCommit,
		lastError: state.lastError
	};
}
