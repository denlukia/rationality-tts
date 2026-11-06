<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	type Engine = 'holos' | 'drama';

	let {
		settings,
		locked = false,
		onclose,
		onsaved
	}: {
		settings: {
			engine: Engine;
			voice: string;
			dramaVoice: string;
			speed: number;
			sentenceGap: number;
			paragraphGap: number;
			replacements: { from: string; to: string }[];
			pronunciation: { rules: { key: string; value: string; type: 'phoneme' | 'alias'; caseSensitive: boolean }[]; dictionaries: { id: string; version: string }[] };
		};
		locked?: boolean;
		onclose: () => void;
		onsaved?: () => void;
	} = $props();

	let draft = $state({
		engine: 'holos' as Engine,
		voice: '',
		dramaVoice: '',
		speed: 1,
		sentenceGap: 0.22,
		paragraphGap: 0.4,
		replacements: [] as { from: string; to: string }[],
		pronunciation: { rules: [] as { key: string; value: string; type: 'phoneme' | 'alias'; caseSensitive: boolean }[], dictionaries: [] as { id: string; version: string }[] }
	});
	let voices = $state<{
		presets: string[];
		custom: Record<string, { name?: string }>;
		drama: Record<string, { name?: string; ref_text?: string }>;
		all: string[];
		drama_all: string[];
	}>({
		presets: [],
		custom: {},
		drama: {},
		all: [],
		drama_all: []
	});
	let recording = $state(false);
	let mediaRecorder: MediaRecorder | null = null;
	let chunks: Blob[] = [];
	let saving = $state(false);
	let uploading = $state(false);
	let previewing = $state<string | null>(null);
	let dramaFile = $state<File | null>(null);
	let dramaText = $state('');

	async function loadVoices(engine: Engine = draft.engine) {
		try {
			const r = await fetch(`/api/voices?engine=${engine}`);
			if (r.ok) voices = await r.json();
		} catch {
			/* ignore */
		}
	}

	onMount(() => {
		draft = { ...settings, pronunciation: settings.pronunciation ?? { rules: [], dictionaries: [] } };
		loadVoices(draft.engine);
	});

	async function save() {
		saving = true;
		try {
			await fetch('/api/settings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(draft)
			});
			await invalidateAll();
			onsaved?.();
			onclose();
		} finally {
			saving = false;
		}
	}

	function switchEngine(engine: Engine) {
		if (draft.engine === engine) return;
		draft.engine = engine;
		loadVoices(engine);
	}

	async function upload(file: File) {
		uploading = true;
		try {
			const fd = new FormData();
			fd.append('file', file, file.name);
			fd.append('name', file.name.replace(/\.[^.]+$/, ''));
			const r = await fetch('/api/voices', { method: 'POST', body: fd });
			if (!r.ok) {
				alert(await r.text());
				return;
			}
			const v = await r.json();
			await loadVoices('holos');
			draft.voice = v.id;
		} finally {
			uploading = false;
		}
	}

	async function createDramaVoice() {
		if (!dramaFile || !dramaText.trim()) return;
		uploading = true;
		try {
			const fd = new FormData();
			fd.append('file', dramaFile, dramaFile.name);
			fd.append('name', dramaFile.name.replace(/\.[^.]+$/, ''));
			fd.append('ref_text', dramaText.trim());
			const r = await fetch('/api/voices/drama', { method: 'POST', body: fd });
			if (!r.ok) {
				alert(await r.text());
				return;
			}
			const v = await r.json();
			dramaText = '';
			dramaFile = null;
			await loadVoices('drama');
			draft.dramaVoice = v.id;
		} finally {
			uploading = false;
		}
	}

	async function removeVoice(id: string) {
		await fetch(`/api/voices/${id}`, { method: 'DELETE' });
		await loadVoices(draft.engine);
		if (draft.voice === id) draft.voice = voices.all[0] ?? draft.voice;
		if (draft.dramaVoice === id) draft.dramaVoice = '';
	}

	async function preview(voice: string) {
		const slot = `${draft.engine}:${voice}`;
		previewing = slot;
		try {
			const r = await fetch('/api/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ voice, engine: draft.engine, speed: draft.speed })
			});
			if (!r.ok) {
				previewing = null;
				return;
			}
			const res = await r.json();
			const audio = new Audio(res.url);
			audio.onended = () => (previewing = null);
			audio.onerror = () => (previewing = null);
			await audio.play();
		} catch {
			previewing = null;
		}
	}

	async function startRecording() {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			mediaRecorder = new MediaRecorder(stream);
			chunks = [];
			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunks.push(e.data);
			};
			mediaRecorder.onstop = async () => {
				const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
				const file = new File([blob], 'recording.webm', { type: blob.type });
				// Drama needs a transcript before it can store a reference clip.
				if (draft.engine === 'drama') {
					dramaFile = file;
				} else {
					await upload(file);
				}
				stream.getTracks().forEach((t) => t.stop());
			};
			mediaRecorder.start();
			recording = true;
		} catch (e) {
			alert(String(e));
		}
	}

	function stopRecording() {
		mediaRecorder?.stop();
		recording = false;
	}

	function voiceLabel(id: string): string {
		if (id.startsWith('custom-')) return voices.custom[id]?.name ?? id;
		if (id.startsWith('drama-')) return voices.drama[id]?.name ?? id;
		return id;
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') onclose();
	}}
/>

<div class="overlay" onclick={onclose} role="presentation">
	<div class="panel" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
		<div class="top">
			<h2>налаштування</h2>
			<button class="close" onclick={onclose}>закрити</button>
		</div>

		<div class="block">
			<div class="label">модель</div>
			{#if locked}
				<p class="hint">
					движок зафіксовано на сервері: {draft.engine === 'drama' ? 'Fish Drama 3' : 'HolosTTS'}
				</p>
			{:else}
				<div class="row">
					<button class="black" class:off={draft.engine !== 'holos'} onclick={() => switchEngine('holos')}>
						HolosTTS
					</button>
					<button class="black" class:off={draft.engine !== 'drama'} onclick={() => switchEngine('drama')}>
						Fish Drama 3
					</button>
				</div>
			{/if}
			{#if draft.engine === 'drama'}
				<p class="hint">
					Drama 3 генерує приблизно в реальному часі, потребує ~23 ГБ пам’яті та вивантажується після
					5 хвилин простою. Для стабільного голосу додайте референсне аудіо з текстом.
				</p>
			{/if}
		</div>

		<div class="block">
			<div class="label">голос</div>
			{#if draft.engine === 'holos'}
				<div class="voice-list">
					{#each voices.all as v}
						<div class="voice-row" class:active={draft.voice === v}>
							<button class="voice-name" onclick={() => (draft.voice = v)}>
								{voiceLabel(v)}
							</button>
							<button
								class="preview-btn"
								onclick={() => preview(v)}
								disabled={previewing !== null && previewing !== `holos:${v}`}
							>
								{previewing === `holos:${v}` ? '…' : '▶'}
							</button>
						</div>
					{/each}
				</div>

				<div class="row">
					<button class="black" onclick={startRecording} disabled={recording || uploading}>
						{recording ? 'записую…' : 'записати голос'}
					</button>
					{#if recording}
						<button class="black" onclick={stopRecording}>стоп</button>
					{/if}
					<label class="black file">
						завантажити
						<input
							type="file"
							accept="audio/*"
							onchange={(e) => {
								const f = (e.currentTarget as HTMLInputElement).files?.[0];
								if (f) upload(f);
							}}
							hidden
						/>
					</label>
				</div>

				{#if Object.keys(voices.custom).length}
					<div class="custom-list">
						{#each Object.keys(voices.custom) as id}
							<div class="custom-row">
								<span>{voiceLabel(id)}</span>
								<button class="small" onclick={() => removeVoice(id)}>видалити</button>
							</div>
						{/each}
					</div>
				{/if}
			{:else}
				<div class="voice-list">
					<div class="voice-row" class:active={draft.dramaVoice === ''}>
						<button class="voice-name" onclick={() => (draft.dramaVoice = '')}>
							без референсу (авто)
						</button>
						<button
							class="preview-btn"
							onclick={() => preview('')}
							disabled={previewing !== null && previewing !== 'drama:'}
						>
							{previewing === 'drama:' ? '…' : '▶'}
						</button>
					</div>
					{#each voices.drama_all as v}
						<div class="voice-row" class:active={draft.dramaVoice === v}>
							<button class="voice-name" onclick={() => (draft.dramaVoice = v)}>
								{voiceLabel(v)}
							</button>
							<button
								class="preview-btn"
								onclick={() => preview(v)}
								disabled={previewing !== null && previewing !== `drama:${v}`}
							>
								{previewing === `drama:${v}` ? '…' : '▶'}
							</button>
						</div>
					{/each}
				</div>

				<div class="row">
					<button class="black" onclick={startRecording} disabled={recording || uploading}>
						{recording ? 'записую…' : 'записати референс'}
					</button>
					{#if recording}
						<button class="black" onclick={stopRecording}>стоп</button>
					{/if}
					<label class="black file">
						завантажити
						<input
							type="file"
							accept="audio/*"
							onchange={(e) => {
								const f = (e.currentTarget as HTMLInputElement).files?.[0];
								if (f) dramaFile = f;
							}}
							hidden
						/>
					</label>
				</div>

				{#if dramaFile}
					<div class="hint">файл: {dramaFile.name}</div>
				{/if}
				<textarea bind:value={dramaText} placeholder="текст референсного аудіо"></textarea>
				<button
					class="black"
					onclick={createDramaVoice}
					disabled={uploading || !dramaFile || !dramaText.trim()}
				>
					{uploading ? 'додаю…' : 'додати голос'}
				</button>

				{#if Object.keys(voices.drama).length}
					<div class="custom-list">
						{#each Object.keys(voices.drama) as id}
							<div class="custom-row">
								<span>{voiceLabel(id)}</span>
								<button class="small" onclick={() => removeVoice(id)}>видалити</button>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>

		<div class="block">
			<div class="label">швидкість {draft.speed.toFixed(2)}</div>
			<input type="range" min="0.5" max="2" step="0.05" bind:value={draft.speed} />
			{#if draft.engine === 'drama'}
				<p class="hint">застосовується після генерації: змінює темп, не висоту.</p>
			{/if}
		</div>

		<div class="block">
			<div class="label">пауза між реченнями {draft.sentenceGap.toFixed(2)} с</div>
			<input type="range" min="0" max="1" step="0.01" bind:value={draft.sentenceGap} />
		</div>

		<div class="block">
			<div class="label">пауза між абзацами {draft.paragraphGap.toFixed(2)} с</div>
			<input type="range" min="0" max="2" step="0.05" bind:value={draft.paragraphGap} />
		</div>

		<div class="block">
			<div class="label">заміни</div>
			<div class="repl-list">
				{#each draft.replacements as r, i}
					<div class="repl-row">
						<input class="repl-input" bind:value={r.from} placeholder="з" />
						<span class="arrow">→</span>
						<input class="repl-input" bind:value={r.to} placeholder="на" />
						<button class="small" onclick={() => draft.replacements.splice(i, 1)}>×</button>
					</div>
				{/each}
			</div>
			<button class="black" onclick={() => draft.replacements.push({ from: '', to: '' })}>
				додати заміну
			</button>
		</div>

	<div class="block">
		<div class="label">словник вимови</div>
		<p class="hint">
			Правила вимови: фонемний запис (IPA/ARPAbet) або заміна тексту. Застосовуються до тексту перед озвученням.
		</p>
		<div class="repl-list">
			{#each draft.pronunciation.rules as r, i}
				<div class="repl-row">
					<input class="repl-input" bind:value={r.key} placeholder="слово" />
					<select class="repl-select" bind:value={r.type}>
						<option value="phoneme">фонеми</option>
						<option value="alias">заміна</option>
					</select>
					<input class="repl-input" bind:value={r.value} placeholder={r.type === 'phoneme' ? 'IPA…' : 'на'} />
					<label class="case">
						<input type="checkbox" bind:checked={r.caseSensitive} /> Aa
					</label>
					<button class="small" onclick={() => draft.pronunciation.rules.splice(i, 1)}>×</button>
				</div>
			{/each}
		</div>
		<button class="black" onclick={() => draft.pronunciation.rules.push({ key: '', value: '', type: 'phoneme', caseSensitive: false })}>
			додати правило
		</button>

		<div class="sublabel">хмарні словники Fish Audio (id + version)</div>
		<div class="repl-list">
			{#each draft.pronunciation.dictionaries as d, i}
				<div class="repl-row">
					<input class="repl-input" bind:value={d.id} placeholder="dictionary id" />
					<input class="repl-input" bind:value={d.version} placeholder="version id" />
					<button class="small" onclick={() => draft.pronunciation.dictionaries.splice(i, 1)}>×</button>
				</div>
			{/each}
		</div>
		<button class="black" onclick={() => draft.pronunciation.dictionaries.push({ id: '', version: '' })}>
			додати словник
		</button>
	</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 110;
		display: grid;
		place-items: center;
		padding: 32px;
	}
	.panel {
		width: min(520px, 100%);
		max-height: 82vh;
		overflow: auto;
		overflow-x: hidden;
		background: #fff;
		padding: 24px;
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 24px;
	}
	.close {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 6px 10px;
	}
	.block {
		margin-bottom: 20px;
	}
	.label {
		color: var(--dim);
		margin-bottom: 8px;
	}
	.hint {
		color: var(--dim);
		margin-top: 8px;
		line-height: 1.5;
	}
	.voice-list {
		max-height: 220px;
		overflow: auto;
		border: 0;
		background: #f7f7f7;
		border-radius: 3px;
		padding: 6px;
		margin-bottom: 12px;
	}
	.voice-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 4px 6px;
		border-radius: 3px;
	}
	.voice-row.active {
		background: #e9e9e9;
	}
	.voice-name {
		flex: 1;
		text-align: left;
		font: inherit;
	}
	.preview-btn {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 3px 8px;
	}
	.row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.black {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 7px 11px;
	}
	.black.off {
		background: #e9e9e9;
		color: var(--ink);
	}
	.file {
		cursor: pointer;
	}
	.custom-list {
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.custom-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.small {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 5px 9px;
	}
	textarea {
		width: 100%;
		min-height: 72px;
		font: inherit;
		background: #f7f7f7;
		border: 0;
		border-radius: 3px;
		padding: 8px;
		margin: 8px 0;
		resize: vertical;
	}
	input[type='range'] {
		width: 100%;
		-webkit-appearance: none;
		appearance: none;
		height: 18px;
		background: transparent;
	}
	input[type='range']::-webkit-slider-runnable-track {
		height: 3px;
		background: #d9d9d9;
		border-radius: 0;
	}
	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		background: var(--ink);
		border: 0;
		border-radius: 50%;
		margin-top: -4.5px;
		cursor: pointer;
	}
	input[type='range']::-moz-range-track {
		height: 3px;
		background: #d9d9d9;
		border: 0;
	}
	input[type='range']::-moz-range-thumb {
		width: 12px;
		height: 12px;
		background: var(--ink);
		border: 0;
		border-radius: 50%;
		cursor: pointer;
	}
	.repl-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 8px;
	}
	.repl-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.sublabel {
		color: var(--dim);
		margin: 16px 0 8px;
	}
	.repl-select {
		font: inherit;
		background: #f7f7f7;
		border: 0;
		border-radius: 3px;
		padding: 6px 8px;
	}
	.case {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--dim);
		font-size: 13px;
	}
</style>
