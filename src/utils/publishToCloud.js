/**
 * Publish the exported HTML to GitHub Pages via the GitHub API.
 * Uses a Personal Access Token stored in localStorage.
 *
 * Setup:
 * 1. Create a token at https://github.com/settings/tokens
 *    Scope needed: "repo" (or just "public_repo")
 * 2. Token is stored in localStorage under 'livelyrics_github_token'
 */

import { generateTabletHTML } from './exportTablet'

const GITHUB_OWNER = 'mortomb-cpu'
const GITHUB_REPO = 'livelyrics'
const FILE_PATH = 'docs/perform.html'
const BRANCH = 'main'

const TOKEN_KEY = 'livelyrics_github_token'

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setStoredToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getPublicURL() {
  return `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/perform.html`
}

/**
 * Upload the HTML file to GitHub via the Contents API.
 * This creates or updates docs/perform.html in the repo.
 */
export async function publishToCloud(songs, allSongs, token) {
  if (!token) {
    throw new Error('GitHub token is required. Get one at https://github.com/settings/tokens (needs "repo" scope).')
  }

  // Generate the full HTML
  const html = generateTabletHTML(songs, allSongs)

  // Base64 encode the HTML (GitHub API requires this)
  // Handle unicode properly
  const encoded = btoa(unescape(encodeURIComponent(html)))

  const apiURL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`

  // First, try to get the existing file to get its SHA (needed for updates)
  let existingSha = null
  try {
    const getResp = await fetch(`${apiURL}?ref=${BRANCH}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    })
    if (getResp.ok) {
      const data = await getResp.json()
      existingSha = data.sha
    }
  } catch (e) {
    // File doesn't exist yet, will be created
  }

  // Now create or update the file
  const body = {
    message: `Publish set list - ${new Date().toISOString()}`,
    content: encoded,
    branch: BRANCH
  }
  if (existingSha) body.sha = existingSha

  const putResp = await fetch(apiURL, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!putResp.ok) {
    const errData = await putResp.json().catch(() => ({}))
    throw new Error(`GitHub API error (${putResp.status}): ${errData.message || 'Unknown error'}`)
  }

  return getPublicURL()
}

/**
 * Generate a simple QR code SVG for a URL.
 * Uses a minimal QR implementation (no external library).
 * For better QR codes, use an external service URL.
 */
export function qrCodeSrc(url) {
  // Use Google Charts API to generate QR code
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`
}
