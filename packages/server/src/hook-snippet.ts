import { hookSettingsSnippet } from '@acp/adapter-claude-code';
import { loadConfig } from './config.js';

/**
 * Prints the Claude Code hook settings for the user to paste into their own settings file. The app
 * never writes Claude settings (AGENTS.md §3.6). The token is referenced through an environment
 * variable, so the printed text never contains the secret itself.
 */
export const HOOK_TOKEN_ENV_VAR = 'ACP_HOOK_TOKEN';

const config = loadConfig(process.env);
process.stdout.write(hookSettingsSnippet({ port: config.port, tokenEnvVar: HOOK_TOKEN_ENV_VAR }));
process.stderr.write(
  `\nSet ${HOOK_TOKEN_ENV_VAR} to the contents of ${config.hookTokenPath} in the environment Claude Code runs in.\n`,
);
