				import worker, * as OTHER_EXPORTS from "/home/skeptrune/git_projects/backgammon/worker/index.ts";
				import * as __MIDDLEWARE_0__ from "/home/skeptrune/git_projects/backgammon/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts";
import * as __MIDDLEWARE_1__ from "/home/skeptrune/git_projects/backgammon/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts";

				export * from "/home/skeptrune/git_projects/backgammon/worker/index.ts";
				const MIDDLEWARE_TEST_INJECT = "__INJECT_FOR_TESTING_WRANGLER_MIDDLEWARE__";
				export const __INTERNAL_WRANGLER_MIDDLEWARE__ = [
					
					__MIDDLEWARE_0__.default,__MIDDLEWARE_1__.default
				]
				export default worker;