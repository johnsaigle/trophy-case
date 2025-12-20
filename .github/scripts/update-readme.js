const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');

const octokit = new Octokit({
  auth: process.env.PAT_READ_ONLY
});

// Parse repository URL to extract owner and repo
function parseRepoUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

// Get count of merged PRs by author
async function getMergedPRCount(owner, repo, author) {
  try {
    const response = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:merged author:${author}`,
      per_page: 1
    });
    return response.data.total_count;
  } catch (error) {
    console.error(`Error fetching merged PRs for ${owner}/${repo}:`, error.message);
    return 0;
  }
}

// Get count of open PRs by author
async function getOpenPRCount(owner, repo, author) {
  try {
    const response = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:open author:${author}`,
      per_page: 1
    });
    return response.data.total_count;
  } catch (error) {
    console.error(`Error fetching open PRs for ${owner}/${repo}:`, error.message);
    return 0;
  }
}

// Get count of issues by author (can be open or closed)
async function getIssueCount(owner, repo, author) {
  try {
    const response = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:issue author:${author}`,
      per_page: 1
    });
    return response.data.total_count;
  } catch (error) {
    console.error(`Error fetching issues for ${owner}/${repo}:`, error.message);
    return 0;
  }
}

// Special case for M0 Foundation repos (searches for "AR" in PR title/body)
async function getM0Stats(owner, repo) {
  try {
    const [closedResponse, openResponse] = await Promise.all([
      octokit.rest.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} is:pr is:closed "AR"`,
        per_page: 1
      }),
      octokit.rest.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} is:pr is:open "AR"`,
        per_page: 1
      })
    ]);
    return { 
      mergedPRs: closedResponse.data.total_count, 
      openPRs: openResponse.data.total_count,
      issues: 0 
    };
  } catch (error) {
    console.error(`Error fetching M0 PRs for ${owner}/${repo}:`, error.message);
    return { mergedPRs: 0, openPRs: 0, issues: 0 };
  }
}

// Process a line and add stats if it contains a GitHub repo link
async function processLine(line) {
  // Skip if line doesn't contain a GitHub link
  if (!line.includes('github.com')) {
    return line;
  }

  // Extract the markdown link
  const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (!linkMatch) {
    return line;
  }

  const linkText = linkMatch[1];
  const linkUrl = linkMatch[2];
  
  // Skip if the link is to a specific PR, issue, discussion, or commit
  if (linkUrl.match(/\/(pull|issues|discussions|commit)\/\d+/) || linkUrl.includes('/commit/')) {
    return line;
  }
  
  const repoInfo = parseRepoUrl(linkUrl);
  if (!repoInfo) {
    return line;
  }

  const { owner, repo } = repoInfo;
  
  // Special handling for M0 Foundation repos
  const isM0Repo = owner === 'm0-foundation';
  
  let mergedPRs, openPRs, issues;
  
  if (isM0Repo) {
    const stats = await getM0Stats(owner, repo);
    mergedPRs = stats.mergedPRs;
    openPRs = stats.openPRs;
    issues = stats.issues;
  } else {
    // Standard repos - use johnsaigle as author
    [mergedPRs, openPRs, issues] = await Promise.all([
      getMergedPRCount(owner, repo, 'johnsaigle'),
      getOpenPRCount(owner, repo, 'johnsaigle'),
      getIssueCount(owner, repo, 'johnsaigle')
    ]);
  }

  console.log(`${owner}/${repo}: ${openPRs} open PRs, ${mergedPRs} merged PRs, ${issues} issues`);

  // Build the stats string
  const stats = [];
  if (openPRs > 0) stats.push(`${openPRs} open PR${openPRs !== 1 ? 's' : ''}`);
  if (mergedPRs > 0) stats.push(`${mergedPRs} merged PR${mergedPRs !== 1 ? 's' : ''}`);
  if (issues > 0) stats.push(`${issues} issue${issues !== 1 ? 's' : ''}`);
  
  if (stats.length === 0) {
    return line; // No stats to add
  }

  const statsString = ` (${stats.join(', ')})`;

  // Find everything before the link
  const beforeLink = line.substring(0, line.indexOf(linkMatch[0]));
  
  // Find everything after the link (excluding any existing stats in parentheses)
  const afterLinkIndex = line.indexOf(linkMatch[0]) + linkMatch[0].length;
  const afterLink = line.substring(afterLinkIndex);
  
  // Remove any existing stats from afterLink (anything in parentheses that contains PR or issue)
  const afterLinkCleaned = afterLink.replace(/\s*\([^)]*(?:PR|issue)[^)]*\)/g, '').trim();
  
  // Reconstruct: before + link + stats + cleaned after
  return beforeLink + linkMatch[0] + statsString + (afterLinkCleaned ? ' ' + afterLinkCleaned : '');
}

async function updateReadme() {
  const readmePath = path.join(process.cwd(), 'README.md');
  const content = fs.readFileSync(readmePath, 'utf8');
  const lines = content.split('\n');

  const updatedLines = [];
  let inCodeReviewSection = false;
  
  for (const line of lines) {
    // Track when we enter the Code Review section
    if (line.includes('# Code Review and Security Engineering')) {
      inCodeReviewSection = true;
      updatedLines.push(line);
      continue;
    }
    
    // Track when we leave the Code Review section (next # heading)
    if (inCodeReviewSection && line.match(/^# [^#]/)) {
      inCodeReviewSection = false;
    }
    
    // Only process lines in the Code Review section
    if (inCodeReviewSection) {
      const updatedLine = await processLine(line);
      updatedLines.push(updatedLine);
    } else {
      updatedLines.push(line);
    }
  }

  const updatedContent = updatedLines.join('\n');
  fs.writeFileSync(readmePath, updatedContent, 'utf8');
  
  console.log('README updated successfully!');
}

updateReadme().catch(error => {
  console.error('Error updating README:', error);
  process.exit(1);
});
