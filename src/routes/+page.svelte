<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import Sidebar from '#lib/components/Sidebar.svelte';
	import SentenceSidebar from '#lib/components/SentenceSidebar.svelte';
	import type { EssayView, Library, SentenceState } from '#lib/types';

	let { data } = $props();
	let library = $derived(data.library as Library);

	let essay = $state<EssayView | null>(null);
	let selectedPath = $state<string | null>(null);
	let loading = $state(false);
	let selected = $state<{ pi: number; si: number } | null>(null);
	let playhead = $state<{ idx: number; mode: 'on' | 'between' } | null>(null);
	let playingKey = $state<string | null>(null);
	let ttsState = $state<{ active: boolean; done: number; total: number } | null>(null);
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	interface FlatSentence {
		hash: string;
		text: string;
		status: 'empty' | 'done' | 'update';
		patch: string;
		audio: { url: string; file: string; duration: number } | null;
		pi: number;
		si: number;
	}

	let flat = $derived<FlatSentence[]>(
		essay
			? essay.paragraphs.flatMap((p, pi) =>
					p.sentences.map((s, si) => ({ ...s, pi, si }))
				)
			: []
	);

	let idxMap = $derived(new Map(flat.map((f, i) => [`${f.pi}:${f.si}`, i])));

	let selectedSentence = $derived(
		selected && essay ? (essay.paragraphs[selected.pi]?.sentences[selected.si] ?? null) : null
	);

	let ttsBusy = $derived(!!ttsState?.active);

	let playheadLabel = $derived.by(() => {
		if (!flat.length) return 'початок';
		if (!playhead) return 'початок';
		if (playhead.mode === 'on') {
			const f = flat[playhead.idx];
			return f ? `на реченні ${playhead.idx + 1}` : 'початок';
		}
		if (playhead.idx <= 0) return 'перед першим реченням';
		if (playhead.idx >= flat.length) return 'після останнього речення';
		return `між ${playhead.idx} і ${playhead.idx + 1}`;
	});

	let currentAudio: HTMLAudioElement | null = null;
	let playToken = 0;

	onDestroy(() => {
		stopPlayback();
		if (toastTimer) clearTimeout(toastTimer);
	});

	function showToast(message: string) {
		toast = message;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 5000);
	}

	function idxOf(pi: number, si: number): number {
		return idxMap.get(`${pi}:${si}`) ?? 0;
	}

	async function openEssay(path: string) {
		stopPlayback();
		selectedPath = path;
		selected = null;
		playhead = null;
		loading = true;
		try {
			const r = await fetch('/api/essay?path=' + encodeURIComponent(path));
			if (!r.ok) {
				showToast('Не вдалося відкрити есей');
				return;
			}
			essay = (await r.json()) as EssayView;
			playhead = { idx: 0, mode: 'between' };
			window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
		} catch {
			showToast('Не вдалося відкрити есей');
		} finally {
			loading = false;
		}
	}

	function selectSentence(pi: number, si: number) {
		selected = { pi, si };
		playhead = { idx: idxOf(pi, si), mode: 'on' };
	}

	function setBetween(idx: number) {
		playhead = { idx, mode: 'between' };
	}

	function stopPlayback() {
		playToken++;
		if (currentAudio) {
			currentAudio.pause();
			currentAudio = null;
		}
		playingKey = null;
	}

	function playIndexes(indexes: number[]) {
		const playable = indexes.filter((i) => flat[i]?.audio);
		if (!playable.length) {
			showToast('У цьому діапазоні немає озвучених речень');
			return;
		}
		stopPlayback();
		const token = ++playToken;
		void (async () => {
			for (const i of playable) {
				if (token !== playToken) return;
				const f = flat[i];
				playingKey = `${f.pi}:${f.si}`;
				document.getElementById(`s-${f.pi}-${f.si}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
				await new Promise<void>((resolve) => {
					const audio = new Audio(f.audio!.url);
					currentAudio = audio;
					audio.onended = () => resolve();
					audio.onerror = () => resolve();
					audio.play().catch(() => resolve());
				});
			}
			if (token === playToken) {
				playingKey = null;
				currentAudio = null;
			}
		})();
	}

	function range(action: 'prev' | 'next' | 'paragraph' | 'after'): number[] {
		const n = flat.length;
		if (!n) return [];
		const ph = playhead ?? { idx: 0, mode: 'between' as const };
		if (action === 'prev') {
			const i = ph.mode === 'on' ? ph.idx - 1 : ph.idx - 1;
			return i >= 0 && i < n ? [i] : [];
		}
		if (action === 'next') {
			const i = ph.mode === 'on' ? ph.idx + 1 : ph.idx;
			return i >= 0 && i < n ? [i] : [];
		}
		if (ph.mode === 'between' && ph.idx >= n) return [];
		const base = ph.mode === 'on' ? ph.idx : ph.idx;
		if (action === 'paragraph') {
			const target = flat[base];
			if (!target) return [];
			let end = base;
			while (end < n - 1 && flat[end + 1].pi === target.pi) end++;
			return Array.from({ length: end - base + 1 }, (_, k) => base + k);
		}
		return Array.from({ length: n - base }, (_, k) => base + k);
	}

	function playAction(action: 'prev' | 'next' | 'paragraph' | 'after') {
		playIndexes(range(action));
	}

	async function ttsIndexes(indexes: number[]) {
		if (!essay || ttsBusy) return;
		const todo = indexes.filter((i) => flat[i] && flat[i].status !== 'done');
		if (!todo.length) {
			showToast('Ці речення вже озвучені');
			return;
		}
		stopPlayback();
		ttsState = { active: true, done: 0, total: todo.length };
		let completed = 0;
		try {
			for (const i of todo) {
				const f = flat[i];
				if (!f) continue;
				const r = await fetch('/api/tts', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ path: essay.path, pi: f.pi, si: f.si })
				});
				if (!r.ok) {
					const err = (await r.json().catch(() => ({}))) as { error?: string };
					showToast(err.error ?? 'Помилка TTS');
					break;
				}
				const state = (await r.json()) as SentenceState;
				const s = essay.paragraphs[f.pi].sentences[f.si];
				s.status = state.status;
				s.patch = state.patch;
				s.audio = state.audio;
				completed++;
				if (ttsState) ttsState.done = completed;
				await invalidateAll();
			}
		} catch {
			showToast('Помилка TTS');
		} finally {
			ttsState = null;
		}
		if (completed) showToast(`озвучено ${completed} ${completed === 1 ? 'речення' : 'речень'}`);
	}

	function ttsAction(action: 'prev' | 'next' | 'paragraph' | 'after') {
		void ttsIndexes(range(action));
	}

	async function onsave(patch: string) {
		if (!essay || !selected) return;
		const r = await fetch('/api/patch', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ path: essay.path, pi: selected.pi, si: selected.si, patch })
		});
		if (!r.ok) {
			showToast('Не вдалося зберегти патч');
			return;
		}
		const state = (await r.json()) as SentenceState;
		const s = essay.paragraphs[selected.pi].sentences[selected.si];
		s.patch = state.patch;
		s.status = state.status;
		s.audio = state.audio;
		await invalidateAll();
	}

	function ontts() {
		if (!selected) return;
		void ttsIndexes([idxOf(selected.pi, selected.si)]);
	}

	function onplay() {
		if (!selected) return;
		playIndexes([idxOf(selected.pi, selected.si)]);
	}

	const PLAY_ACTIONS = [
		{ key: 'prev' as const, label: '▶ попереднє' },
		{ key: 'next' as const, label: '▶ наступне' },
		{ key: 'paragraph' as const, label: '▶ до кінця абзацу' },
		{ key: 'after' as const, label: '▶ усе далі' }
	];
	const TTS_ACTIONS = [
		{ key: 'prev' as const, label: 'TTS попереднє' },
		{ key: 'next' as const, label: 'TTS наступне' },
		{ key: 'paragraph' as const, label: 'TTS до кінця абзацу' },
		{ key: 'after' as const, label: 'TTS усе далі' }
	];
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') stopPlayback();
	}}
/>

<Sidebar {library} {selectedPath} onselect={openEssay} />

<main class:shift={!!selectedSentence}>
	{#if loading}
		<p class="dim">завантаження…</p>
	{:else if essay}
		<article>
			<header>
				<h1>{essay.title}</h1>
				<div class="lead">
					{flat.length} речень · озвучено {essay.counts.done}
					{#if essay.counts.update}· оновлення {essay.counts.update}{/if}
				</div>
			</header>

			{#each essay.paragraphs as p, pi}
				<div class="p {p.kind}">
					{#each p.sentences as s, si}
						{@const idx = idxOf(pi, si)}
						{#if playhead?.mode === 'on' && playhead.idx === idx}
							<span class="caret" aria-hidden="true"></span>
						{/if}
						<span
							id={`s-${pi}-${si}`}
							class="s {s.status}"
							class:playing={playingKey === `${pi}:${si}`}
							class:selected={selected?.pi === pi && selected?.si === si}
							role="button"
							tabindex="0"
							onclick={() => selectSentence(pi, si)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									selectSentence(pi, si);
								}
							}}>{s.text}</span
						>
						{#if si < p.sentences.length - 1}
							<button
								class="gap"
								aria-label="поставити playhead між реченнями"
								onclick={() => setBetween(idx + 1)}
							>
								{#if playhead?.mode === 'between' && playhead.idx === idx + 1}
									<span class="caret" aria-hidden="true"></span>
								{/if}
							</button>
						{/if}
					{/each}
				</div>
				{@const nextIdx = pi + 1 < essay.paragraphs.length ? idxOf(pi + 1, 0) : flat.length}
				<button class="pgap" aria-label="поставити playhead між абзацами" onclick={() => setBetween(nextIdx)}>
					{#if playhead?.mode === 'between' && playhead.idx === nextIdx}
						<span class="caret" aria-hidden="true"></span>
					{/if}
				</button>
			{/each}
		</article>
	{:else}
		<div class="welcome">
			<h2>Виберіть есей зі списку</h2>
			<p class="dim">Речення, патчі та аудіо з'являться тут.</p>
		</div>
	{/if}
</main>

{#if selectedSentence}
	<SentenceSidebar
		sentence={selectedSentence}
		pi={selected!.pi}
		si={selected!.si}
		busy={ttsBusy}
		playing={playingKey === `${selected!.pi}:${selected!.si}`}
		onclose={() => (selected = null)}
		{onsave}
		{ontts}
		{onplay}
	/>
{/if}

<div class="dock" class:shift={!!selectedSentence}></div>
<div class="controls">
	<div class="ph">
		<span>{playheadLabel}</span>
		{#if ttsState}
			<span>TTS {ttsState.done}/{ttsState.total}</span>
		{/if}
	</div>
	<div class="row">
		{#each PLAY_ACTIONS as action}
			<button class="black" onclick={() => playAction(action.key)} disabled={!essay || ttsBusy}>{action.label}</button>
		{/each}
	</div>
	<div class="row">
		{#each TTS_ACTIONS as action}
			<button class="black" onclick={() => ttsAction(action.key)} disabled={!essay || ttsBusy}>{action.label}</button>
		{/each}
	</div>
</div>

{#if toast}
	<div class="toast">{toast}</div>
{/if}

<style>
	main {
		margin-left: 320px;
		padding: 48px 48px 240px;
	}
	main.shift {
		padding-right: 408px;
	}
	article {
		max-width: 720px;
		margin: 0 auto;
	}
	header {
		margin-bottom: 40px;
	}
	.lead {
		color: var(--dim);
		margin-top: 8px;
	}
	.dim {
		color: var(--dim);
	}
	.welcome {
		max-width: 720px;
		margin: 18vh auto 0;
	}
	.welcome .dim {
		margin-top: 10px;
	}
	.p {
		line-height: 1.8;
		margin: 0 0 0;
	}
	.p.heading {
		font-size: 24px;
		font-weight: 700;
		line-height: 1.3;
		margin-top: 36px;
	}
	.p.heading:first-child {
		margin-top: 0;
	}
	.p.quote {
		color: #333;
	}
	.p.note {
		color: var(--dim);
	}
	.s {
		cursor: pointer;
	}
	.s:hover {
		color: var(--ink);
	}
	.s.done {
		color: var(--green);
	}
	.s.update {
		color: var(--yellow);
	}
	.s.selected {
		font-weight: 700;
	}
	.s.playing {
		background: var(--ink);
		color: #fff;
	}
	.caret {
		display: inline-block;
		width: 3px;
		height: 14px;
		background: var(--ink);
		border-radius: 1px;
		vertical-align: -2px;
		margin-right: 3px;
	}
	.gap .caret {
		margin: 0;
	}
	.gap {
		display: inline-block;
		width: 8px;
		height: 1em;
		vertical-align: -2px;
		text-align: center;
	}
	.pgap {
		display: block;
		width: 100%;
		height: 16px;
		text-align: left;
	}
	.controls {
		position: fixed;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		z-index: 40;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		background: #fff;
		padding: 12px;
	}
	.dock {
		position: fixed;
		left: 320px;
		right: 0;
		bottom: 0;
		height: 200px;
		background: #fff;
		z-index: 35;
		pointer-events: none;
	}
	.dock.shift {
		right: 360px;
	}
	.ph {
		display: flex;
		gap: 20px;
		color: var(--dim);
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.black {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 7px 11px;
		white-space: nowrap;
	}
	.toast {
		position: fixed;
		left: 28px;
		bottom: 28px;
		z-index: 120;
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 8px 12px;
		max-width: 420px;
		line-height: 1.4;
	}
</style>
