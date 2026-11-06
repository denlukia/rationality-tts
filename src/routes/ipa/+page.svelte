<script lang="ts">
	import { onMount } from 'svelte';

	let text = $state('');
	let stressed = $state('');
	let ipa = $state('');
	let arpabet = $state('');
	let loading = $state(false);
	let playing = $state<string | null>(null);
	let textarea: HTMLTextAreaElement | undefined = $state();
	let engine = $state<'holos' | 'drama'>('holos');
	let voice = $state('');
	let dramaVoice = $state('');

	onMount(async () => {
		try {
			const r = await fetch('/api/settings');
			if (r.ok) {
				const s = await r.json();
				engine = s.engine === 'drama' ? 'drama' : 'holos';
				voice = s.voice ?? '';
				dramaVoice = s.dramaVoice ?? '';
			}
		} catch {
			/* ignore */
		}
	});

	async function convert() {
		if (!text.trim()) return;
		loading = true;
		try {
			const r = await fetch('/api/ipa', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text })
			});
			if (!r.ok) return;
			const d = await r.json();
			stressed = d.stressed;
			ipa = d.ipa;
			arpabet = d.arpabet;
		} finally {
			loading = false;
		}
	}

	async function speak(variant: 'stressed' | 'ipa' | 'arpabet') {
		const t = variant === 'stressed' ? stressed : variant === 'ipa' ? ipa : arpabet;
		if (!t.trim()) return;
		playing = variant;
		try {
			const v = engine === 'drama' ? dramaVoice : voice;
			const r = await fetch('/api/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: t, voice: v, engine, speed: 1 })
			});
			if (!r.ok) return;
			const d = await r.json();
			const audio = new Audio(d.url);
			audio.onended = () => (playing = null);
			audio.onerror = () => (playing = null);
			await audio.play();
		} catch {
			playing = null;
		}
	}

	function insertStress() {
		if (!textarea) return;
		const start = textarea.selectionStart;
		if (start === 0) return;
		text = text.slice(0, start) + '\u0301' + text.slice(start);
		requestAnimationFrame(() => {
			if (!textarea) return;
			textarea.focus();
			textarea.selectionStart = textarea.selectionEnd = start + 1;
		});
	}
</script>

<svelte:head>
	<title>ipa / arpabet</title>
</svelte:head>

<main>
	<h1>ipa / arpabet</h1>
	<textarea bind:this={textarea} bind:value={text} placeholder="введіть текст українською"></textarea>
	<div class="row">
		<button class="black" onclick={insertStress}>додати наголос</button>
		<button class="black" onclick={convert} disabled={loading || !text.trim()}>
			{loading ? '...' : 'перетворити'}
		</button>
		<a class="black" href="/">назад</a>
	</div>
	<div class="engine">
		<span class="dim">движок: {engine}</span>
		<span class="dim">голос: {engine === 'drama' ? (dramaVoice || 'авто') : voice}</span>
	</div>
	{#if ipa}
		<div class="block">
			<div class="label">з наголосами (редагуйте)</div>
			<textarea bind:value={stressed}></textarea>
			<button class="black small" onclick={() => speak('stressed')} disabled={playing !== null}>
				{playing === 'stressed' ? 'грає…' : '▶ прослухати'}
			</button>
		</div>
		<div class="block">
			<div class="label">ipa (редагуйте)</div>
			<textarea bind:value={ipa}></textarea>
			<button class="black small" onclick={() => speak('ipa')} disabled={playing !== null}>
				{playing === 'ipa' ? 'грає…' : '▶ прослухати'}
			</button>
		</div>
		<div class="block">
			<div class="label">arpabet (редагуйте)</div>
			<textarea bind:value={arpabet}></textarea>
			<button class="black small" onclick={() => speak('arpabet')} disabled={playing !== null}>
				{playing === 'arpabet' ? 'грає…' : '▶ прослухати'}
			</button>
		</div>
	{/if}
</main>

<style>
	main {
		max-width: 720px;
		margin: 48px auto;
		padding: 0 24px 120px;
	}
	h1 {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 24px;
	}
	textarea {
		width: 100%;
		min-height: 80px;
		font: inherit;
		background: #f7f7f7;
		border: 0;
		border-radius: 3px;
		padding: 10px;
		resize: vertical;
		margin-bottom: 8px;
	}
	.row {
		display: flex;
		gap: 8px;
		margin-bottom: 16px;
	}
	.engine {
		display: flex;
		gap: 16px;
		color: var(--dim);
		margin-bottom: 24px;
		font-size: 13px;
	}
	.black {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 7px 11px;
	}
	.black:disabled {
		background: #e9e9e9;
		color: var(--ink);
	}
	.black.small {
		padding: 5px 10px;
		font-size: 13px;
	}
	.block {
		margin-bottom: 20px;
	}
	.label {
		color: var(--dim);
		margin-bottom: 6px;
	}
	p {
		line-height: 1.6;
		word-break: break-word;
	}
	.dim {
		color: var(--dim);
	}
</style>
