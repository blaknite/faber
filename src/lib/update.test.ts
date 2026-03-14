import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { fetchLatestVersion, checkAndUpdate } from "./update.js"

// Most of update.ts is network-dependent: fetchLatestRelease() and downloadToTemp()
// both require real HTTP calls and aren't exported. resolveAssetName() is also
// unexported. We test what we can with fetch mocking and document the rest.

// Helper to create a minimal Response-like object for spying on fetch.
function makeRedirectResponse(location: string | null): Response {
  const headers = new Headers()
  if (location) headers.set("location", location)
  return new Response(null, { status: 302, headers })
}

describe("fetchLatestVersion", () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it("extracts the version from a redirect location with a v prefix", async () => {
    fetchSpy.mockResolvedValue(makeRedirectResponse("https://github.com/blaknite/faber/releases/tag/v1.2.3"))
    const version = await fetchLatestVersion()
    expect(version).toBe("1.2.3")
  })

  it("extracts the version from a redirect location without a v prefix", async () => {
    fetchSpy.mockResolvedValue(makeRedirectResponse("https://github.com/blaknite/faber/releases/tag/1.2.3"))
    const version = await fetchLatestVersion()
    expect(version).toBe("1.2.3")
  })

  it("handles pre-release version strings like 1.0.0-beta.1", async () => {
    fetchSpy.mockResolvedValue(makeRedirectResponse("https://github.com/blaknite/faber/releases/tag/v1.0.0-beta.1"))
    const version = await fetchLatestVersion()
    expect(version).toBe("1.0.0-beta.1")
  })

  it("returns null when there is no location header", async () => {
    fetchSpy.mockResolvedValue(makeRedirectResponse(null))
    const version = await fetchLatestVersion()
    expect(version).toBeNull()
  })

  it("returns null when the location does not match the expected pattern", async () => {
    fetchSpy.mockResolvedValue(makeRedirectResponse("https://github.com/blaknite/faber/releases"))
    const version = await fetchLatestVersion()
    expect(version).toBeNull()
  })

  it("returns null when fetch throws", async () => {
    fetchSpy.mockRejectedValue(new Error("network error"))
    const version = await fetchLatestVersion()
    expect(version).toBeNull()
  })
})

describe("checkAndUpdate -- dev mode guard", () => {
  it("exits early when not running as a compiled binary", async () => {
    // In test (and dev) environments process.argv[1] does not start with /$bunfs/,
    // so checkAndUpdate should bail out immediately without making any network calls.
    const fetchSpy = spyOn(globalThis, "fetch")
    try {
      await checkAndUpdate("1.0.0")
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

// resolveAssetName() is not exported so it can't be tested directly. It maps
// platform()/arch() pairs to release asset names. The logic is a straightforward
// lookup table (darwin/arm64, darwin/x64, linux/arm64, linux/x64) with a null
// fallback for unsupported platforms. If this function is ever extracted or
// exported, add tests here for each supported combination and for the unsupported
// fallback.
describe.skip("resolveAssetName (unexported)", () => {
  it.skip("is not directly testable -- extract and export to add coverage", () => {})
})

// fetchLatestRelease() and downloadToTemp() are unexported async functions that
// call fetch() directly. They're covered indirectly through checkAndUpdate() in
// integration, but unit testing them would require either exporting them or
// using a more invasive fetch mock. If coverage of those paths matters, consider
// exporting them (prefixed with _ or moved to a separate internal module) so
// tests can import and exercise them with a mocked fetch.
describe.skip("fetchLatestRelease / downloadToTemp (unexported)", () => {
  it.skip("is not directly testable without exporting or extracting", () => {})
})
