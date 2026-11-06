<script lang="ts">
	import { onMount } from 'svelte';

	let token = $state('');
	let repo = $state('denlukia/rationality-tts-data');
	let busy = $state(false);
	let error = $state('');

	onMount(async () => {
		try {
			const r = await fetch('/api/session');
			if (r.ok) {
				const info = await r.json();
				if (info.repo) repo = info.repo;
			}
		} catch {
			/* ignore */
		}
	});

	async function submit() {
		if (busy || !token.trim()) return;
		busy = true;
		error = '';
		try {
			const r = await fetch('/api/session/connect', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token: token.trim(), repo: repo.trim() })
			});
			const data = await r.json().catch(() => ({}));
			if (!r.ok) {
				error = data.error ?? 'не вдалося підключитися';
				return;
			}
			location.reload();
		} catch {
			error = 'немає зв’язку із сервером';
		} finally {
			busy = false;
		}
	}
</script>

<main>
	<div class="box">
		<h1>rationality tts</h1>
		<p class="dim">Вставте GitHub token із доступом до репозиторію даних. Він живе лише в пам’яті цієї сесії.</p>

		<label>
			<span>github token</span>
			<input
				type="password"
				bind:value={token}
				autocomplete="off"
				spellcheck="false"
				placeholder="github_pat_…"
				onkeydown={(e) => e.key === 'Enter' && submit()}
			/>
		</label>

		<label>
			<span>репозиторій</span>
			<input
				bind:value={repo}
				autocomplete="off"
				spellcheck="false"
				onkeydown={(e) => e.key === 'Enter' && submit()}
			/>
		</label>

		<button class="black" onclick={submit} disabled={busy || !token.trim()}>
			{busy ? 'підключаю…' : 'увійти'}
		</button>

		{#if error}
			<p class="err">{error}</p>
		{/if}

		<p class="hint">
			Fine-grained token: Contents — read/write, Metadata — read, лише цей репозиторій.
		</p>
	</div>
</main>

<style>
	main {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: #fff;
		padding: 32px;
		z-index: 200;
	}
	.box {
		width: min(420px, 100%);
	}
	h1 {
		font-size: 15px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		margin-bottom: 20px;
	}
	.dim {
		color: var(--dim);
		line-height: 1.5;
		margin-bottom: 24px;
	}
	label {
		display: block;
		margin-bottom: 16px;
	}
	label span {
		display: block;
		color: var(--dim);
		margin-bottom: 6px;
	}
	input {
		width: 100%;
		font: inherit;
		background: #f7f7f7;
		border: 0;
		border-radius: 3px;
		padding: 9px 10px;
	}
	.black {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 8px 14px;
	}
	.black:disabled {
		background: #e9e9e9;
		color: var(--ink);
	}
	.err {
		color: #b00020;
		margin-top: 14px;
		line-height: 1.4;
	}
	.hint {
		color: var(--dim);
		margin-top: 24px;
		line-height: 1.5;
		font-size: 13px;
	}
</style>
