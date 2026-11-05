import type { LayoutServerLoad } from './$types';
import { getLibrary } from '#lib/server/library';

export const load: LayoutServerLoad = () => {
	return { library: getLibrary() };
};
