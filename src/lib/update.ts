import { createWriteStream, chmodSync, renameSync, unlinkSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { platform, arch } from "node:os"
import { installSkills } from "./skills.js"

const REPO = "blaknite/faber"
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`
const GITHUB_LATEST_RELEASE_URL = `https://github.com/${REPO}/releases/latest`

// Resolve the latest release version by following GitHub's redirect from
// /releases/latest to /releases/tag/vX.Y.Z. This avoids the GitHub API
// entirely -- no auth, no rate limits, no extra tooling required.
export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_LATEST_RELEASE_URL, { redirect: "manual" })
    const location = res.headers.get("location")
    if (!location) return null
    const match = location.match(/\/releases\/tag\/v?([^/]+)$/)
    return match ? match[1]! : null
  } catch {
    return null
  }
}

// Map the current platform and architecture to the release asset name that
// the CI pipeline produces. Mirrors the logic in install.sh.
function resolveAssetName(): string | null {
  const os = platform()
  const cpu = arch()

  if (os === "darwin" && cpu === "arm64") return "faber-darwin-arm64"
  if (os === "darwin" && cpu === "x64") return "faber-darwin-x64"
  if (os === "linux" && cpu === "arm64") return "faber-linux-arm64"
  if (os === "linux" && cpu === "x64") return "faber-linux-x64"

  return null
}

interface GitHubRelease {
  tag_name: string
  assets: Array<{
    name: string
    browser_download_url: string
  }>
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const res = await fetch(GITHUB_API, {
    headers: { Accept: "application/vnd.github+json" },
  })

  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`)
  }

  return res.json() as Promise<GitHubRelease>
}

// Download a URL to a temp file and return the path.
async function downloadToTemp(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  }

  const tmpPath = join(tmpdir(), `faber-update-${Date.now()}`)
  const stream = createWriteStream(tmpPath)

  const body = res.body
  if (!body) throw new Error("Response body was empty")

  const reader = body.getReader()
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject)
    const pump = () => {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            stream.end()
            resolve()
            return
          }
          stream.write(value, pump)
        })
        .catch(reject)
    }
    pump()
  })

  return tmpPath
}

export async function checkAndUpdate(currentVersion: string): Promise<void> {
  const assetName = resolveAssetName()
  if (!assetName) {
    const os = platform()
    const cpu = arch()
    throw new Error(`Unsupported platform: ${os}/${cpu}`)
  }

  console.log("Checking for updates...")

  const release = await fetchLatestRelease()
  const latestVersion = release.tag_name.replace(/^v/, "")

  if (currentVersion !== "dev" && currentVersion === latestVersion) {
    console.log(`Already up to date (${currentVersion}).`)
    return
  }

  const asset = release.assets.find((a) => a.name === assetName)
  if (!asset) {
    throw new Error(`No release asset found for ${assetName}. Check https://github.com/${REPO}/releases`)
  }

  if (currentVersion === "dev") {
    console.log(`Downloading ${latestVersion}...`)
  } else {
    console.log(`Updating ${currentVersion} -> ${latestVersion}...`)
  }

  const tmpPath = await downloadToTemp(asset.browser_download_url)

  // Make the downloaded file executable before replacing the running binary.
  chmodSync(tmpPath, 0o755)

  // Replace the running binary. process.execPath is the path to the current
  // executable when running as a compiled binary. On some platforms you can't
  // overwrite a running binary directly, so we rename the old one out of the
  // way first, then move the new one into place.
  const dest = process.execPath
  const backup = `${dest}.old`

  try {
    if (existsSync(backup)) unlinkSync(backup)
    renameSync(dest, backup)
    renameSync(tmpPath, dest)
    if (existsSync(backup)) unlinkSync(backup)
  } catch (err) {
    // Try to restore the backup if the replacement failed.
    if (existsSync(backup) && !existsSync(dest)) {
      try {
        renameSync(backup, dest)
      } catch {
        // Nothing more we can do here.
      }
    }
    throw err
  }

  console.log(`Updated to ${latestVersion}.`)

  // Offer to update skills now that the binary is at the new version.
  await installSkills(latestVersion, import.meta.dir)
}
