<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { BookNode, ChapterNode, Counts, DialogData, EssayNode, Library } from '#lib/types';
	import Pie from './Pie.svelte';
	import ChangesDialog from './ChangesDialog.svelte';

	let {
		library,
		selectedPath,
		onselect
	}: { library: Library; selectedPath: string | null; onselect: (path: string) => void } = $props();

	let openBooks = $state<Record<string, boolean>>({});
	let openChapters = $state<Record<string, boolean>>({});
	let dialog = $state<DialogData | null>(null);

	const essayCount = $derived(library.books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.essays.length, 0), 0));

	onMount(() => {
		const b = library.books[0];
		if (!b) return;
		openBooks[b.path] = true;
		const c = b.chapters[0];
		if (c) openChapters[c.path] = true;
	});

	$effect(() => {
		const p = selectedPath;
		if (!p) return;
		const parts = p.split('/');
		const book = parts[0];
		const chapter = parts.slice(0, 2).join('/');
		if (!openBooks[book]) openBooks[book] = true;
		if (!openChapters[chapter]) openChapters[chapter] = true;
	});

	function toggleBook(path: string) {
		openBooks[path] = !openBooks[path];
	}

	function toggleChapter(path: string) {
		openChapters[path] = !openChapters[path];
	}

	function essayData(essay: EssayNode): DialogData {
		return {
			title: essay.title,
			level: 'есей',
			counts: essay.counts,
			essays: [{ title: essay.title, added: essay.changes.added, removed: essay.changes.removed, required: essay.required }],
			paths: [essay.path]
		};
	}

	function chapterData(chapter: ChapterNode): DialogData {
		return {
			title: chapter.title,
			level: 'розділ',
			counts: chapter.counts,
			essays: chapter.essays.map((e) => ({ title: e.title, added: e.changes.added, removed: e.changes.removed, required: e.required })),
			paths: chapter.essays.map((e) => e.path)
		};
	}

	function bookData(book: BookNode): DialogData {
		return {
			title: book.title,
			level: 'книга',
			counts: book.counts,
			essays: book.chapters.flatMap((c) =>
				c.essays.map((e) => ({ title: e.title, added: e.changes.added, removed: e.changes.removed, required: e.required }))
			),
			paths: book.chapters.flatMap((c) => c.essays.map((e) => e.path))
		};
	}

	async function acknowledge(paths: string[]) {
		dialog = null;
		await fetch('/api/ack', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ paths })
		});
		await invalidateAll();
	}

	async function setRequired(paths: string[], value: boolean) {
		dialog = null;
		await fetch('/api/required', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ paths, value })
		});
		await invalidateAll();
	}

	function summary(counts: Counts): string {
		return `озвучено ${counts.done}, оновлення ${counts.update}, порожньо ${counts.empty}`;
	}
</script>

<aside>
	<header>
		<h1>rationality tts</h1>
		<div class="meta">{essayCount} есеїв · {library.totals.done} озвучено · {library.totals.update} оновлень</div>
		<div class="meta"><a href="/ipa">ipa / arpabet</a></div>
	</header>

	<nav>
		{#each library.books as book}
			<div class="row book" class:notreq={book.chapters.every((c) => c.essays.every((e) => !e.required))}>
				<button
					class="pie"
					onclick={(e) => {
						e.stopPropagation();
						dialog = bookData(book);
					}}
					aria-label={summary(book.counts)}
					title={summary(book.counts)}
				>
					<Pie counts={book.counts} size={14} />
				</button>
				<button class="name" onclick={() => toggleBook(book.path)}>
					<span class="label">{book.title}</span>
				</button>
			</div>
			{#if openBooks[book.path]}
				{#each book.chapters as chapter}
					<div class="row chapter" class:notreq={chapter.essays.every((e) => !e.required)}>
						<button
							class="pie"
							onclick={(e) => {
								e.stopPropagation();
								dialog = chapterData(chapter);
							}}
							aria-label={summary(chapter.counts)}
							title={summary(chapter.counts)}
						>
							<Pie counts={chapter.counts} size={12} />
						</button>
						<button class="name" onclick={() => toggleChapter(chapter.path)}>
							<span class="label">{chapter.title}</span>
						</button>
					</div>
					{#if openChapters[chapter.path]}
						{#each chapter.essays as essay}
							<div class="row essay" class:active={selectedPath === essay.path} class:notreq={!essay.required}>
								<button
									class="pie"
									onclick={(e) => {
										e.stopPropagation();
										dialog = essayData(essay);
									}}
									aria-label={summary(essay.counts)}
									title={summary(essay.counts)}
								>
									<Pie counts={essay.counts} size={10} />
								</button>
								<button class="name" onclick={() => onselect(essay.path)} title={!essay.required ? 'не потребує TTS' : ''}>
									<span class="label">{essay.title}</span>
								</button>
							</div>
						{/each}
					{/if}
				{/each}
			{/if}
		{/each}
	</nav>
</aside>

{#if dialog}
	<ChangesDialog data={dialog} onclose={() => (dialog = null)} onack={acknowledge} onrequired={setRequired} />
{/if}

<style>
	aside {
		position: fixed;
		top: 0;
		bottom: 0;
		left: 0;
		width: 320px;
		padding: 28px 20px 120px 28px;
		overflow: auto;
		background: #fff;
		z-index: 20;
	}
	header {
		margin-bottom: 28px;
	}
	.meta {
		color: var(--dim);
		margin-top: 6px;
	}
	nav {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 7px;
		min-height: 26px;
	}
	.row.book {
		margin-top: 10px;
	}
	.row.chapter {
		padding-left: 18px;
	}
	.row.essay {
		padding-left: 36px;
	}
	.pie {
		display: flex;
		flex: none;
		width: 16px;
		height: 16px;
		align-items: center;
		justify-content: center;
	}
	.name {
		min-width: 0;
		text-align: left;
		padding: 2px 0;
	}
	.label {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		line-height: 1.4;
	}
	.row.essay .label {
		color: #3d3d3d;
	}
	.row.essay.active .label {
		font-weight: 700;
		color: var(--ink);
	}
	.notreq .label {
		color: var(--soft);
	}
	.notreq .pie {
		opacity: 0.45;
	}
	.row.essay.active .name {
		font-weight: 700;
	}
	.row.book .label {
		font-weight: 700;
	}
	button.name:hover .label {
		color: var(--ink);
	}
</style>
