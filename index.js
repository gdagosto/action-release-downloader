'use strict';

const { createWriteStream } = require('node:fs');
const { appendFile, mkdir, rename, rm } = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { randomUUID } = require('node:crypto');

function matcher(pattern) {
  const expression = [...pattern].map(character => {
    if (character === '*') return '.*';
    if (character === '?') return '.';
    return character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }).join('');
  return new RegExp(`^${expression}$`, 'su');
}

async function download({ tag, filename, repository, token, destination,
  apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  if (!tag || !filename || !token) throw new Error('tag, filename, and token are required.');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository || '')) {
    throw new Error('repository must have the form owner/repo.');
  }
  const base = `${apiUrl.replace(/\/$/, '')}/repos/${repository.split('/').map(encodeURIComponent).join('/')}`;
  async function request(url, accept = 'application/vnd.github+json') {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'action-release-downloader' },
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) throw new Error(`GitHub request failed (${response.status}) for ${url}.`);
    return response;
  }
  async function* pages(endpoint) {
    for (let page = 1; ; page++) {
      const response = await request(`${base}/${endpoint}?per_page=100&page=${page}`);
      const items = await response.json();
      if (!Array.isArray(items)) throw new Error('GitHub returned an unexpected response.');
      yield items;
      if (items.length < 100) return;
    }
  }
  let release;
  for await (const items of pages('releases')) {
    release = items.find(item => item.tag_name === tag);
    if (release) break;
  }
  if (!release) throw new Error(`No accessible release matches tag ${JSON.stringify(tag)} in ${repository}.`);
  const matches = [];
  const pattern = matcher(filename);
  for await (const items of pages(`releases/${release.id}/assets`)) {
    matches.push(...items.filter(asset => pattern.test(asset.name)));
  }
  if (!matches.length) throw new Error(`No assets match ${JSON.stringify(filename)} in release ${release.id}.`);
  const directory = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd(), destination || '.');
  const files = matches.map(asset => {
    if (!asset.name || asset.name === '.' || asset.name === '..' || /[/\\\x00-\x1f]/.test(asset.name)) {
      throw new Error('Release asset has an unsafe filename.');
    }
    return path.join(directory, asset.name);
  });
  await mkdir(directory, { recursive: true });
  for (let i = 0; i < matches.length; i++) {
    const temporary = path.join(directory, `.release-download-${randomUUID()}.tmp`);
    try {
      const response = await request(`${base}/releases/assets/${matches[i].id}`, 'application/octet-stream');
      if (!response.body) throw new Error('GitHub returned an empty response body.');
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
      await rename(temporary, files[i]);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return files;
}

async function main() {
  const input = name => (process.env[`INPUT_${name.toUpperCase()}`] || '').trim();
  const files = await download({ tag: input('tag'), filename: input('filename'),
    repository: input('repository') || process.env.GITHUB_REPOSITORY,
    token: input('token'), destination: input('destination'), apiUrl: process.env.GITHUB_API_URL });
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is not set.');
  await appendFile(process.env.GITHUB_OUTPUT, `file-paths=${JSON.stringify(files)}\n`);
  console.log(`Downloaded ${files.length} release asset(s).`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { download, matcher };
