<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import Sidebar from '#lib/components/Sidebar.svelte';
	import SentenceSidebar from '#lib/components/SentenceSidebar.svelte';
	import SettingsModal from '#lib/components/SettingsModal.svelte';
	import type { EssayView, Library, SentenceState } from '#lib/types';

	let { data } = $props();
	let library = $derived(data.library as Library);
	let settings = $derived(
		data.settings as {
			engine: 'holos' | 'drama';
			voice: string;
			dramaVoice: string;
			speed: number;
			sentenceGap: number;
			paragraphGap: number;
			replacements: { from: string; to: string }[];
			pronunciation: { rules: { key: string; value: string; type: 'phoneme' | 'alias'; caseSensitive: boolean }[]; dictionaries: { id: string; version: string }[] };
		}
	);

	let essay = $state<EssayView | null>(null);
	let selectedPath = $state<string | null>(null);
	let loading = $state(false);
	let selected = $state<{ pi: number; si: number } | null>(null);
	let playhead = $state<number>(0);
	let playingKey = $state<string | null>(null);
	let generatingKey = $state<string | null>(null);
	let ttsState = $state<{ active: boolean; done: number; total: number } | null>(null);
	let toast = $state('');
	let settingsOpen = $state(false);
	let playAmount = $state('after');
	let ttsAmount = $state('after');
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

	let currentAudio: HTMLAudioElement | null = null;
	let playToken = 0;

	onDestroy(() => {
		stopPlayback();
		if (toastTimer) clearTimeout(toastTimer);
	});

	onMount(() => {
		const fromUrl = new URL(window.location.href).searchParams.get('essay');
		if (fromUrl && fromUrl !== selectedPath) openEssay(fromUrl);
		const pa = localStorage.getItem('playAmount');
		const ta = localStorage.getItem('ttsAmount');
		if (pa) playAmount = pa;
		if (ta) ttsAmount = ta;
	});
	$effect(() => { localStorage.setItem('playAmount', playAmount); });
	$effect(() => { localStorage.setItem('ttsAmount', ttsAmount); });

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
		playhead = 0;
		loading = true;
		try {
			const r = await fetch('/api/essay?path=' + encodeURIComponent(path));
			if (!r.ok) {
				showToast('Не вдалося відкрити есей');
				return;
			}
			essay = (await r.json()) as EssayView;
			playhead = 0;
			const url = new URL(window.location.href);
			url.searchParams.set('essay', path);
			goto(url.pathname + url.search, { replace: true });
			window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
		} catch {
			showToast('Не вдалося відкрити есей');
		} finally {
			loading = false;
		}
	}

	function selectSentence(pi: number, si: number) {
		selected = { pi, si };
		playhead = idxOf(pi, si);
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
			let prevPi: number | null = null;
			for (const i of playable) {
				if (token !== playToken) return;
				const f = flat[i];
				generatingKey = `${f.pi}:${f.si}`;
				if (prevPi !== null) {
					const gap = f.pi !== prevPi ? settings.paragraphGap : settings.sentenceGap;
					await new Promise((r) => setTimeout(r, gap * 1000));
					if (token !== playToken) return;
				}
				prevPi = f.pi;
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

	function range(action: string): number[] {
		const n = flat.length;
		if (!n) return [];
		const idx = Math.min(Math.max(playhead, 0), n - 1);
		if (action === 'prev') {
			const i = playhead - 1;
			return i >= 0 && i < n ? [i] : [];
		}
		if (action === 'current') {
			return [playhead];
		}
		if (action === 'next') {
			const i = playhead + 1;
			return i >= 0 && i < n ? [i] : [];
		}
		if (action === 'paragraph') {
			const target = flat[idx];
			if (!target) return [];
			let end = idx;
			while (end < n - 1 && flat[end + 1].pi === target.pi) end++;
			return Array.from({ length: end - idx + 1 }, (_, k) => idx + k);
		}
		return Array.from({ length: n - idx }, (_, k) => idx + k);
	}

	function playAction(amount: string) {
		playIndexes(range(amount as 'prev' | 'next' | 'paragraph' | 'after'));
	}

	async function ttsIndexes(indexes: number[], force = false) {
		if (!essay || ttsBusy) return;
		const todo = force
			? indexes.filter((i) => flat[i])
			: indexes.filter((i) => flat[i] && flat[i].status !== 'done');
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
					body: JSON.stringify({ path: essay.path, pi: f.pi, si: f.si, force })
				});
				if (!r.ok) {
					const err = (await r.json().catch(() => ({}))) as { error?: string };
					generatingKey = null;
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
			generatingKey = null;
			ttsState = null;
		}
		if (completed) showToast(`озвучено ${completed} ${completed === 1 ? 'речення' : 'речень'}`);
	}

	function ttsAction(amount: string, force = false) {
		void ttsIndexes(range(amount as 'prev' | 'next' | 'paragraph' | 'after'), force);
	}

	async function reloadEssay() {
		if (!selectedPath) return;
		try {
			const r = await fetch('/api/essay?path=' + encodeURIComponent(selectedPath));
			if (r.ok) essay = (await r.json()) as EssayView;
		} catch {
			/* ignore */
		}
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

	const AMOUNTS = [
		{ value: 'prev', label: 'попереднє' },
		{ value: 'current', label: 'поточне' },
		{ value: 'next', label: 'наступне' },
		{ value: 'paragraph', label: 'до кінця абзацу' },
		{ value: 'after', label: 'усе далі' }
	];
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') stopPlayback();
	}}
/>

<Sidebar {library} {selectedPath} onselect={openEssay} />

<main>
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
							}}>{#if s.patch}<sup class="patch-mark">P</sup>{/if}{s.text}</span
						>
						{#if false}{/if}
					{/each}
				</div>
				{@const nextIdx = pi + 1 < essay.paragraphs.length ? idxOf(pi + 1, 0) : flat.length}
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
		engine={settings.engine}
		onclose={() => (selected = null)}
		{onsave}
		{ontts}
		{onplay}
	/>
{/if}

<button class="settings-btn" onclick={() => (settingsOpen = true)} aria-label="налаштування">⚙</button>

{#if settingsOpen}
	<SettingsModal
		settings={settings}
		locked={data.engineLocked}
		onclose={() => (settingsOpen = false)}
		onsaved={reloadEssay}
	/>
{/if}


<div class="controls">
	<div class="row merged">
		<button class="black" onclick={stopPlayback} disabled={playingKey === null}>стоп</button>
		<div class="combo">
			<button
				class="black"
				onclick={(e) => playAction(playAmount)}
				disabled={!essay || ttsBusy || !range(playAmount as 'prev' | 'next' | 'paragraph' | 'after').some((i) => flat[i]?.audio)}
			>▶ відтворити</button>
			<select bind:value={playAmount} aria-label="кількість для відтворення">
				{#each AMOUNTS as a}
					<option value={a.value}>{a.label}</option>
				{/each}
			</select>
		</div>
		<div class="combo">
			<button
				class="black"
				onclick={(e) => ttsAction(ttsAmount, e.shiftKey)}
				title="Shift — переозвучити"
				disabled={!essay || ttsBusy || range(ttsAmount as 'prev' | 'next' | 'paragraph' | 'after').length === 0}
			>TTS</button>
			<select bind:value={ttsAmount} aria-label="кількість для TTS">
				{#each AMOUNTS as a}
					<option value={a.value}>{a.label}</option>
				{/each}
			</select>
		</div>
	</div>
</div>

{#if toast}
	<div class="toast">{toast}</div>
{/if}

<style>
	main {
		margin-left: 320px;
		margin-right: 360px;
		padding: 48px 48px 160px;
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
		line-height: 26px;
		margin: 0 0 20px;
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
		position: relative;
		padding: 0 2px;
	}
	.s:hover {
		color: var(--ink);
	}
	.s.empty {
		color: var(--ink);
	}
	.s.done {
		color: var(--green);
	}
	.s.update {
		color: var(--yellow);
	}
	.s.empty.selected {
		background: #e5e5e5;
		color: var(--ink);
	}
	.s.done.selected {
		background: var(--green);
		color: #fff;
	}
	.s.update.selected {
		background: var(--yellow);
		color: #fff;
	}
	.s.playing {
		outline: 1.5px solid #c00;
		border-radius: 3px;
	}
	.caret {
		position: absolute;
		left: -6px;
		top: 1px;
		width: 3px;
		height: 18px;
		background: #c00;
		border-radius: 0;
	}
	.gap .caret {
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
	}
	.caret.end {
		left: auto;
		right: -5px;
	}
	.gap {
		display: inline-block;
		width: 0;
		height: 1em;
		vertical-align: -2px;
		text-align: center;
		position: relative;
		margin: 0 -4px;
		padding: 0 4px;
	}
	.pgap {
		display: block;
		width: 100%;
		height: 16px;
		text-align: left;
		position: relative;
	}
	.controls {
		position: fixed;
		left: 320px;
		right: 360px;
		bottom: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		background: #fff;
		padding: 8px 12px 12px;
		border-top: 1px solid var(--ink);
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
		padding: 5px 9px;
		white-space: nowrap;
	}
	.settings-btn {
		position: fixed;
		left: 24px;
		bottom: 24px;
		z-index: 45;
		width: 44px;
		height: 44px;
		background: transparent;
		color: var(--ink);
		border: 0;
		border-radius: 0;
		font-size: 26px;
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	.ico {
		font-size: 20px;
		line-height: 1;
	}
	.combo {
		display: flex;
		align-items: stretch;
	}
	.combo select {
		font: inherit;
		background: var(--ink);
		color: #fff;
		border: 0;
		border-radius: 0 3px 3px 0;
		padding: 0 8px;
		margin-left: 1px;
	}
	.combo .black {
		border-radius: 3px 0 0 3px;
	}
	.patch-mark {
		font-size: 10px;
		vertical-align: super;
		color: currentColor;
		margin-right: 2px;
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
