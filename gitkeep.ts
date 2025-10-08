#!/usr/bin/env node
/**
 * GitKeep Manager - Production Ready
 * Автоматическое управление .gitkeep файлами с учётом правил .gitignore
 *
 * @version 1.0.0
 * @license MIT
 */

import fs from "node:fs/promises"
import type fsSync from "node:fs"
import path from "node:path"

// ============================================================================
// КОНСТАНТЫ И ТИПЫ
// ============================================================================

const GITKEEP_FILENAME = ".gitkeep"
const GITIGNORE_FILENAME = ".gitignore"
const CONFIG_FILENAME = ".gitkeepcfg"
const GITKEEP_IGNORE_FILENAME = ".gitkeepignore"

// ANSI цвета для логов
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
}

interface GitignoreRule {
  pattern: string
  isNegated: boolean
  onlyDir: boolean
  anchored: boolean
  baseDir: string
  regex: RegExp
  original: string
}

type RulesMap = Map<string, GitignoreRule[]>

interface Config {
  root?: string
  dryRun: boolean
  verbose: boolean
  reportFile?: string | null
  content: string
  clean: boolean
  check: boolean
  excludeDirs: string[]
  gitkeepName: string
  respectGitkeepIgnore: boolean
}

interface Summary {
  created: string[]
  removed: string[]
  skipped: string[]
  errors: string[]
}

// ============================================================================
// ГЛОБАЛЬНАЯ КОНФИГУРАЦИЯ
// ============================================================================

let config: Config = {
  dryRun: false,
  verbose: false,
  reportFile: null,
  content: "",
  clean: false,
  check: false,
  excludeDirs: [".git", "node_modules", ".next", "dist", "build"],
  gitkeepName: GITKEEP_FILENAME,
  respectGitkeepIgnore: true,
}

// ============================================================================
// УТИЛИТЫ ДЛЯ ЛОГИРОВАНИЯ
// ============================================================================

function log(...args: unknown[]) {
  console.log(`${colors.cyan}[gitkeep]${colors.reset}`, ...args)
}

function success(...args: unknown[]) {
  console.log(`${colors.green}[gitkeep]${colors.reset}`, ...args)
}

function warn(...args: unknown[]) {
  console.warn(`${colors.yellow}[gitkeep][WARN]${colors.reset}`, ...args)
}

function error(...args: unknown[]) {
  console.error(`${colors.red}[gitkeep][ERROR]${colors.reset}`, ...args)
}

function debug(...args: unknown[]) {
  if (config.verbose) {
    console.debug(`${colors.gray}[gitkeep][DEBUG]${colors.reset}`, ...args)
  }
}

function info(...args: unknown[]) {
  console.info(`${colors.blue}[gitkeep][INFO]${colors.reset}`, ...args)
}

// ============================================================================
// ЗАГРУЗКА КОНФИГУРАЦИИ
// ============================================================================

/**
 * Загружает конфигурацию из файла .gitkeepcfg (JSON)
 */
async function loadConfigFile(rootPath: string): Promise<Partial<Config>> {
  const configPath = path.join(rootPath, CONFIG_FILENAME)

  try {
    const exists = await fileExists(configPath)
    if (!exists) return {}

    const content = await fs.readFile(configPath, "utf8")
    const parsed = JSON.parse(content)

    debug(`Загружена конфигурация из ${CONFIG_FILENAME}`)
    return parsed
  } catch (err) {
    warn(`Ошибка чтения конфигурации из ${configPath}: ${(err as Error).message}`)
    return {}
  }
}

/**
 * Парсит аргументы CLI
 */
function parseArgs(argvList: string[]): Partial<Config> {
  const res: Partial<Config> = {}

  for (let i = 0; i < argvList.length; i++) {
    const a = argvList[i]

    switch (a) {
      case "--root":
        if (argvList[i + 1]) {
          res.root = argvList[++i]
        } else {
          error("--root требует путь в качестве аргумента")
          process.exit(1)
        }
        break

      case "--dry-run":
      case "-d":
        res.dryRun = true
        break

      case "--verbose":
      case "-v":
        res.verbose = true
        break

      case "--report":
      case "-r":
        if (argvList[i + 1]) {
          res.reportFile = argvList[++i]
        } else {
          error("--report требует путь к файлу")
          process.exit(1)
        }
        break

      case "--content":
      case "-c":
        if (argvList[i + 1]) {
          res.content = argvList[++i]
        } else {
          error("--content требует строку")
          process.exit(1)
        }
        break

      case "--clean":
        res.clean = true
        break

      case "--check":
        res.check = true
        break

      case "--exclude":
      case "-e":
        if (argvList[i + 1]) {
          const dirs = argvList[++i].split(",").map((d) => d.trim())
          res.excludeDirs = dirs
        } else {
          error("--exclude требует список директорий через запятую")
          process.exit(1)
        }
        break

      case "--gitkeep-name":
        if (argvList[i + 1]) {
          res.gitkeepName = argvList[++i]
        } else {
          error("--gitkeep-name требует имя файла")
          process.exit(1)
        }
        break

      case "--no-gitkeepignore":
        res.respectGitkeepIgnore = false
        break

      case "--help":
      case "-h":
        printHelp()
        process.exit(0)

      case "--version":
        console.log("gitkeep-manager v1.0.0")
        process.exit(0)

      default:
        warn(`Неизвестный аргумент: ${a}`)
    }
  }

  return res
}

/**
 * Выводит справку по использованию
 */
function printHelp() {
  console.log(`
${colors.cyan}GitKeep Manager v1.0.0${colors.reset}
Автоматическое управление .gitkeep файлами с учётом правил .gitignore

${colors.yellow}ИСПОЛЬЗОВАНИЕ:${colors.reset}
  gitkeep [опции]

${colors.yellow}ОПЦИИ:${colors.reset}
  --root <path>              Корневая директория проекта (по умолчанию: текущая)
  -d, --dry-run              Режим симуляции (не изменяет файлы)
  -v, --verbose              Подробный вывод
  -r, --report <file>        Сохранить отчёт в JSON файл
  -c, --content <text>       Содержимое для .gitkeep файлов
  --clean                    Удалить все .gitkeep файлы
  --check                    Только проверка, без изменений
  -e, --exclude <dirs>       Исключить директории (через запятую)
  --gitkeep-name <name>      Имя файла вместо .gitkeep
  --no-gitkeepignore         Игнорировать .gitkeepignore файлы
  -h, --help                 Показать эту справку
  --version                  Показать версию

${colors.yellow}ПРИМЕРЫ:${colors.reset}
  gitkeep                                    # Обработать текущую директорию
  gitkeep --root ./my-project                # Обработать конкретный проект
  gitkeep --dry-run --verbose                # Симуляция с подробным выводом
  gitkeep --clean                            # Удалить все .gitkeep
  gitkeep --content "Keep this directory"    # Кастомное содержимое
  gitkeep --exclude "temp,cache"             # Исключить директории

${colors.yellow}КОНФИГУРАЦИЯ:${colors.reset}
  Создайте файл .gitkeepcfg в корне проекта с настройками в JSON формате:
  {
    "content": "This directory is intentionally kept empty",
    "excludeDirs": ["temp", "cache"],
    "verbose": true
  }

${colors.yellow}ДОПОЛНИТЕЛЬНО:${colors.reset}
  - Создайте .gitkeepignore для дополнительных правил игнорирования
  - Поддерживает все стандартные паттерны .gitignore
  - Автоматически пропускает .git, node_modules и другие служебные папки

${colors.cyan}Документация: https://github.com/yourusername/gitkeep-manager${colors.reset}
`)
}

// ============================================================================
// УТИЛИТЫ ДЛЯ РАБОТЫ С ФАЙЛОВОЙ СИСТЕМОЙ
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/")
}

function relativePosix(root: string, target: string): string {
  let rel = path.relative(root, target)
  rel = toPosixPath(rel)
  if (rel === "") rel = "."
  return rel
}

// ============================================================================
// ОБРАБОТКА GITIGNORE ПРАВИЛ
// ============================================================================

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Конвертирует gitignore-шаблон в регулярное выражение
 */
function patternToRegExp(pattern: string, anchored: boolean, baseDir: string, onlyDir: boolean): RegExp {
  const segments = pattern.split("/")
  const regexParts: string[] = []

  for (const seg of segments) {
    if (seg === "**") {
      regexParts.push("(?:.*/)?")
      continue
    }

    let segmentRegex = ""
    for (const char of seg) {
      if (char === "*") {
        segmentRegex += "[^/]*"
      } else if (char === "?") {
        segmentRegex += "[^/]"
      } else {
        segmentRegex += escapeRegExp(char)
      }
    }

    regexParts.push(segmentRegex)
  }

  let regexStr = ""

  if (anchored) {
    const basePath = baseDir === "." ? "" : baseDir + "/"
    regexStr = "^" + escapeRegExp(basePath) + regexParts.join("/")

    if (onlyDir) {
      regexStr += "(?:/.*)?$"
    } else {
      regexStr += "$"
    }
  } else {
    const patternStr = regexParts.join("/")

    if (onlyDir) {
      regexStr = "(?:^|/)" + patternStr + "(?:/.*)?$"
    } else {
      regexStr = "(?:^|/)" + patternStr + "$"
    }
  }

  return new RegExp(regexStr)
}

/**
 * Загружает правила из .gitignore или .gitkeepignore
 */
async function loadIgnoreRules(dirPath: string, relativeDirPosix: string, filename: string): Promise<GitignoreRule[]> {
  const ignorePath = path.join(dirPath, filename)
  if (!(await fileExists(ignorePath))) {
    return []
  }

  try {
    const content = await fs.readFile(ignorePath, "utf8")
    const rawLines = content.split(/\r?\n/)
    const rules: GitignoreRule[] = []

    for (let raw of rawLines) {
      const originalRaw = raw
      raw = raw.trim()
      if (!raw || raw.startsWith("#")) continue

      let isNegated = false
      let line = raw

      if (line.startsWith("!")) {
        isNegated = true
        line = line.slice(1)
      }

      line = line.replace(/\\([\\!*?[\]{}()])/g, "$1")

      let onlyDir = false
      if (line.endsWith("/")) {
        onlyDir = true
        line = line.slice(0, -1)
      }

      let anchored = false
      if (line.startsWith("/")) {
        anchored = true
        line = line.slice(1)
      }

      const pattern = line.replace(/\\/g, "/")
      const regex = patternToRegExp(pattern, anchored, relativeDirPosix, onlyDir)

      rules.push({
        pattern,
        isNegated,
        onlyDir,
        anchored,
        baseDir: relativeDirPosix,
        regex,
        original: originalRaw,
      })
    }

    if (rules.length > 0) {
      debug(`Загружено ${rules.length} правил из ${path.posix.join(relativeDirPosix, filename)}`)
    }

    return rules
  } catch (err) {
    warn(`Ошибка чтения ${ignorePath}: ${(err as Error).message}`)
    return []
  }
}

/**
 * Загружает правила .gitignore
 */
async function loadGitignoreFromPath(dirPath: string, relativeDirPosix: string): Promise<GitignoreRule[]> {
  return loadIgnoreRules(dirPath, relativeDirPosix, GITIGNORE_FILENAME)
}

/**
 * Загружает правила .gitkeepignore
 */
async function loadGitkeepIgnoreFromPath(dirPath: string, relativeDirPosix: string): Promise<GitignoreRule[]> {
  if (!config.respectGitkeepIgnore) return []
  return loadIgnoreRules(dirPath, relativeDirPosix, GITKEEP_IGNORE_FILENAME)
}

// ============================================================================
// НАКОПИТЕЛЬ ПРАВИЛ
// ============================================================================

class RulesAccumulator {
  private gitignoreMap: RulesMap
  private gitkeepIgnoreMap: RulesMap
  private cache: Map<string, GitignoreRule[]>

  constructor(gitignoreMap: RulesMap, gitkeepIgnoreMap: RulesMap) {
    this.gitignoreMap = gitignoreMap
    this.gitkeepIgnoreMap = gitkeepIgnoreMap
    this.cache = new Map()
  }

  accumulate(relativeDirPosix: string): GitignoreRule[] {
    if (this.cache.has(relativeDirPosix)) {
      return this.cache.get(relativeDirPosix)!
    }

    const parts = relativeDirPosix === "." ? [] : relativeDirPosix.split("/")
    const accumulated: GitignoreRule[] = []

    // Собираем правила из .gitignore и .gitkeepignore
    for (let i = 0; i <= parts.length; i++) {
      const dir = i === 0 ? "." : parts.slice(0, i).join("/")

      const gitignoreRules = this.gitignoreMap.get(dir)
      if (gitignoreRules) accumulated.push(...gitignoreRules)

      const gitkeepIgnoreRules = this.gitkeepIgnoreMap.get(dir)
      if (gitkeepIgnoreRules) accumulated.push(...gitkeepIgnoreRules)
    }

    this.cache.set(relativeDirPosix, accumulated)
    return accumulated
  }
}

/**
 * Проверяет совпадение правила
 */
function matchRule(relativePathPosix: string, rule: GitignoreRule, isDir: boolean): boolean {
  if (rule.onlyDir && !isDir) return false

  const matched = rule.regex.test(relativePathPosix)

  if (matched && config.verbose) {
    debug(`Правило "${rule.original}" совпало с "${relativePathPosix}" (isDir=${isDir})`)
  }

  return matched
}

/**
 * Проверяет, игнорируется ли путь
 */
function isIgnored(relativePathPosix: string, isDir: boolean, rules: GitignoreRule[]): boolean {
  let ignored = false

  for (const rule of rules) {
    if (matchRule(relativePathPosix, rule, isDir)) {
      ignored = !rule.isNegated
    }
  }

  return ignored
}

// ============================================================================
// ОСНОВНАЯ ЛОГИКА ОБХОДА ДИРЕКТОРИЙ
// ============================================================================

/**
 * Рекурсивно обходит директории и управляет .gitkeep файлами
 */
async function walkDirectory(
  dirPath: string,
  rootPath: string,
  rulesAccumulator: RulesAccumulator,
  summary: Summary,
): Promise<boolean> {
  const relativeDir = relativePosix(rootPath, dirPath)
  const dirName = path.basename(dirPath)

  debug(`Обход директории: ${relativeDir}`)

  // Проверка на исключённые директории
  if (config.excludeDirs.includes(dirName)) {
    debug(`Директория ${relativeDir} в списке исключений, пропускаем`)
    return true
  }

  // Загружаем правила для этой директории
  const rules = rulesAccumulator.accumulate(relativeDir)

  // Проверяем, игнорируется ли сама директория
  if (isIgnored(relativeDir, true, rules)) {
    debug(`Директория ${relativeDir} игнорируется, пропускаем`)
    summary.skipped.push(relativeDir)
    return true
  }

  // Читаем содержимое директории
  let dirEntries: fsSync.Dirent[]
  try {
    dirEntries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch (err) {
    const errMsg = `Не удалось прочитать директорию ${dirPath}: ${(err as Error).message}`
    warn(errMsg)
    summary.errors.push(errMsg)
    return true
  }

  const subdirs = dirEntries.filter((d) => d.isDirectory())
  const files = dirEntries.filter((d) => d.isFile())

  // Рекурсивно обходим поддиректории
  let hasNonEmptySubdir = false
  for (const subdir of subdirs) {
    const subdirPath = path.join(dirPath, subdir.name)
    const subdirIsEmpty = await walkDirectory(subdirPath, rootPath, rulesAccumulator, summary)
    if (!subdirIsEmpty) {
      hasNonEmptySubdir = true
    }
  }

  // Фильтруем видимые файлы (не игнорируемые и не .gitkeep)
  const visibleFiles = files.filter((f) => {
    if (f.name === config.gitkeepName) return false
    const fRelPath = relativePosix(rootPath, path.join(dirPath, f.name))
    const ignored = isIgnored(fRelPath, false, rules)
    if (ignored) {
      debug(`Файл ${fRelPath} игнорируется`)
    }
    return !ignored
  })

  const hasGitkeep = files.some((f) => f.name === config.gitkeepName)
  const isEmpty = visibleFiles.length === 0 && !hasNonEmptySubdir

  // Режим --clean: удаляем все .gitkeep
  if (config.clean) {
    if (hasGitkeep) {
      await removeGitkeep(dirPath, relativeDir, summary)
    }
    return isEmpty
  }

  // Режим --check: только проверяем
  if (config.check) {
    if (isEmpty && !hasGitkeep) {
      info(`${relativeDir} - пустая директория без ${config.gitkeepName}`)
    } else if (!isEmpty && hasGitkeep) {
      info(`${relativeDir} - не пустая директория с ${config.gitkeepName}`)
    }
    return isEmpty
  }

  // Обычный режим: создаём или удаляем .gitkeep
  if (isEmpty) {
    if (!hasGitkeep) {
      await createGitkeep(dirPath, relativeDir, summary)
    }
  } else {
    if (hasGitkeep) {
      await removeGitkeep(dirPath, relativeDir, summary)
    }
  }

  return isEmpty
}

/**
 * Создаёт .gitkeep файл
 */
async function createGitkeep(dirPath: string, relativeDir: string, summary: Summary) {
  const gitkeepPath = path.join(dirPath, config.gitkeepName)
  const relativePath = path.join(relativeDir, config.gitkeepName)

  if (config.dryRun) {
    log(`${colors.green}[DRY-RUN] Создан бы ${relativePath}${colors.reset}`)
  } else {
    try {
      await fs.writeFile(gitkeepPath, config.content, { encoding: "utf8" })
      summary.created.push(relativePath)
      if (config.verbose) {
        success(`Создан ${relativePath}`)
      }
    } catch (err) {
      const errMsg = `Ошибка создания ${relativePath}: ${(err as Error).message}`
      warn(errMsg)
      summary.errors.push(errMsg)
    }
  }
}

/**
 * Удаляет .gitkeep файл
 */
async function removeGitkeep(dirPath: string, relativeDir: string, summary: Summary) {
  const gitkeepPath = path.join(dirPath, config.gitkeepName)
  const relativePath = path.join(relativeDir, config.gitkeepName)

  if (config.dryRun) {
    log(`${colors.yellow}[DRY-RUN] Удалён бы ${relativePath}${colors.reset}`)
  } else {
    try {
      await fs.unlink(gitkeepPath)
      summary.removed.push(relativePath)
      if (config.verbose) {
        warn(`Удалён ${relativePath}`)
      }
    } catch (err) {
      const errMsg = `Ошибка удаления ${relativePath}: ${(err as Error).message}`
      warn(errMsg)
      summary.errors.push(errMsg)
    }
  }
}

// ============================================================================
// ЗАГРУЗКА ВСЕХ ПРАВИЛ
// ============================================================================

/**
 * Загружает все правила .gitignore и .gitkeepignore в дереве
 */
async function loadAllIgnoreRules(rootPath: string): Promise<{
  gitignoreMap: RulesMap
  gitkeepIgnoreMap: RulesMap
}> {
  const gitignoreMap: RulesMap = new Map()
  const gitkeepIgnoreMap: RulesMap = new Map()

  async function recursiveLoad(dirPath: string, relativeDirPosix: string) {
    // Загружаем .gitignore
    const gitignoreRules = await loadGitignoreFromPath(dirPath, relativeDirPosix)
    if (gitignoreRules.length > 0) {
      gitignoreMap.set(relativeDirPosix, gitignoreRules)
    }

    // Загружаем .gitkeepignore
    const gitkeepIgnoreRules = await loadGitkeepIgnoreFromPath(dirPath, relativeDirPosix)
    if (gitkeepIgnoreRules.length > 0) {
      gitkeepIgnoreMap.set(relativeDirPosix, gitkeepIgnoreRules)
    }

    let dirEntries: fsSync.Dirent[]
    try {
      dirEntries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of dirEntries) {
      if (entry.isDirectory()) {
        // Пропускаем исключённые директории
        if (config.excludeDirs.includes(entry.name)) {
          continue
        }

        const subDirPath = path.join(dirPath, entry.name)
        const subRelativeDirPosix = relativeDirPosix === "." ? entry.name : `${relativeDirPosix}/${entry.name}`
        await recursiveLoad(subDirPath, subRelativeDirPosix)
      }
    }
  }

  await recursiveLoad(rootPath, ".")

  return { gitignoreMap, gitkeepIgnoreMap }
}

// ============================================================================
// ОТЧЁТЫ
// ============================================================================

/**
 * Сохраняет отчёт в JSON файл
 */
async function saveReport(summary: Summary, reportPath: string) {
  const report = {
    timestamp: new Date().toISOString(),
    config: {
      root: config.root,
      dryRun: config.dryRun,
      clean: config.clean,
      check: config.check,
      gitkeepName: config.gitkeepName,
    },
    summary: {
      created: summary.created.length,
      removed: summary.removed.length,
      skipped: summary.skipped.length,
      errors: summary.errors.length,
    },
    details: summary,
  }

  try {
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8")
    success(`Отчёт сохранён в ${reportPath}`)
  } catch (err) {
    warn(`Ошибка записи отчёта: ${(err as Error).message}`)
  }
}

/**
 * Выводит итоговую статистику
 */
function printSummary(summary: Summary) {
  console.log(`\n${colors.cyan}${"=".repeat(60)}${colors.reset}`)
  console.log(`${colors.cyan}ИТОГОВАЯ СТАТИСТИКА${colors.reset}`)
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}\n`)

  if (config.clean) {
    console.log(`${colors.red}Удалено ${config.gitkeepName}: ${summary.removed.length}${colors.reset}`)
  } else if (config.check) {
    console.log(`${colors.blue}Режим проверки - изменения не внесены${colors.reset}`)
  } else {
    console.log(`${colors.green}Создано ${config.gitkeepName}: ${summary.created.length}${colors.reset}`)
    console.log(`${colors.red}Удалено ${config.gitkeepName}: ${summary.removed.length}${colors.reset}`)
  }

  console.log(`${colors.gray}Пропущено директорий: ${summary.skipped.length}${colors.reset}`)

  if (summary.errors.length > 0) {
    console.log(`${colors.red}Ошибок: ${summary.errors.length}${colors.reset}`)
  }

  if (config.dryRun) {
    console.log(`\n${colors.yellow}Режим симуляции - файлы не изменены${colors.reset}`)
  }

  console.log(`\n${colors.cyan}${"=".repeat(60)}${colors.reset}\n`)
}

// ============================================================================
// ГЛАВНАЯ ФУНКЦИЯ
// ============================================================================

async function main() {
  try {
    // Парсим аргументы CLI
    const cliConfig = parseArgs(process.argv.slice(2))

    // Определяем корневую директорию
    const root = cliConfig.root ? path.resolve(cliConfig.root) : process.cwd()

    // Загружаем конфигурацию из файла
    const fileConfig = await loadConfigFile(root)

    // Объединяем конфигурации (приоритет: CLI > файл > дефолт)
    config = { ...config, ...fileConfig, ...cliConfig, root }

    // Приветствие
    console.log(`\n${colors.cyan}${"=".repeat(60)}${colors.reset}`)
    console.log(`${colors.cyan}GitKeep Manager v1.0.0${colors.reset}`)
    console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}\n`)

    log(`Корневая директория: ${colors.magenta}${root}${colors.reset}`)

    if (config.dryRun) {
      log(`Режим: ${colors.yellow}Симуляция (dry-run)${colors.reset}`)
    } else if (config.clean) {
      log(`Режим: ${colors.red}Очистка (удаление всех ${config.gitkeepName})${colors.reset}`)
    } else if (config.check) {
      log(`Режим: ${colors.blue}Проверка (без изменений)${colors.reset}`)
    } else {
      log(`Режим: ${colors.green}Обычный (создание/удаление ${config.gitkeepName})${colors.reset}`)
    }

    if (config.verbose) {
      log(`Подробный вывод: ${colors.green}включён${colors.reset}`)
    }

    console.log()

    // Загружаем все правила .gitignore и .gitkeepignore
    debug("Загрузка правил игнорирования...")
    const { gitignoreMap, gitkeepIgnoreMap } = await loadAllIgnoreRules(root)
    debug(`Загружено ${gitignoreMap.size} файлов .gitignore`)
    debug(`Загружено ${gitkeepIgnoreMap.size} файлов .gitkeepignore`)

    const rulesAccumulator = new RulesAccumulator(gitignoreMap, gitkeepIgnoreMap)

    const summary: Summary = {
      created: [],
      removed: [],
      skipped: [],
      errors: [],
    }

    // Обходим дерево директорий
    debug("Начинаем обход директорий...")
    await walkDirectory(root, root, rulesAccumulator, summary)

    // Выводим итоговую статистику
    printSummary(summary)

    // Сохраняем отчёт, если указан
    if (config.reportFile) {
      await saveReport(summary, config.reportFile)
    }

    // Завершаем с кодом 0 если нет ошибок
    process.exit(summary.errors.length > 0 ? 1 : 0)
  } catch (err) {
    error(`Критическая ошибка: ${err instanceof Error ? err.message : String(err)}`)
    if (config.verbose && err instanceof Error && err.stack) {
      console.error(err.stack)
    }
    process.exit(1)
  }
}

// Запускаем главную функцию
main()
  