// See https://svelte.dev/docs/kit/types#app
declare global {
	namespace App {
		interface Locals {
			authed: boolean;
			authRequired: boolean;
		}
	}
}

export {};
