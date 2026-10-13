import { describe, expect, it } from 'vitest';
import { detectProvenance } from '../src/provenance';

const sha = 'a'.repeat(40);

describe('F05 CI provenance', () => {
  it.each([
    ['github_actions', { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: sha, GITHUB_RUN_ID: '1', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' }],
    ['gitlab_ci', { GITLAB_CI: 'true', CI_PROJECT_PATH: 'o/r', CI_COMMIT_SHA: sha, CI_PIPELINE_ID: '2', CI_COMMIT_BRANCH: 'main' }],
    ['azure_pipelines', { TF_BUILD: 'True', BUILD_REPOSITORY_NAME: 'o/r', BUILD_SOURCEVERSION: sha, BUILD_BUILDID: '3', BUILD_SOURCEBRANCH: 'refs/heads/main' }],
    ['bitrise', { BITRISE_IO: 'true', GIT_REPOSITORY_URL: 'o/r', GIT_CLONE_COMMIT_HASH: sha, BITRISE_BUILD_SLUG: '4', BITRISE_GIT_BRANCH: 'main' }],
    ['codemagic', { CM_BUILD_ID: '5', CM_REPO_SLUG: 'o/r', CM_COMMIT: sha, CM_BRANCH: 'main' }],
  ] as const)('detects %s from its allowlist', (provider, env) => {
    expect(detectProvenance({ ...env, SECRET_SHOULD_NOT_APPEAR: 'secret' })).toMatchObject({
      provider,
      commit_sha: sha,
      branch: 'main',
    });
    expect(JSON.stringify(detectProvenance(env))).not.toContain('SECRET_SHOULD_NOT_APPEAR');
  });

  it('uses deterministic provider precedence', () => {
    expect(detectProvenance({ GITHUB_ACTIONS: 'true', GITLAB_CI: 'true' }).provider).toBe('github_actions');
  });
});
