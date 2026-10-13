export type CiProvider = 'local' | 'github_actions' | 'gitlab_ci' | 'azure_pipelines' | 'bitrise' | 'codemagic';
export interface Provenance {
  provider: CiProvider;
  repository: string | null;
  commit_sha: string | null;
  run_id: string | null;
  branch: string | null;
  tag: string | null;
}

type Env = Record<string, string | undefined>;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const bounded = (value: string | undefined): string | null => value ? value.slice(0, 500) : null;
const commit = (value: string | undefined): string | null => {
  const normalized = value?.toLowerCase();
  return normalized && SHA.test(normalized) ? normalized : null;
};

export function detectProvenance(env: Env = process.env): Provenance {
  if (env.GITHUB_ACTIONS === 'true') {
    return {
      provider: 'github_actions',
      repository: bounded(env.GITHUB_REPOSITORY),
      commit_sha: commit(env.GITHUB_SHA),
      run_id: bounded(env.GITHUB_RUN_ID),
      branch: env.GITHUB_REF_TYPE === 'branch' ? bounded(env.GITHUB_REF_NAME) : null,
      tag: env.GITHUB_REF_TYPE === 'tag' ? bounded(env.GITHUB_REF_NAME) : null,
    };
  }
  if (env.GITLAB_CI === 'true') {
    return {
      provider: 'gitlab_ci',
      repository: bounded(env.CI_PROJECT_PATH),
      commit_sha: commit(env.CI_COMMIT_SHA),
      run_id: bounded(env.CI_PIPELINE_ID),
      branch: bounded(env.CI_COMMIT_BRANCH),
      tag: bounded(env.CI_COMMIT_TAG),
    };
  }
  if (env.TF_BUILD === 'True') {
    const ref = env.BUILD_SOURCEBRANCH;
    return {
      provider: 'azure_pipelines',
      repository: bounded(env.BUILD_REPOSITORY_NAME),
      commit_sha: commit(env.BUILD_SOURCEVERSION),
      run_id: bounded(env.BUILD_BUILDID),
      branch: ref?.startsWith('refs/heads/') ? bounded(ref.slice(11)) : bounded(env.BUILD_SOURCEBRANCHNAME),
      tag: ref?.startsWith('refs/tags/') ? bounded(ref.slice(10)) : null,
    };
  }
  if (env.BITRISE_IO === 'true') {
    return {
      provider: 'bitrise',
      repository: bounded(env.GIT_REPOSITORY_URL),
      commit_sha: commit(env.GIT_CLONE_COMMIT_HASH),
      run_id: bounded(env.BITRISE_BUILD_SLUG),
      branch: bounded(env.BITRISE_GIT_BRANCH),
      tag: bounded(env.BITRISE_GIT_TAG),
    };
  }
  if (env.CM_BUILD_ID) {
    return {
      provider: 'codemagic',
      repository: bounded(env.CM_REPO_SLUG),
      commit_sha: commit(env.CM_COMMIT),
      run_id: bounded(env.CM_BUILD_ID),
      branch: bounded(env.CM_BRANCH),
      tag: bounded(env.CM_TAG),
    };
  }
  return { provider: 'local', repository: null, commit_sha: null, run_id: null, branch: null, tag: null };
}
