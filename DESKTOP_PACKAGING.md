# Desktop Packaging

This project now has two launch modes:

- Web/dev server: `npm.cmd start`
- Desktop shell: `npm.cmd run desktop`

The desktop shell starts the same local AI PDF Tutor server on a random local port, opens it in an Electron window, and stores writable runtime files in the normal Windows app data directory:

```text
C:\Users\<you>\AppData\Roaming\AI PDF Tutor\ai-tutor.config.json
C:\Users\<you>\AppData\Roaming\AI PDF Tutor\logs\app.log
```

## Build Outputs

Install dependencies, verify the project, and build the Windows x64 installer when the machine can download Electron Builder's NSIS resources:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run lint
npm.cmd run dist:win -- --x64 --publish never
```

If the installer step is blocked by network access to GitHub, build the unpacked desktop app instead:

```powershell
npm.cmd run pack:win
```

The runnable app is:

```text
release\win-unpacked\AI PDF Tutor.exe
```

For sharing without an installer, zip the contents of `release\win-unpacked`. For v0.2.0:

```powershell
Compress-Archive -Path 'release\win-unpacked\*' -DestinationPath 'release\AI-PDF-Tutor-0.2.0-win-x64.zip' -Force
```

## Updating the Desktop App

Starting with v0.2.0, packaged Windows builds check GitHub for a newer stable Release after launch and every six hours. The toolbar's **检查更新** button also performs a manual check. A new version changes the toolbar label to **发现新版本** without interrupting reading.

Open that button to read the release notes, choose **下载更新**, and wait for the download to finish. **重启安装** saves pending annotations before exiting and running the installer. Downloading and installing both require an explicit user action. Web mode and development builds do not install updates, and prereleases are not selected.

**v0.1.1 cannot update itself:** download and manually install v0.2.0 or later from [GitHub Releases](https://github.com/jiiaxing/ai-document-learning/releases/latest) once to enable future in-app updates.

For a ZIP build, **下载安装版** downloads the normal Windows installer and **退出并安装新版** exits into that installer. The old ZIP directory is not replaced in place. After installation, launch the new version from its desktop or Start menu shortcut. Runtime settings continue to use the app data directory above.

## Publishing a Stable Release

1. Update `package.json` and `package-lock.json` to the same new version, commit the changes, and push a matching stable tag such as `v0.2.0`. Only exact `vX.Y.Z` tags are accepted.
2. Create and publish a GitHub Release for that tag. Put the user-facing changes in the Release description; the app displays these notes before downloading.
3. The **Build Windows release** GitHub Actions workflow checks out that exact tag, verifies the package version, and runs `npm ci`, tests, and lint before building Windows x64 assets. Wait for the workflow to finish before announcing that in-app updates are ready.

Each update-capable release needs these files from the **same build**:

```text
AI-PDF-Tutor-0.2.0-Setup.exe
AI-PDF-Tutor-0.2.0-Setup.exe.blockmap
latest.yml
```

The workflow also uploads `AI-PDF-Tutor-0.2.0-win-x64.zip` and `SHA256SUMS.txt`. It uploads application files and checksums first, then publishes `latest.yml` last so the update manifest points to already-uploaded assets. Do not edit the manifest's checksums or mix it with an installer from another build.

If all four main assets (installer, blockmap, ZIP, and `latest.yml`) already exist and have nonzero size, the workflow skips building and leaves those assets untouched. This supports uploading a fully verified local build to a draft Release before publishing it.

If a nonempty `latest.yml` is already published but any required asset is missing, the workflow fails before building or changing assets. Restore the missing **original files from the same build**, or publish a new version. Rebuilding and replacing an installer could invalidate the checksum already advertised to clients, even if only the ZIP was missing. Only when there is no nonempty published `latest.yml` may the workflow rebuild the tagged source and replace same-named assets before uploading the manifest last. Other releases and unrelated assets are preserved.

For a failed or incomplete upload with no published update manifest, run **Actions → Build Windows release → Run workflow**, supplying the existing published stable Release tag. Manual runs enforce the same tag, version, asset checks, and published-manifest protection. Draft and prerelease targets are rejected. The workflow needs repository Actions enabled and `contents: write` permission. Publishing via a workflow's `GITHUB_TOKEN` does not trigger another release workflow automatically; use the manual workflow dispatch in that case.

When uploading manually, follow the same order: installer, blockmap, ZIP, and checksums first; `latest.yml` last. For the first v0.2.0 release, uploading the complete set while the Release is still a draft avoids advertising the version before its downloads are ready.

## Smoke Test

The desktop entry supports a no-window smoke test:

```powershell
.\node_modules\.bin\electron.cmd out\desktop\main.js --smoke-test
.\release\win-unpacked\AI PDF Tutor.exe --smoke-test
```

The smoke test starts the embedded server, writes an `app.start` log entry, and exits automatically.

After building, run `node scripts/update-download-smoke.cjs` to exercise the real updater against a local HTTP feed. It verifies a successful installer download and rejection of an invalid SHA-512 checksum. Installation is stubbed; the test does not replace an installed app. The release workflow also runs this check before uploading files.
