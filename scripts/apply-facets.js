// 批量给资源文件添加 facets 分面分类编码
// Usage: node scripts/apply-facets.js

const fs = require('fs')
const path = require('path')

const APPDATA = process.env.APPDATA || path.join(process.env.HOME || '.', 'AppData', 'Roaming')
const RESOURCES_DIR = path.join(APPDATA, 'dbghf', 'resources')

const batch = JSON.parse(fs.readFileSync(path.join(__dirname, 'batch-facets.json'), 'utf-8'))

function facetsToYaml(facets) {
  const lines = ['facets:']
  for (const [key, values] of Object.entries(facets)) {
    lines.push(`  ${key}:`)
    for (const v of values) {
      lines.push(`    - ${v}`)
    }
  }
  return lines.join('\n')
}

function applyFacetsToFile(filePath, facets) {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fmMatch) {
    console.log('  SKIP (no frontmatter):', filePath)
    return false
  }

  let fmText = fmMatch[1]

  // 移除旧 facets 块（如果存在），支持更换分类体系后覆盖
  const facetsIdx = fmText.search(/^facets:\r?\n/m)
  if (facetsIdx >= 0) {
    // 找到 facets 块的结束位置：下一个顶格 key 或末尾
    const afterFacets = fmText.substring(facetsIdx)
    const endMatch = afterFacets.match(/\r?\n(?=\w)/)
    const endIdx = endMatch ? facetsIdx + endMatch.index : fmText.length
    fmText = (fmText.substring(0, facetsIdx) + fmText.substring(endIdx)).replace(/\r?\n$/, '')
  }

  const facetsBlock = (facetsIdx >= 0 ? '\r\n' : '\n') + facetsToYaml(facets)
  const newFm = fmText.replace(/\r?\n$/, '') + facetsBlock
  const newContent = raw.replace(fmMatch[1], newFm)

  fs.writeFileSync(filePath, newContent, 'utf-8')
  return true
}

function extractFacetsFromFile(filePath) {
  if (!fs.existsSync(filePath)) return null
  const raw = fs.readFileSync(filePath, 'utf-8')
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fmMatch) return null

  const text = fmMatch[1]
  const lines = text.split(/\r?\n/)

  // 找到 facets: 开始的行
  let idx = lines.findIndex(l => /^facets:/.test(l))
  if (idx < 0) return null
  idx++ // 跳过 facets: 行

  const result = {}
  let currentKey = null
  for (; idx < lines.length; idx++) {
    const line = lines[idx]
    // 顶格或另一个 top-level key → 结束
    if (/^\w/.test(line)) break
    const keyMatch = line.match(/^  (\w+):/)
    const valMatch = line.match(/^    - (\S+)/)
    if (keyMatch) {
      currentKey = keyMatch[1]
      result[currentKey] = []
    } else if (valMatch && currentKey) {
      result[currentKey].push(valMatch[1])
    }
  }
  return Object.keys(result).length > 0 ? result : null
}

function rebuildManifest(repoDir) {
  const manifestPath = path.join(repoDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const items = manifest.items || []

  let updated = 0
  for (const item of items) {
    const filePath = path.join(repoDir, item.file)
    const facets = extractFacetsFromFile(filePath)
    if (facets) {
      item.facets = facets
      updated++
    } else {
      delete item.facets
    }
  }

  manifest.updated = new Date().toISOString()
  manifest.total = items.length
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  console.log(`  manifest.json: ${updated}/${items.length} items with facets`)
}

// Main
let totalUpdated = 0
let totalFiles = 0

for (const [repo, files] of Object.entries(batch)) {
  console.log(`=== ${repo} ===`)
  const repoDir = path.join(RESOURCES_DIR, repo)
  for (const [filePath, facets] of Object.entries(files)) {
    const fullPath = path.join(repoDir, filePath)
    if (!fs.existsSync(fullPath)) {
      console.log('  MISSING:', filePath)
      continue
    }
    totalFiles++
    if (applyFacetsToFile(fullPath, facets)) {
      totalUpdated++
      console.log('  OK:', filePath)
    }
  }
  rebuildManifest(repoDir)
  console.log('')
}

console.log(`Done: ${totalUpdated}/${totalFiles} files updated`)
