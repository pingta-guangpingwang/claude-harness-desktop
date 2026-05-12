// 项目启动器 — 一键启动 bat 生成与执行
import { ipcMain, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'

const BAT_FILENAME = '.dbvs-launch.bat'

function detectLaunchCommand(projectPath: string, projectName: string): string {
  const pkgJson = path.join(projectPath, 'package.json')
  if (fs.existsSync(pkgJson)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'))
      const scripts = pkg.scripts || {}
      if (scripts.dev) return 'npm run dev'
      if (scripts.start) return 'npm start'
      if (scripts.serve) return 'npm run serve'
      if (scripts.build) return 'npm run build'
      return 'npm run dev'
    } catch { return 'npm run dev' }
  }
  if (fs.existsSync(path.join(projectPath, 'pom.xml'))) return 'mvn spring-boot:run'
  if (fs.existsSync(path.join(projectPath, 'build.gradle')) || fs.existsSync(path.join(projectPath, 'build.gradle.kts'))) return 'gradle bootRun'
  if (fs.existsSync(path.join(projectPath, 'go.mod'))) return 'go run .'
  if (fs.existsSync(path.join(projectPath, 'Cargo.toml'))) return 'cargo run'
  if (fs.existsSync(path.join(projectPath, 'requirements.txt'))) return 'python -m uvicorn main:app --reload'
  if (fs.existsSync(path.join(projectPath, 'pyproject.toml'))) return 'poetry run python -m main'
  if (fs.existsSync(path.join(projectPath, 'docker-compose.yml')) || fs.existsSync(path.join(projectPath, 'docker-compose.yaml'))) return 'docker-compose up'
  if (fs.existsSync(path.join(projectPath, 'Makefile'))) return 'make run'
  if (fs.existsSync(path.join(projectPath, 'CMakeLists.txt'))) return `cmake --build build && build\\Debug\\${projectName}.exe`
  if (fs.existsSync(path.join(projectPath, 'index.html'))) return 'start index.html'
  return 'echo 未检测到已知项目类型，请手动编辑此文件'
}

function generateBat(projectPath: string, projectName: string): { success: boolean; command: string; message?: string } {
  try {
    const launchCmd = detectLaunchCommand(projectPath, projectName)

    // 工具预检
    const toolChecks: string[] = []
    if (launchCmd.includes('npm') || launchCmd.includes('node ')) {
      toolChecks.push('where node >nul 2>&1 || (echo [X] Node.js not found - https://nodejs.org && pause && exit /b 1)')
    }
    if (launchCmd.includes('mvn')) {
      toolChecks.push('where mvn >nul 2>&1 || (echo [X] Maven not found && pause && exit /b 1)')
    }
    if (launchCmd.includes('python') || launchCmd.includes('uvicorn')) {
      toolChecks.push('where python >nul 2>&1 || (echo [X] Python not found && pause && exit /b 1)')
    }
    if (launchCmd.includes('go ')) {
      toolChecks.push('where go >nul 2>&1 || (echo [X] Go not found && pause && exit /b 1)')
    }
    if (launchCmd.includes('docker')) {
      toolChecks.push('where docker >nul 2>&1 || (echo [X] Docker not found && pause && exit /b 1)')
    }
    const toolCheckBlock = toolChecks.length > 0
      ? '\n' + toolChecks.join('\n') + '\n'
      : ''

    const batContent = `@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"${toolCheckBlock}
echo ========================================
echo   ${projectName}
echo   ${launchCmd}
echo ========================================
echo.
${launchCmd}
if %ERRORLEVEL% neq 0 (
    echo.
    echo [X] Exit code: %ERRORLEVEL%
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo ========================================
echo   Done
echo ========================================
pause
`
    const batPath = path.join(projectPath, BAT_FILENAME)
    fs.writeFileSync(batPath, batContent, 'utf-8')
    return { success: true, command: launchCmd }
  } catch (err) {
    return { success: false, command: '', message: String(err) }
  }
}

export function registerProjectLauncherIpc() {
  // 检查启动脚本是否存在
  ipcMain.handle('project:check-launch-bat', async (_event, projectPath: string) => {
    const batPath = path.join(projectPath, BAT_FILENAME)
    const exists = fs.existsSync(batPath)
    return { success: true, exists }
  })

  // 为单个项目生成启动脚本
  ipcMain.handle('project:generate-launch-bat', async (_event, projectPath: string, projectName?: string) => {
    const name = projectName || projectPath.split('\\').pop() || projectPath
    const result = generateBat(projectPath, name)
    return result
  })

  // 为全部项目生成启动脚本
  ipcMain.handle('project:generate-all-launch-bats', async (_event, projects: Array<{ path: string; name: string }>) => {
    const results: Array<{ path: string; name: string; success: boolean; command: string; message?: string }> = []
    for (const p of projects) {
      const result = generateBat(p.path, p.name)
      results.push({ path: p.path, name: p.name, ...result })
    }
    return { success: true, results }
  })

  // 启动项目（执行 bat）
  ipcMain.handle('project:launch', async (_event, projectPath: string) => {
    const batPath = path.join(projectPath, BAT_FILENAME)
    if (!fs.existsSync(batPath)) {
      return { success: false, message: '启动脚本未生成，请先在 Chat 中让驾驭智能体生成' }
    }
    try {
      // 使用 shell.openPath 打开 bat（在新窗口中运行）
      const err = await shell.openPath(batPath)
      if (err) {
        // shell.openPath 失败时尝试直接用 cmd 启动
        exec(`start "" "${batPath}"`, { cwd: projectPath })
      }
      return { success: true }
    } catch (err) {
      return { success: false, message: String(err) }
    }
  })
}
