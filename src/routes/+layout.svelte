<script lang="ts">
	import '@fontsource/geologica/500.css';
	import '@fontsource/geologica/700.css';
	import '../style.css';
	import LoginScreen from '#lib/components/LoginScreen.svelte';
	import SessionWidget from '#lib/components/SessionWidget.svelte';

	let { data, children } = $props();
</script>

{#if data.auth.required && !data.auth.authed}
	<LoginScreen />
{:else}
	{@render children()}
	<SessionWidget />
{/if}
