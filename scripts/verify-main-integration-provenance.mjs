const eventName = process.env.GITHUB_EVENT_NAME;
const ref = process.env.GITHUB_REF;

if (eventName !== 'push' || ref !== 'refs/heads/main') {
  console.log('VSN Voice AI main integration provenance check skipped outside a main push.');
  process.exit(0);
}

const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
const token = process.env.GITHUB_TOKEN;

if (!repository || !sha || !token) {
  throw new Error(
    'Main integration provenance verification requires GITHUB_REPOSITORY, GITHUB_SHA, and GITHUB_TOKEN.',
  );
}

const endpoint = `https://api.github.com/repos/${repository}/commits/${sha}/pulls`;
const response = await fetch(endpoint, {
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'vsn-voice-ai-main-integration-provenance',
  },
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`GitHub commit-to-PR lookup failed (${response.status}): ${body.slice(0, 500)}`);
}

const pullRequests = await response.json();
if (!Array.isArray(pullRequests)) {
  throw new Error('GitHub commit-to-PR lookup returned a non-array payload.');
}

const validMergedPullRequests = pullRequests.filter(
  (pullRequest) =>
    pullRequest &&
    pullRequest.merged_at &&
    pullRequest.state === 'closed' &&
    pullRequest.base?.ref === 'main',
);

if (validMergedPullRequests.length === 0) {
  throw new Error(
    `Main commit ${sha} is not associated with a merged pull request targeting main. Direct main pushes are not an approved integration path.`,
  );
}

const references = validMergedPullRequests
  .map((pullRequest) => `#${pullRequest.number}`)
  .join(', ');

console.log(
  `VSN Voice AI main integration provenance passed for ${sha} via merged PR ${references}.`,
);
