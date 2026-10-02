'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, readdir, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { download, matcher } = require('../index');

async function fixture(t, routes) {
  const destination = await mkdtemp(path.join(os.tmpdir(), 'release-action-'));
  t.after(() => rm(destination, { recursive: true, force: true }));
  const calls = [];
  const options = { tag: 'v1', filename: '*.zip', repository: 'owner/repo', token: 'test-token', destination,
    fetchImpl: async (url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer test-token');
      calls.push({ url, accept: init.headers.Accept });
      const route = new URL(url).pathname.replace('/repos/owner/repo/', '') + new URL(url).search;
      assert.ok(Object.hasOwn(routes, route), `Unexpected request: ${route}`);
      const value = routes[route];
      return value instanceof Response ? value : typeof value === 'string'
        ? new Response(value) : Response.json(value);
    } };
  return { options, calls, destination };
}

test('wildcards are case-sensitive and regex characters are literal', () => {
  assert.ok(matcher('app-?.zip').test('app-1.zip'));
  assert.ok(!matcher('app-?.zip').test('app-12.zip'));
  assert.ok(!matcher('*.zip').test('app.ZIP'));
  assert.ok(matcher('a[1]+.zip').test('a[1]+.zip'));
  assert.ok(!matcher('a[1]+.zip').test('a1.zip'));
});

test('paginates releases and assets, chooses first matching draft, and overwrites files', async t => {
  const { options, calls, destination } = await fixture(t, {
    'releases?per_page=100&page=1': Array.from({ length: 100 }, (_, id) => ({ id, tag_name: 'other' })),
    'releases?per_page=100&page=2': [{ id: 101, tag_name: 'v1', draft: true }, { id: 102, tag_name: 'v1' }],
    'releases/101/assets?per_page=100&page=1': [
      { id: 1, name: 'first.zip' }, ...Array.from({ length: 99 }, (_, id) => ({ id: id + 10, name: `other-${id}.txt` }))],
    'releases/101/assets?per_page=100&page=2': [{ id: 2, name: 'second.zip' }],
    'releases/assets/1': 'first contents',
    'releases/assets/2': 'second contents',
  });
  await writeFile(path.join(destination, 'first.zip'), 'old');
  assert.deepEqual(await download(options), [path.join(destination, 'first.zip'), path.join(destination, 'second.zip')]);
  assert.equal(await readFile(path.join(destination, 'first.zip'), 'utf8'), 'first contents');
  assert.equal(await readFile(path.join(destination, 'second.zip'), 'utf8'), 'second contents');
  assert.equal(calls.at(-1).accept, 'application/octet-stream');
  assert.deepEqual((await readdir(destination)).sort(), ['first.zip', 'second.zip']);
});

test('fails when no release matches', async t => {
  const { options } = await fixture(t, { 'releases?per_page=100&page=1': [] });
  await assert.rejects(download(options), /No accessible release/);
});

test('fails when first match has no assets, without trying later releases', async t => {
  const { options } = await fixture(t, {
    'releases?per_page=100&page=1': [{ id: 1, tag_name: 'v1' }, { id: 2, tag_name: 'v1' }],
    'releases/1/assets?per_page=100&page=1': [],
  });
  await assert.rejects(download(options), /No assets match/);
});

test('rejects path traversal in asset names', async t => {
  const { options } = await fixture(t, {
    'releases?per_page=100&page=1': [{ id: 1, tag_name: 'v1' }],
    'releases/1/assets?per_page=100&page=1': [{ id: 2, name: '../escape.zip' }],
  });
  await assert.rejects(download(options), /unsafe filename/);
});

test('failed downloads preserve existing files and remove temporary files', async t => {
  const { options, destination } = await fixture(t, {
    'releases?per_page=100&page=1': [{ id: 1, tag_name: 'v1' }],
    'releases/1/assets?per_page=100&page=1': [{ id: 2, name: 'app.zip' }],
    'releases/assets/2': new Response('denied', { status: 403 }),
  });
  await writeFile(path.join(destination, 'app.zip'), 'original');
  await assert.rejects(download(options), /GitHub request failed \(403\)/);
  assert.equal(await readFile(path.join(destination, 'app.zip'), 'utf8'), 'original');
  assert.deepEqual(await readdir(destination), ['app.zip']);
});
