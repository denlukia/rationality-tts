<script lang="ts">
	import type { DialogData } from '#lib/types';

	let { data, onclose, onack, onrequired }: { data: DialogData; onclose: () => void; onack: (paths: string[]) => void; onrequired: (paths: string[], value: boolean) => void } = $props();

	const changes = $derived(data.essays.filter((e) => e.added.length || e.removed.length));
	const totalChanges = $derived(changes.reduce((n, e) => n + e.added.length + e.removed.length, 0));
	const allRequired = $derived(data.essays.every((e) => e.required));
	const allNotRequired = $derived(data.essays.every((e) => !e.required));
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') onclose();
	}}
/>

<div
	class="overlay"
	onclick={onclose}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') onclose();
	}}
	role="presentation"
>
	<div
		class="panel"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		<div class="head">
			<div>
				<div class="level">{data.level}</div>
				<h2>{data.title}</h2>
			</div>
			<button class="close" onclick={onclose} aria-label="закрити">закрити</button>
		</div>

		<div class="counts">
			<span>озвучено {data.counts.done}</span>
			<span>потребує оновлення {data.counts.update}</span>
			<span>порожньо {data.counts.empty}</span>
		</div>

		{#if totalChanges === 0}
			<p class="empty">Після останнього оновлення нічого не змінилося.</p>
		{:else}
			<div class="list">
				{#each changes as essay}
					<div class="essay">
						<div class="essay-title">{essay.title}</div>
						{#each essay.added as item}
							<div class="item"><span class="sign">+</span><span>{item.text}</span></div>
						{/each}
						{#each essay.removed as item}
							<div class="item removed"><span class="sign">−</span><span>{item.text}</span></div>
						{/each}
					</div>
				{/each}
			</div>
			<button class="ack" onclick={() => onack(data.paths)}>позначити переглянутим</button>
		{/if}
		<div class="req">
			<button class="small" onclick={() => onrequired(data.paths, false)} disabled={allNotRequired}>не потребує TTS</button>
			<button class="small" onclick={() => onrequired(data.paths, true)} disabled={allRequired}>потребує TTS</button>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 100;
		display: grid;
		place-items: center;
		padding: 32px;
	}
	.panel {
		width: min(680px, 100%);
		max-height: 78vh;
		overflow: auto;
		background: #fff;
		padding: 8px;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
	}
	.level {
		color: var(--dim);
		margin-bottom: 6px;
	}
	.close {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 6px 10px;
	}
	.counts {
		display: flex;
		gap: 18px;
		flex-wrap: wrap;
		color: var(--dim);
		margin: 18px 0 28px;
	}
	.empty {
		color: var(--dim);
		padding: 8px 0 16px;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 24px;
		margin-bottom: 32px;
	}
	.essay-title {
		font-weight: 700;
		margin-bottom: 8px;
	}
	.item {
		display: flex;
		gap: 8px;
		line-height: 1.55;
		color: var(--ink);
	}
	.item.removed {
		color: var(--dim);
	}
	.sign {
		width: 12px;
		flex: none;
		color: var(--dim);
	}
	.ack {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 8px 12px;
	}
	.req {
		display: flex;
		gap: 8px;
		margin-top: 16px;
	}
	.small {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 7px 11px;
	}
	.small:disabled {
		opacity: 0.3;
	}
</style>
