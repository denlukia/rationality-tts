<script lang="ts">
	let text = $state('');
	let stressed = $state('');
	let ipa = $state('');
	let arpabet = $state('');
	let loading = $state(false);
	let textarea: HTMLTextAreaElement | undefined = $state();

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
	{#if ipa}
		<div class="block">
			<div class="label">з наголосами</div>
			<p>{stressed}</p>
		</div>
		<div class="block">
			<div class="label">ipa</div>
			<p>{ipa}</p>
		</div>
		<div class="block">
			<div class="label">arpabet</div>
			<p>{arpabet}</p>
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
		min-height: 120px;
		font: inherit;
		background: #f7f7f7;
		border: 0;
		border-radius: 3px;
		padding: 10px;
		resize: vertical;
		margin-bottom: 12px;
	}
	.row {
		display: flex;
		gap: 8px;
		margin-bottom: 24px;
	}
	.black {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 7px 11px;
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
</style>
