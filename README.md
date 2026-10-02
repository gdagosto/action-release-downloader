# Download release assets

A dependency-free GitHub Action that downloads assets from published or draft releases. It runs with Node.js 24 and requires no installation or build step from callers.

```yaml
permissions:
  contents: write # Allows the workflow token to see draft releases.

steps:
  - uses: OWNER/action-release-downloader@REF
    id: download
    with:
      tag: v1.2.3
      artifacts: '*.zip, checksums.txt'
      destination: downloads
  - env:
      FILE_PATHS: ${{ steps.download.outputs.file-paths }}
    run: printf '%s\n' "$FILE_PATHS"
```

Replace `OWNER` and `REF` with the repository owner and a published tag, branch, or commit SHA.

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `tag` | Yes | | Exact, case-sensitive release tag. |
| `artifacts` | Yes | | Comma-separated exact asset names or wildcard patterns, for example `*.zip, checksums.txt`. `*` matches any characters; `?` matches one character. Matching is case-sensitive; other characters are literal. |

Whitespace around each comma-separated entry is trimmed and empty entries are ignored. An asset matching multiple entries is downloaded once, in API order. Individual entries may match nothing; the action fails if the entire list matches no assets. Asset names containing commas cannot be selected literally with this syntax; use a wildcard pattern instead.
| `repository` | No | `${{ github.repository }}` | Target repository as `owner/repo`. |
| `token` | No | `${{ github.token }}` | Token authorized for the target repository. |
| `destination` | No | `${{ github.workspace }}` | Destination directory. Relative paths resolve against the workflow workspace. |

For another private repository, supply `repository` and `token`, for example `token: ${{ secrets.RELEASE_TOKEN }}`. Use a token with **Contents: write** access to that repository when accessing drafts. The default workflow token is scoped to the workflow repository. For published releases alone, **Contents: read** is sufficient. GitHub documents draft visibility in its [release API reference](https://docs.github.com/en/rest/releases/releases#list-releases).

The action searches all release pages in GitHub API order and selects the first release whose `tag_name` matches, considering drafts, prereleases, and published releases together. It then searches all asset pages for that release. It fails if no accessible release matches, no assets match, or a download fails. It does not fall back to another release if the selected release has no matching assets.

All matching assets are saved directly in the destination directory with their original names. Existing files are overwritten. Each download is streamed to a temporary file and moved into place after completion. Files downloaded before a later failure remain in place. Generated source archives are not release assets and are not downloaded.

The `file-paths` output is a JSON array of absolute paths in asset API order, for example `["/home/runner/work/project/project/downloads/app.zip"]`. Use `${{ fromJSON(steps.download.outputs.file-paths) }}` to parse it in workflow expressions, or `${{ fromJSON(steps.download.outputs.file-paths)[0] }}` for the first path.

Run the tests locally with `node --test` on Node.js 24 or newer.
