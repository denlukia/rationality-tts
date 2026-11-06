<script lang="ts">
	import { onMount } from 'svelte';

	interface Info {
		authRequired: boolean;
		authed: boolean;
		repo: string;
		hasToken: boolean;
		connected: boolean;
		startedAt: number;
		budgetSec: number;
		remainingSec: number;
		dirty: boolean;
		lastCommit: { sha: string; message: string; at: number } | null;
		lastError: string | null;
	}

	let info = $state<Info | null>(null);
	let open = $state(false);
	let busy = $state(false);
	let message = $state('');
	const warned = new Set<number>();

	async function refresh() {
		try {
			const r = await fetch('/api/session');
			if (!r.ok) return;
			const next = (await r.json()) as Info;
			info = next;
			checkBudget(next);
		} catch {
			/* offline */
		}
	}

	function hhmm(sec: number): string {
		const s = Math.max(0, sec);
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m} хв`;
	}

	function time(at: number): string {
		return new Date(at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
	}

	function checkBudget(next: Info) {
		if (!next.budgetSec) return;
		for (const mark of [900, 300, 60]) {
			if (next.remainingSec <= mark && next.remainingSec > mark - 40 && !warned.has(mark)) {
				warned.add(mark);
				void save(`перед завершенням сесії (${hhmm(mark)} залишилось)`);
			}
		}
	}

	async function save(text?: string) {
		if (busy || !info?.connected) return;
		busy = true;
		message = '';
		try {
			const r = await fetch('/api/session/commit', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ message: text })
			});
			const data = await r.json().catch(() => ({}));
			if (!r.ok) {
				message = data.error ?? 'не вдалося зберегти';
				return;
			}
			message = data.committed ? `збережено ${data.sha}` : 'немає змін';
			await refresh();
		} catch {
			message = 'немає зв’язку';
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		void refresh();
		const timer = setInterval(refresh, 30_000);
		return () => clearInterval(timer);
	});
</script>

{#if info && (info.budgetSec > 0 || info.connected)}
	<div class="session">
		{#if open}
			<div class="pop">
				<div class="repo">{info.repo}</div>
				{#if info.lastCommit}
					<div>коміт {info.lastCommit.sha} · {time(info.lastCommit.at)}</div>
				{:else}
					<div>ще не збережено в цій сесії</div>
				{/if}
				{#if info.dirty}
					<div class="warn">є незбережені зміни</div>
				{/if}
				{#if info.lastError}
					<div class="warn">{info.lastError}</div>
				{/if}
				{#if message}
					<div class="note">{message}</div>
				{/if}
				<button class="black" onclick={() => save()} disabled={busy || !info.connected}>
					{busy ? 'зберігаю…' : 'зберегти зараз'}
				</button>
			</div>
		{/if}
		<button class="line" onclick={() => (open = !open)} title="сесія">
			<span class="dot" class:dirty={info.dirty} class:error={info.lastError}></span>
			{#if info.budgetSec}
				<span class="clock" class:low={info.remainingSec < 600}>{hhmm(info.remainingSec)}</span>
			{:else}
				<span>{info.connected ? info.repo.split('/')[1] : 'локально'}</span>
			{/if}
		</button>
	</div>
{/if}

<style>
	.session {
		position: fixed;
		left: 24px;
		bottom: 78px;
		z-index: 46;
		font-size: 13px;
		color: var(--dim);
	}
	.line {
		display: flex;
		align-items: center;
		gap: 7px;
		background: transparent;
		border: 0;
		padding: 4px 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--green);
	}
	.dot.dirty {
		background: var(--yellow);
	}
	.dot.error {
		background: #b00020;
	}
	.clock {
		font-variant-numeric: tabular-nums;
	}
	.clock.low {
		color: #b00020;
	}
	.pop {
		position: absolute;
		left: 0;
		bottom: 28px;
		width: 250px;
		background: #fff;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		line-height: 1.4;
	}
	.repo {
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	.warn {
		color: #b00020;
	}
	.note {
		color: var(--ink);
	}
	.black {
		background: var(--ink);
		color: #fff;
		border-radius: 3px;
		padding: 6px 10px;
		font: inherit;
		margin-top: 6px;
		align-self: flex-start;
	}
	.black:disabled {
		background: #e9e9e9;
		color: var(--ink);
	}
</style>
