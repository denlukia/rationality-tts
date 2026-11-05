<script lang="ts">
	import type { Counts } from '#lib/types';

	let { counts, size = 14 }: { counts: Counts; size?: number } = $props();

	const total = $derived(Math.max(1, counts.done + counts.update + counts.empty));
	const r = $derived(size / 2 - 1.4);
	const circ = $derived(2 * Math.PI * r);
	const green = $derived((counts.done / total) * circ);
	const yellow = $derived((counts.update / total) * circ);
</script>

<svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
	<circle
		cx={size / 2}
		cy={size / 2}
		{r}
		fill="none"
		stroke="var(--empty)"
		stroke-width="2.4"
	/>
	{#if counts.done > 0}
		<circle
			cx={size / 2}
			cy={size / 2}
			{r}
			fill="none"
			stroke="var(--green)"
			stroke-width="2.4"
			stroke-dasharray={`${green} ${circ}`}
			transform={`rotate(-90 ${size / 2} ${size / 2})`}
		/>
	{/if}
	{#if counts.update > 0}
		<circle
			cx={size / 2}
			cy={size / 2}
			{r}
			fill="none"
			stroke="var(--yellow)"
			stroke-width="2.4"
			stroke-dasharray={`${yellow} ${circ}`}
			stroke-dashoffset={-green}
			transform={`rotate(-90 ${size / 2} ${size / 2})`}
		/>
	{/if}
</svg>
