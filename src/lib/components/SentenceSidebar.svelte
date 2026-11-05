<script lang="ts">
	import type { SentenceView } from '#lib/types';

	let {
		sentence,
		pi,
		si,
		busy,
		playing,
		onclose,
		onsave,
		ontts,
		onplay
	}: {
		sentence: SentenceView;
		pi: number;
		si: number;
		busy: boolean;
		playing: boolean;
		onclose: () => void;
		onsave: (patch: string) => Promise<void>;
		ontts: () => void;
		onplay: () => void;
	} = $props();

	let draft = $state('');
	let saving = $state(false);
	let selection = $derived(`${pi}:${si}`);

	$effect(() => {
		selection;
		draft = sentence.patch;
	});

	const status = $derived(
		sentence.status === 'done' ? 'озвучено' : sentence.status === 'update' ? 'потрібно переозвучити' : 'не озвучено'
	);
	const dirty = $derived(draft.trim() !== sentence.patch);

	async function save() {
		if (!dirty || saving) return;
		saving = true;
		try {
			await onsave(draft);
		} finally {
			saving = false;
		}
	}
</script>

<aside>
	<div class="top">
		<div class="status">{status}</div>
		<button class="close" onclick={onclose} aria-label="закрити">закрити</button>
	</div>

	<div class="block">
		<div class="label">оригінал</div>
		<p class="original">{sentence.text}</p>
	</div>

	<div class="block">
		<div class="label">патч</div>
		<textarea
			bind:value={draft}
			placeholder="без змін"
			spellcheck="false"
			onkeydown={(e) => {
				if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
			}}
		></textarea>
	</div>

	<div class="actions">
		<button class="black" onclick={save} disabled={!dirty || saving}>{saving ? 'зберігаю…' : 'зберегти'}</button>
		<button class="black" onclick={ontts} disabled={busy}>{busy ? 'TTS…' : 'TTS'}</button>
		<button class="black" onclick={onplay} disabled={!sentence.audio || playing}>
			{playing ? 'грає' : '▶ прослухати'}
		</button>
	</div>

	<div class="meta">
		<span>hash {sentence.hash}</span>
		{#if sentence.audio}
			<span>{sentence.audio.duration.toFixed(1)} с</span>
		{/if}
	</div>
</aside>

<style>
	aside {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 360px;
		padding: 28px;
		overflow: auto;
		background: #fff;
		z-index: 30;
	}
	.top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 28px;
	}
	.status {
		color: var(--dim);
	}
	.close {
		color: var(--dim);
	}
	.block {
		margin-bottom: 24px;
	}
	.label {
		color: var(--dim);
		margin-bottom: 8px;
	}
	.original {
		line-height: 1.6;
	}
	textarea {
		width: 100%;
		min-height: 132px;
		resize: vertical;
		border: 0;
		outline: 0;
		background: #f7f7f7;
		border-radius: 3px;
		padding: 10px;
		font: inherit;
		line-height: 1.55;
		color: var(--ink);
	}
	textarea::placeholder {
		color: var(--soft);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 28px;
	}
	.black {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 7px 11px;
	}
	.meta {
		display: flex;
		gap: 16px;
		color: var(--dim);
	}
</style>
